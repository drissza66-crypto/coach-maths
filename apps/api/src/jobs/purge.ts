import { lt } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { magicLinks } from '../db/schema.js';
import { purgeOldCalls, purgeOldUsage } from '../llm/journal.js';
import { purgeExpiredSessions } from '../modules/auth/session.js';

/**
 * Suppression automatique des données arrivées à expiration.
 * Les étapes suivantes y ajouteront messages, fichiers importés et journaux IA.
 */
export async function purgeExpired(deps: AppDeps) {
  await purgeExpiredSessions(deps);
  await deps.db.delete(magicLinks).where(lt(magicLinks.expiresAt, new Date()));
  await purgeOldCalls(deps.db, deps.env.LLM_LOG_RETENTION_DAYS);
  await purgeOldUsage(deps.db);
}
