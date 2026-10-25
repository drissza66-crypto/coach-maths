import type { AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { parseEnv, productionProblems } from '../src/config/env.js';
import { createMailer } from '../src/mail/mailer.js';
import { DEMO, setup } from './helpers.js';

const PROD = {
  NODE_ENV: 'production',
  COOKIE_SECURE: 'true',
  APP_URL: 'https://coach-maths.cfa.test',
  DATABASE_URL: 'postgres://mathsuivi:secret@db:5432/mathsuivi',
  MAIL_TRANSPORT: 'smtp',
  SMTP_URL: 'smtps://user:pass@smtp.cfa.test:465',
  FORMATEUR_ALLOWED_DOMAINS: 'cfa.test',
  FILE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  LLM_PROVIDER: 'mistral',
  LLM_MODEL: 'mistral-small-latest',
  LLM_API_KEY: 'cle-de-test',
};

describe('garde-fous de production', () => {
  it('accepte une configuration complète', () => {
    expect(productionProblems(parseEnv(PROD))).toEqual([]);
  });

  it('ne vérifie rien hors production', () => {
    expect(productionProblems(parseEnv({ NODE_ENV: 'development' }))).toEqual([]);
  });

  it('liste tout ce qui manque', () => {
    const env = parseEnv({
      ...PROD,
      APP_URL: 'http://coach-maths.cfa.test',
      DATABASE_URL: '',
      MAIL_TRANSPORT: 'console',
      FORMATEUR_ALLOWED_DOMAINS: '',
      FILE_ENCRYPTION_KEY: '',
      LLM_PROVIDER: 'mock',
    });
    const problems = productionProblems(env).join('\n');
    for (const name of ['DATABASE_URL', 'APP_URL', 'MAIL_TRANSPORT', 'FORMATEUR_ALLOWED_DOMAINS', 'FILE_ENCRYPTION_KEY', 'LLM_PROVIDER']) {
      expect(problems).toContain(name);
    }
  });

  it('refuse la base embarquée sur disque comme en mémoire', () => {
    expect(productionProblems(parseEnv({ ...PROD, DATABASE_URL: 'memory' })).join()).toContain('DATABASE_URL');
  });
});

describe('envoi du lien magique par SMTP', () => {
  const received: { to: string[]; data: string }[] = [];
  let smtp: SMTPServer;
  let port: number;
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => {
    smtp = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      logger: false,
      onData(stream, session, callback) {
        let data = '';
        stream.on('data', (chunk) => (data += chunk));
        stream.on('end', () => {
          received.push({ to: session.envelope.rcptTo.map((r) => r.address), data });
          callback();
        });
      },
    });
    await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
    port = (smtp.server.address() as AddressInfo).port;
    ctx = await setup();
  });
  afterAll(async () => {
    await ctx.close();
    await new Promise<void>((resolve) => smtp.close(resolve));
  });

  async function smtpApp(smtpUrl: string) {
    const env = parseEnv({ ...PROD, DATABASE_URL: 'memory', SMTP_URL: smtpUrl, FORMATEUR_ALLOWED_DOMAINS: 'cfa-demo.test' });
    return createApp({ ...ctx.deps, env, mailer: await createMailer(env) });
  }

  it('remet le mail au serveur SMTP, sans renvoyer le lien au navigateur', async () => {
    const app = await smtpApp(`smtp://127.0.0.1:${port}`);
    const res = await request(app)
      .post('/api/auth/formateur/lien')
      .set('Origin', PROD.APP_URL)
      .send({ email: DEMO.formateurEmail })
      .expect(200);
    expect(res.body.devLink).toBeUndefined();
    expect(received).toHaveLength(1);
    expect(received[0]!.to).toEqual([DEMO.formateurEmail]);
    // Le lien pointe vers l'adresse publique, jeton dans le fragment.
    expect(received[0]!.data.replace(/=\r?\n/g, '')).toMatch(/https:\/\/coach-maths\.cfa\.test\/formateur\/verification#token=/);
  });

  it('répond 503 avec un message clair si le serveur SMTP est injoignable', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = await smtpApp('smtp://127.0.0.1:1');
    const res = await request(app)
      .post('/api/auth/formateur/lien')
      .set('Origin', PROD.APP_URL)
      .send({ email: DEMO.formateurEmail })
      .expect(503);
    expect(res.body.error).toMatch(/n’a pas pu être envoyé/);
    expect(quiet).toHaveBeenCalledWith('[mail] envoi du lien impossible :', expect.any(String));
    quiet.mockRestore();
  });
});

describe("l'API sert l'interface construite", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    ctx = await setup({ NODE_ENV: 'production', COOKIE_SECURE: 'true' });
  });
  afterAll(() => ctx.close());

  it("renvoie l'application React pour toute page, rechargement compris", async () => {
    for (const path of ['/', '/apprenti/tuteur', '/formateur/verification']) {
      const res = await request(ctx.app).get(path).set('Accept', 'text/html').expect(200);
      expect(res.text).toContain('<div id="root">');
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('met en cache longtemps les fichiers à nom unique', async () => {
    const res = await request(ctx.app).get('/assets/app-abc123.js').expect(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('sert les autres fichiers publics tels quels', async () => {
    const res = await request(ctx.app).get('/robots.txt').expect(200);
    expect(res.text).toContain('User-agent');
  });

  it('répond 404 pour un fichier disparu, au lieu de la page d’accueil', async () => {
    await request(ctx.app).get('/assets/ancien-zzz.js').set('Accept', 'text/html').expect(404);
  });

  it('en production, seule APP_URL est une origine acceptée', async () => {
    await request(ctx.app)
      .post('/api/auth/formateur/lien')
      .set('Host', '192.168.1.50:3001')
      .set('Origin', 'http://192.168.1.50:3001')
      .send({ email: DEMO.formateurEmail })
      .expect(403);
  });

  it("garde des réponses JSON pour l'API", async () => {
    const res = await request(ctx.app).get('/api/inconnu').set('Accept', 'text/html').expect(404);
    expect(res.headers['content-type']).toMatch(/json/);
    await request(ctx.app).get('/api/sante').expect(200, { ok: true });
  });

  it("refuse de démarrer si l'interface n'a pas été construite", async () => {
    await expect(setup({ NODE_ENV: 'production', COOKIE_SECURE: 'true', WEB_DIST_DIR: 'dossier/inexistant' })).rejects.toThrow(
      /npm run build/,
    );
  });
});
