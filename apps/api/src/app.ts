import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { RequestHandler } from 'express';
import type { AppDeps } from './deps.js';
import { errorHandler, notFound, sameOrigin } from './lib/http.js';
import { authRouter } from './modules/auth/routes.js';
import { loadSession } from './modules/auth/session.js';
import { classesRouter } from './modules/classes/routes.js';
import { llmRouter } from './modules/llm/routes.js';
import { tutorRouter } from './modules/tutor/routes.js';
import { documentsRouter } from './modules/documents/routes.js';
import { contentsRouter, revisionsRouter } from './modules/contents/routes.js';
import { dashboardRouter } from './modules/dashboard/routes.js';
import { progressRouter } from './modules/progress/routes.js';
import { meRouter } from './modules/privacy/routes.js';

export function createApp(deps: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // « upgrade-insecure-requests » force le navigateur à recharger les fichiers en HTTPS :
  // utile derrière un vrai HTTPS, mais casse tout sur un réseau local en HTTP (pilote au CFA).
  const https = deps.env.APP_URL.startsWith('https://');
  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: true, directives: { 'upgrade-insecure-requests': https ? [] : null } },
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(sameOrigin(deps.env.APP_URL));
  app.use(loadSession(deps));

  // Large : toute une classe se connecte souvent depuis la même adresse IP du CFA.
  // La vraie protection contre la devinette des PIN est le verrouillage par compte.
  const authLimiter: RequestHandler = deps.env.RATE_LIMIT_ENABLED
    ? rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 300,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { error: 'Trop de tentatives. Patiente quelques minutes.' },
      })
    : (_req, _res, next) => next();

  app.get('/api/sante', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/auth', authRouter(deps, authLimiter));
  app.use('/api/me', meRouter(deps));
  app.use('/api/classes', classesRouter(deps));
  app.use('/api/llm', llmRouter(deps));
  app.use('/api/tuteur', tutorRouter(deps));
  app.use('/api/documents', documentsRouter(deps));
  app.use('/api/contenus', contentsRouter(deps));
  app.use('/api/revisions', revisionsRouter(deps));
  app.use('/api/tableau-de-bord', dashboardRouter(deps));
  app.use('/api', progressRouter(deps));
  app.use('/api', (_req, _res, next) => next(notFound()));

  const webDir = webDistDir(deps.env);
  if (webDir) serveWeb(app, webDir);
  app.use(errorHandler);

  return app;
}

/**
 * Interface construite (`npm run build`) servie par l'API elle-même : un seul serveur,
 * une seule origine, donc des cookies « même site » sans configuration. En développement,
 * c'est Vite qui sert l'interface ; on ne la sert ici qu'en production ou sur demande.
 */
function webDistDir(env: AppDeps['env']): string | null {
  const dir = env.WEB_DIST_DIR ?? (env.NODE_ENV === 'production' ? fileURLToPath(new URL('../../web/dist', import.meta.url)) : null);
  if (!dir) return null;
  if (!existsSync(join(dir, 'index.html'))) {
    throw new Error(`Interface introuvable dans ${dir} : lancez « npm run build » ou réglez WEB_DIST_DIR.`);
  }
  return dir;
}

function serveWeb(app: Express, dir: string) {
  // Fichiers à nom unique (hachage dans le nom) : mis en cache longtemps.
  app.use('/assets', express.static(join(dir, 'assets'), { immutable: true, maxAge: '1y' }));
  // Ancienne version en cache qui demande un fichier disparu : 404, pas la page d'accueil.
  app.use('/assets', (_req, res) => {
    res.status(404).end();
  });
  app.use(express.static(dir, { index: false, maxAge: '1h' }));
  // Toute autre page (/apprenti/tuteur/…, rechargement compris) : l'application React prend le relais.
  const indexHtml = join(dir, 'index.html');
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
}
