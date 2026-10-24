import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { EncryptedStore } from '../src/storage/encrypted-store.js';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { openDatabase } from '../src/db/client.js';
import { seed, DEMO } from '../src/db/seed.js';
import { dbCallLogger } from '../src/llm/journal.js';
import { createLLM } from '../src/llm/registry.js';
import { ResilientProvider } from '../src/llm/resilient.js';
import type { LLMProvider } from '../src/llm/types.js';
import { ConsoleMailer } from '../src/mail/mailer.js';

export { DEMO };

/**
 * TEST_DATABASE_URL=postgres://… (compte autorisé à créer des bases) : les tests tournent
 * sur un vrai serveur PostgreSQL. Sans elle : PostgreSQL embarqué en mémoire.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const WEB_FIXTURE = fileURLToPath(new URL('./fixtures/web', import.meta.url));

/** `provider` : remplace le fournisseur configuré (fournisseur scripté pour les tests). */
export async function setup(overrides: Record<string, string> = {}, provider?: LLMProvider) {
  const env = parseEnv({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL || 'memory',
    RATE_LIMIT_ENABLED: 'false',
    MOCK_DELAY_MS: '0',
    FORMATEUR_ALLOWED_DOMAINS: 'cfa-demo.test,cfa.test',
    // Fausse interface construite : les tests « production » n'exigent pas `npm run build`.
    WEB_DIST_DIR: WEB_FIXTURE,
    ...overrides,
  });
  const testDb = TEST_DATABASE_URL ? await createTestDatabase(TEST_DATABASE_URL) : null;
  const handle = await openDatabase({ url: testDb?.url ?? env.DATABASE_URL, pgliteDir: '' });
  await handle.migrate();
  await seed(handle.db, env.CONSENT_VERSION);
  const mailer = new ConsoleMailer(true);
  const llm = provider
    ? new ResilientProvider(provider, null, { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0, log: dbCallLogger(handle.db) })
    : createLLM(env, dbCallLogger(handle.db));
  const filesDir = await mkdtemp(join(tmpdir(), 'mathsuivi-test-'));
  const files = new EncryptedStore(filesDir, randomBytes(32));
  const deps = { db: handle.db, env, mailer, llm, files };
  const app = createApp(deps);
  return {
    app,
    deps,
    mailer,
    filesDir,
    close: async () => {
      await handle.close();
      await testDb?.drop();
      await rm(filesDir, { recursive: true, force: true });
    },
  };
}

/** Une base jetable par `setup` : les fichiers de tests tournent en parallèle sans se gêner. */
async function createTestDatabase(adminUrl: string) {
  const { Client } = await import('pg');
  const name = `mathsuivi_test_${randomBytes(6).toString('hex')}`;
  const run = async (query: string) => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(query);
    } finally {
      await admin.end();
    }
  };
  await run(`CREATE DATABASE ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return { url: url.toString(), drop: () => run(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`) };
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
