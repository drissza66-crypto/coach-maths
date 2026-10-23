import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { ACTIVITY_PING_SECONDS } from '@mathsuivi/shared';
import type { Db } from '../../db/client.js';
import { activityDays } from '../../db/schema.js';
import { parisDay } from '../../llm/journal.js';

/** Deux battements plus rapprochés que ça ne comptent qu'une fois (onglets multiples, rechargements). */
const MIN_GAP_MS = (ACTIVITY_PING_SECONDS - 10) * 1000;

/** Ajoute une minute au temps passé du jour, sauf si un battement vient d'être compté. */
export async function recordActivity(db: Db, userId: string, now = new Date()) {
  await db
    .insert(activityDays)
    .values({ userId, day: parisDay(now), secondes: ACTIVITY_PING_SECONDS, lastPingAt: now })
    .onConflictDoUpdate({
      target: [activityDays.userId, activityDays.day],
      set: { secondes: sql`${activityDays.secondes} + ${ACTIVITY_PING_SECONDS}`, lastPingAt: now },
      setWhere: lt(activityDays.lastPingAt, new Date(now.getTime() - MIN_GAP_MS)),
    });
}

export async function activitySince(db: Db, userId: string, since: Date) {
  return db
    .select({ day: activityDays.day, secondes: activityDays.secondes })
    .from(activityDays)
    .where(and(eq(activityDays.userId, userId), gte(activityDays.day, parisDay(since))));
}

export async function purgeOldActivity(db: Db, retentionDays: number, now = new Date()) {
  await db.delete(activityDays).where(lt(activityDays.day, parisDay(new Date(now.getTime() - retentionDays * 86_400_000))));
}

/** Lundi de la semaine d'un jour « AAAA-MM-JJ ». */
export function weekStart(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Temps par semaine sur les `weeks` dernières semaines, semaines vides comprises. */
export function weeklySeries(rows: { day: string; secondes: number }[], today: string, weeks = 6) {
  const current = weekStart(today);
  const series = Array.from({ length: weeks }, (_, i) => {
    const d = new Date(`${current}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 7 * (weeks - 1 - i));
    return { debut: d.toISOString().slice(0, 10), secondes: 0 };
  });
  const byWeek = new Map(series.map((s) => [s.debut, s]));
  for (const r of rows) {
    const w = byWeek.get(weekStart(r.day));
    if (w) w.secondes += r.secondes;
  }
  return series;
}
