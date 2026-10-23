import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Chapitre, ClassDashboard, Periode, Quiz, QuizResults } from '@mathsuivi/shared';
import type { AppDeps } from '../../deps.js';
import { classMembers, contents, conversations, moderationEvents, quizAttempts, users, type User } from '../../db/schema.js';
import { badRequest } from '../../lib/http.js';
import { getOwnedClass } from '../classes/service.js';
import { getContent } from '../contents/service.js';
import { computeDashboard, type DashboardInput } from './compute.js';

/**
 * Données d'une classe sur la période, sans aucun contenu de conversation :
 * le formateur voit des compteurs et des taux, jamais ce que l'apprenti a écrit.
 */
export async function loadDashboardInput(
  deps: AppDeps,
  classId: string,
  periode: Periode,
  now = new Date(),
): Promise<DashboardInput> {
  const { db } = deps;
  const since = new Date(now.getTime() - periode * 24 * 60 * 60 * 1000);
  const members = await db
    .select({ id: users.id, pseudo: users.pseudo, lastSeenAt: users.lastSeenAt })
    .from(classMembers)
    .innerJoin(users, eq(users.id, classMembers.userId))
    .where(eq(classMembers.classId, classId))
    .orderBy(classMembers.pseudoKey);
  const ids = members.map((m) => m.id);

  const convs = ids.length
    ? await db
        .select({
          userId: conversations.userId,
          chapitre: conversations.chapitre,
          niveauIndice: conversations.niveauIndice,
          resoluLe: conversations.resoluLe,
          updatedAt: conversations.updatedAt,
        })
        .from(conversations)
        .where(
          and(
            inArray(conversations.userId, ids),
            gte(conversations.updatedAt, since),
            // Une conversation sans aucun échange (ex. créée avant une panne) ne compte pas.
            sql`exists (select 1 from messages m where m.conversation_id = ${conversations.id})`,
          ),
        )
    : [];

  const attempts = ids.length
    ? await db
        .select({
          userId: quizAttempts.userId,
          contentId: quizAttempts.contentId,
          chapitre: contents.chapitre,
          score: quizAttempts.score,
          total: quizAttempts.total,
        })
        .from(quizAttempts)
        .innerJoin(contents, eq(contents.id, quizAttempts.contentId))
        .where(and(inArray(quizAttempts.userId, ids), eq(contents.classId, classId), gte(quizAttempts.createdAt, since)))
    : [];

  const cheatCounts = ids.length
    ? await db
        .select({ userId: moderationEvents.userId, n: count() })
        .from(moderationEvents)
        .where(and(inArray(moderationEvents.userId, ids), eq(moderationEvents.categorie, 'triche'), gte(moderationEvents.createdAt, since)))
        .groupBy(moderationEvents.userId)
    : [];

  const quizContents = await db
    .select({ id: contents.id, titre: contents.titre, chapitre: contents.chapitre, publishedAt: contents.publishedAt })
    .from(contents)
    .where(and(eq(contents.classId, classId), eq(contents.type, 'quiz')))
    .orderBy(desc(contents.createdAt));

  return {
    periode,
    now,
    members,
    conversations: convs.map((c) => ({ ...c, resolu: c.resoluLe !== null })),
    attempts,
    cheatCounts,
    quizContents: quizContents.map((q) => ({ id: q.id, titre: q.titre, chapitre: q.chapitre, publie: q.publishedAt !== null })),
  };
}

export async function getClassDashboard(deps: AppDeps, user: User, classId: string, periode: Periode): Promise<ClassDashboard> {
  const cls = await getOwnedClass(deps, user, classId);
  return computeDashboard(await loadDashboardInput(deps, cls.id, periode));
}

/** Résultats détaillés d'un quiz : réussite par question et erreur la plus fréquente. */
export async function getQuizResults(deps: AppDeps, user: User, contentId: string): Promise<QuizResults> {
  const content = await getContent(deps, user, contentId);
  if (content.type !== 'quiz') throw badRequest('Ce contenu n’est pas un quiz.');
  const quiz = content.body as Quiz;

  const rows = await deps.db
    .select({
      userId: quizAttempts.userId,
      pseudo: users.pseudo,
      score: quizAttempts.score,
      total: quizAttempts.total,
      reponses: quizAttempts.reponses,
      createdAt: quizAttempts.createdAt,
    })
    .from(quizAttempts)
    .innerJoin(users, eq(users.id, quizAttempts.userId))
    .where(eq(quizAttempts.contentId, content.id))
    .orderBy(quizAttempts.createdAt);

  const questions = quiz.questions.map((q, index) => {
    // Réponses rapprochées par énoncé : une question retirée après coup ne décale pas les autres.
    const answers = rows
      .map((r) => {
        const stored = r.reponses as StoredAnswer[];
        // Anciennes tentatives sans énoncé : lues par position, seulement si le quiz n'a pas changé de taille.
        if (stored.every((a) => a.enonce === undefined)) return stored.length === quiz.questions.length ? stored[index] : undefined;
        return stored.find((a) => a.enonce === q.enonce);
      })
      .filter((a): a is StoredAnswer => !!a && a.reponse >= -1 && a.reponse < q.choix.length);
    const wrong = new Map<number, number>();
    for (const a of answers) if (!a.correct && a.reponse >= 0) wrong.set(a.reponse, (wrong.get(a.reponse) ?? 0) + 1);
    const [choix, fois] = [...wrong.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    return {
      index,
      enonce: q.enonce,
      bonneReponse: q.choix[q.bonne_reponse]!,
      reponses: answers.length,
      reussite: answers.length ? Math.round((answers.filter((a) => a.correct).length / answers.length) * 100) / 100 : null,
      erreurFrequente: choix !== undefined ? { choix: q.choix[choix]!, fois: fois! } : null,
    };
  });

  const byUser = new Map<string, QuizResults['apprentis'][number]>();
  for (const r of rows) {
    const cur = byUser.get(r.userId);
    byUser.set(r.userId, {
      id: r.userId,
      pseudo: r.pseudo,
      meilleurScore: Math.max(cur?.meilleurScore ?? 0, r.score),
      total: r.total,
      tentatives: (cur?.tentatives ?? 0) + 1,
      derniereTentative: r.createdAt.toISOString(),
    });
  }
  const scores = rows.reduce((s, r) => s + r.score, 0);
  const totals = rows.reduce((s, r) => s + r.total, 0);
  return {
    id: content.id,
    titre: content.titre,
    chapitre: (content.chapitre as Chapitre | null) ?? null,
    participants: byUser.size,
    moyenne: totals ? Math.round((scores / totals) * 100) / 100 : null,
    questions,
    apprentis: [...byUser.values()].sort((a, b) => a.pseudo.localeCompare(b.pseudo)),
  };
}

interface StoredAnswer {
  enonce?: string;
  reponse: number;
  correct: boolean;
}
