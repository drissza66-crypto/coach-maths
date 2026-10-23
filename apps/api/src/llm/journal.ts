import { and, eq, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { dailyUsage, llmCalls } from '../db/schema.js';
import type { LLMCallRecord } from './resilient.js';

/** Écrit une ligne de journal par appel d'IA (aucun contenu). */
export function dbCallLogger(db: Db) {
  return async (record: LLMCallRecord) => {
    await db.insert(llmCalls).values({
      userId: record.userId,
      purpose: record.purpose,
      provider: record.provider,
      model: record.model,
      fallbackUsed: record.fallbackUsed,
      status: record.status,
      latencyMs: record.latencyMs,
      tokensIn: record.usage?.inputTokens,
      tokensOut: record.usage?.outputTokens,
    });
  };
}

export async function purgeOldCalls(db: Db, retentionDays: number) {
  const limit = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  await db.delete(llmCalls).where(lt(llmCalls.createdAt, limit));
}

/** « 2026-10-23 » à l'heure de Paris : la limite repart à zéro à minuit pour l'apprenti. */
export function parisDay(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(date);
}

export interface DailyQuota {
  allowed: boolean;
  used: number;
  limit: number;
}

/**
 * Compte un message de l'apprenti s'il reste du quota aujourd'hui.
 * Une seule requête atomique : deux onglets ouverts ne peuvent pas dépasser la limite.
 */
export async function consumeDailyMessage(db: Db, userId: string, limit: number, now = new Date()): Promise<DailyQuota> {
  const day = parisDay(now);
  const [row] = await db
    .insert(dailyUsage)
    .values({ userId, day, messages: 1 })
    .onConflictDoUpdate({
      target: [dailyUsage.userId, dailyUsage.day],
      set: { messages: sql`${dailyUsage.messages} + 1` },
      setWhere: sql`${dailyUsage.messages} < ${limit}`,
    })
    .returning({ messages: dailyUsage.messages });
  if (row) return { allowed: true, used: row.messages, limit };
  return { allowed: false, used: limit, limit };
}

export async function getDailyUsage(db: Db, userId: string, limit: number, now = new Date()): Promise<DailyQuota> {
  const [row] = await db
    .select({ messages: dailyUsage.messages })
    .from(dailyUsage)
    .where(and(eq(dailyUsage.userId, userId), eq(dailyUsage.day, parisDay(now))));
  const used = row?.messages ?? 0;
  return { allowed: used < limit, used, limit };
}

/** Les compteurs des jours passés ne servent plus. */
export async function purgeOldUsage(db: Db, now = new Date()) {
  await db.delete(dailyUsage).where(lt(dailyUsage.day, parisDay(now)));
}
