import request from 'supertest';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { openDatabase } from '../src/db/client.js';
import { seed, DEMO } from '../src/db/seed.js';
import { dbCallLogger } from '../src/llm/journal.js';
import { createLLM } from '../src/llm/registry.js';
import { ConsoleMailer } from '../src/mail/mailer.js';

export { DEMO };

export async function setup(overrides: Record<string, string> = {}) {
  const env = parseEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'memory',
    RATE_LIMIT_ENABLED: 'false',
    MOCK_DELAY_MS: '0',
    FORMATEUR_ALLOWED_DOMAINS: 'cfa-demo.test,cfa.test',
    ...overrides,
  });
  const handle = await openDatabase({ url: env.DATABASE_URL, pgliteDir: '' });
  await handle.migrate();
  await seed(handle.db, env.CONSENT_VERSION);
  const mailer = new ConsoleMailer(true);
  const llm = createLLM(env, dbCallLogger(handle.db));
  const deps = { db: handle.db, env, mailer, llm };
  const app = createApp(deps);
  return { app, deps, mailer, close: () => handle.close() };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

/** Agent connecté en formateur via le lien magique. */
export async function formateurAgent(app: App, email: string = DEMO.formateurEmail) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/formateur/lien').send({ email }).expect(200);
  const token = new URL(res.body.devLink).hash.replace('#token=', '');
  await agent.post('/api/auth/formateur/verifier').send({ token }).expect(200);
  return agent;
}

export async function apprentiAgent(app: App, pseudo: string, pin: string, code: string = DEMO.classCode) {
  const agent = request.agent(app);
  await agent.post('/api/auth/apprenti/connexion').send({ code, pseudo, pin }).expect(200);
  return agent;
}
