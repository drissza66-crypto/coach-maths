import { loadEnvFile } from '../config/load-env-file.js';
import { parseEnv } from '../config/env.js';
import { openDatabase } from './client.js';
import { seed } from './seed.js';

loadEnvFile();
const env = parseEnv(process.env);
if (env.NODE_ENV === 'production') throw new Error('Le seed de démonstration est interdit en production.');

const handle = await openDatabase({ url: env.DATABASE_URL, pgliteDir: env.PGLITE_DATA_DIR });
await handle.migrate();
const created = await seed(handle.db, env.CONSENT_VERSION);
console.info(created ? '[seed] données fictives créées.' : '[seed] déjà présentes, rien à faire.');
await handle.close();
