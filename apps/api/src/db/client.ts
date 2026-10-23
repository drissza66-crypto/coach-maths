import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.js';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  /** Applique les migrations SQL de src/db/migrations. */
  migrate(): Promise<void>;
  close(): Promise<void>;
}

const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

/**
 * DATABASE_URL=postgres://… → serveur PostgreSQL (production, docker-compose).
 * DATABASE_URL=memory       → PostgreSQL embarqué en mémoire (tests).
 * DATABASE_URL vide         → PostgreSQL embarqué sur disque (développement sans Docker).
 */
export async function openDatabase(options: { url?: string; pgliteDir: string }): Promise<DbHandle> {
  const { url, pgliteDir } = options;

  if (url && url !== 'memory') {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool, { schema });
    return {
      db,
      migrate: () => migrate(db, { migrationsFolder }),
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  if (url !== 'memory') mkdirSync(pgliteDir, { recursive: true });
  const client = url === 'memory' ? new PGlite() : new PGlite(pgliteDir);
  const db = drizzle(client, { schema });
  return {
    db,
    migrate: () => migrate(db, { migrationsFolder }),
    close: () => client.close(),
  };
}
