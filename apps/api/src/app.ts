import express from 'express';
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
import { meRouter } from './modules/privacy/routes.js';

export function createApp(deps: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
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
  app.use('/api', (_req, _res, next) => next(notFound()));
  app.use(errorHandler);

  return app;
}
