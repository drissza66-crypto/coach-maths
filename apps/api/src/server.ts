import { loadEnvFile } from './config/load-env-file.js';
import { parseEnv } from './config/env.js';
import { openDatabase } from './db/client.js';
import { createMailer } from './mail/mailer.js';
import { createApp } from './app.js';
import { dbCallLogger } from './llm/journal.js';
import { createLLM } from './llm/registry.js';
import { purgeExpired } from './jobs/purge.js';

loadEnvFile();
const env = parseEnv(process.env);
const handle = await openDatabase({ url: env.DATABASE_URL, pgliteDir: env.PGLITE_DATA_DIR });
await handle.migrate();

const llm = createLLM(env, dbCallLogger(handle.db));
const deps = { db: handle.db, env, mailer: await createMailer(env), llm };
const app = createApp(deps);

const runPurge = () => purgeExpired(deps).catch((err) => console.error('[purge] échec :', err?.message));
await runPurge();
const purgeTimer = setInterval(runPurge, 60 * 60 * 1000);

const server = app.listen(env.PORT, () => {
  const db = env.DATABASE_URL ? 'PostgreSQL' : `PostgreSQL embarqué (${env.PGLITE_DATA_DIR})`;
  console.info(`[api] prête sur http://localhost:${env.PORT} — base : ${db}`);
  const repli = llm.fallback ? `, repli : ${llm.fallback.name} (${llm.fallback.model})` : '';
  console.info(`[api] IA : ${llm.primary.name} (${llm.primary.model})${repli}`);
});

async function shutdown() {
  clearInterval(purgeTimer);
  server.close();
  await handle.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
