import { and, asc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { CHAPITRES, type ApprentiProgress, type Chapitre, type Quiz } from '@mathsuivi/shared';
import type { AppDeps } from '../../deps.js';
import { classMembers, contents, quizAttempts, users, type User } from '../../db/schema.js';
import { parisDay } from '../../llm/journal.js';
import { notFound } from '../../lib/http.js';
import { getOwnedClass } from '../classes/service.js';
import { chapterStats } from '../dashboard/compute.js';
import { loadDashboardInput } from '../dashboard/service.js';
import { activitySince, weeklySeries } from './activity.js';

/** Fenêtre de calcul de la maîtrise pour le suivi individuel. */
const PROGRESS_DAYS = 90;
const WEEKS = 6;
const MAX_A_REVOIR = 5;

interface StoredAnswer {
  enonce?: string;
  reponse: number;
  correct: boolean;
}

/**
 * Questions ratées et pas réussies depuis : la dernière réponse à cette question
 * est encore fausse. Les plus souvent ratées d'abord.
 */
export function questionsToReview(
  attempts: { createdAt: Date; reponses: unknown; body: unknown; chapitre: string | null }[],
): ApprentiProgress['aRevoir'] {
  const byQuestion = new Map<
    string,
    { fois: number; derniere: Date; dernierCorrect: boolean; bonneReponse: string; explication: string; chapitre: string | null }
  >();
  for (const a of [...attempts].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())) {
    const quiz = a.body as Quiz;
    for (const answer of a.reponses as StoredAnswer[]) {
      if (!answer.enonce) continue;
      const question = quiz.questions.find((q) => q.enonce === answer.enonce);
      if (!question) continue; // question retirée du quiz depuis
      const cur = byQuestion.get(answer.enonce) ?? {
        fois: 0,
        derniere: a.createdAt,
        dernierCorrect: true,
        bonneReponse: question.choix[question.bonne_reponse]!,
        explication: question.explication,
        chapitre: a.chapitre,
      };
      if (!answer.correct) {
        cur.fois += 1;
        cur.derniere = a.createdAt;
      }
      cur.dernierCorrect = answer.correct;
      byQuestion.set(answer.enonce, cur);
    }
  }
  return [...byQuestion.entries()]
    .filter(([, q]) => q.fois > 0 && !q.dernierCorrect)
    .sort(([, a], [, b]) => b.fois - a.fois || b.derniere.getTime() - a.derniere.getTime())
    .slice(0, MAX_A_REVOIR)
    .map(([enonce, q]) => ({
      enonce,
      bonneReponse: q.bonneReponse,
      explication: q.explication,
      chapitre: (CHAPITRES as readonly string[]).includes(q.chapitre ?? '') ? (q.chapitre as Chapitre) : null,
      fois: q.fois,
      derniere: q.derniere.toISOString(),
    }));
}

export async function computeProgress(deps: AppDeps, apprenti: Pick<User, 'id' | 'pseudo'>, now = new Date()): Promise<ApprentiProgress> {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const [membership] = await deps.db
    .select({ classId: classMembers.classId })
    .from(classMembers)
    .where(eq(classMembers.userId, apprenti.id))
    .limit(1);

  const input = membership ? await loadDashboardInput(deps, membership.classId, PROGRESS_DAYS, now) : null;
  const convs = input?.conversations.filter((c) => c.userId === apprenti.id) ?? [];
  const attempts = input?.attempts.filter((a) => a.userId === apprenti.id) ?? [];
  const weekConvs = convs.filter((c) => c.updatedAt >= weekAgo);
  const weekAttempts = attempts.filter((a) => a.createdAt && a.createdAt >= weekAgo);
  const weekTotal = weekAttempts.reduce((s, a) => s + a.total, 0);

  const activity = await activitySince(deps.db, apprenti.id, new Date(now.getTime() - WEEKS * 7 * 86_400_000));
  const weekDay = parisDay(weekAgo);
  const recent = activity.filter((r) => r.day > weekDay);

  const detailed = await deps.db
    .select({ createdAt: quizAttempts.createdAt, reponses: quizAttempts.reponses, body: contents.body, chapitre: contents.chapitre })
    .from(quizAttempts)
    .innerJoin(contents, eq(contents.id, quizAttempts.contentId))
    .where(and(eq(quizAttempts.userId, apprenti.id), gte(quizAttempts.createdAt, new Date(now.getTime() - PROGRESS_DAYS * 86_400_000))))
    .orderBy(asc(quizAttempts.createdAt));

  return {
    pseudo: apprenti.pseudo,
    semaine: {
      secondes: recent.reduce((s, r) => s + r.secondes, 0),
      joursActifs: recent.filter((r) => r.secondes > 0).length,
      exercices: weekConvs.length,
      exercicesResolus: weekConvs.filter((c) => c.resolu).length,
      quiz: weekAttempts.length,
      moyenneQuiz: weekTotal ? Math.round((weekAttempts.reduce((s, a) => s + a.score, 0) / weekTotal) * 100) / 100 : null,
    },
    semaines: weeklySeries(activity, parisDay(now), WEEKS),
    chapitres: input ? chapterStats(input, apprenti.id) : [],
    aRevoir: questionsToReview(detailed),
  };
}

/** Fiche de suivi d'un apprenti, pour le formateur de sa classe uniquement. */
export async function getApprentiProgressForFormateur(deps: AppDeps, formateur: User, classId: string, apprentiId: string) {
  const cls = await getOwnedClass(deps, formateur, classId);
  if (!z.string().uuid().safeParse(apprentiId).success) throw notFound('Apprenti introuvable.');
  const [row] = await deps.db
    .select({ id: users.id, pseudo: users.pseudo })
    .from(classMembers)
    .innerJoin(users, eq(users.id, classMembers.userId))
    .where(and(eq(classMembers.classId, cls.id), eq(classMembers.userId, apprentiId)))
    .limit(1);
  if (!row) throw notFound('Apprenti introuvable.');
  return computeProgress(deps, row);
}
