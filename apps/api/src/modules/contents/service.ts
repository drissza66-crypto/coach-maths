import { randomInt } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, max } from 'drizzle-orm';
import { z } from 'zod';
import {
  CHAPITRE_LABELS,
  CONTENT_SCHEMAS,
  METIER_LABELS,
  NIVEAU_LABELS,
  plainTextDeep,
  type Chapitre,
  type ContentBody,
  type ContentDetail,
  type ContentSummary,
  type ContentType,
  type Fiche,
  type Flashcards,
  type GenerateContentInput,
  type Quiz,
  type QuizCorrection,
  type RevisionDetail,
  type RevisionItem,
} from '@mathsuivi/shared';
import type { AppDeps } from '../../deps.js';
import { classMembers, contents, documentChunks, quizAttempts, type ContentRow, type User } from '../../db/schema.js';
import { LLMError } from '../../llm/errors.js';
import { consumeDailyMessage, refundDailyMessage } from '../../llm/journal.js';
import { renderPrompt } from '../../llm/prompts.js';
import { HttpError, badRequest, notFound } from '../../lib/http.js';
import { getOwnedClass } from '../classes/service.js';
import { getOwnedDocument } from '../documents/service.js';
import { classifyByKeywords } from '../tutor/orchestrator.js';
import { demoContent } from './demo.js';

const uuid = z.string().uuid();
const DEFAULT_COUNT: Record<ContentType, number> = { fiche: 1, quiz: 6, flashcards: 8 };
const MAX_SOURCE_CHARS = 12_000;

export function countItems(type: ContentType, body: ContentBody): number {
  if (type === 'quiz') return (body as Quiz).questions.length;
  if (type === 'flashcards') return (body as Flashcards).cartes.length;
  return (body as Fiche).points_cles.length;
}

function toSummary(c: ContentRow): ContentSummary {
  return {
    id: c.id,
    type: c.type,
    titre: c.titre,
    chapitre: (c.chapitre as Chapitre | null) ?? null,
    notion: c.notion,
    publie: c.publishedAt !== null,
    nbElements: countItems(c.type, c.body as ContentBody),
    source: c.sourceTitre,
    creeLe: c.createdAt.toISOString(),
  };
}

const toDetail = (c: ContentRow): ContentDetail => ({ ...toSummary(c), body: c.body as ContentBody });

/** Typographie française : espace insécable avant ? ! : ; » (le « ? » ne passe pas seul à la ligne). */
export function frenchSpacing<T>(body: T): T {
  return JSON.parse(JSON.stringify(body).replace(/ ([?!:;»])/g, ' $1').replace(/« /g, '« '));
}

/** Les modèles placent souvent la bonne réponse en premier : on mélange les choix. */
export function shuffleQuiz(quiz: Quiz): Quiz {
  return {
    ...quiz,
    questions: quiz.questions.map((q) => {
      const order = [0, 1, 2, 3];
      for (let i = order.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      return { ...q, choix: order.map((i) => q.choix[i]!), bonne_reponse: order.indexOf(q.bonne_reponse) };
    }),
  };
}

// ── Formateur ────────────────────────────────────────────────────────────────

/**
 * Génère une fiche, un quiz ou des cartes à partir d'un cours importé ou d'une notion.
 * Le résultat est un brouillon : le formateur le relit avant de le publier.
 */
export async function generateContent(deps: AppDeps, user: User, input: GenerateContentInput): Promise<ContentDetail> {
  const cls = await getOwnedClass(deps, user, input.classId);

  let source = '';
  let sourceTitre: string | null = null;
  let sourceDocumentId: string | null = null;
  if (input.documentId) {
    const doc = await getOwnedDocument(deps, user, input.documentId);
    if (doc.classId !== cls.id) throw notFound('Document introuvable.');
    const chunks = await deps.db
      .select({ contenu: documentChunks.contenu })
      .from(documentChunks)
      .where(eq(documentChunks.documentId, doc.id))
      .orderBy(documentChunks.idx);
    source = chunks.map((c) => c.contenu).join('\n\n').slice(0, MAX_SOURCE_CHARS);
    sourceTitre = doc.titre;
    sourceDocumentId = doc.id;
  }
  const notion = input.notion?.trim() || sourceTitre || 'notion du cours';
  const chapitre = input.chapitre ?? classifyByKeywords(`${notion} ${source.slice(0, 2000)}`).chapitre;
  const nombre = input.nombre ?? DEFAULT_COUNT[input.type];

  const quota = await consumeDailyMessage(deps.db, user.id, deps.env.GENERATION_DAILY_LIMIT);
  if (!quota.allowed) {
    throw new HttpError(429, `Limite de ${quota.limit} générations par jour atteinte. Réessayez demain.`);
  }

  let body: ContentBody;
  try {
    if (deps.llm.primary.name === 'mock') {
      body = demoContent(input.type, nombre);
    } else {
      const prompt = renderPrompt(`generate.${input.type}`, {
        niveau: NIVEAU_LABELS[cls.niveau],
        metier: METIER_LABELS[cls.metier],
        chapitre: CHAPITRE_LABELS[chapitre],
        notion,
        source: source || '(aucun cours fourni : appuie-toi sur le programme de mathématiques du CAP)',
        consignes: input.consignes?.trim() || '(aucune)',
        nombre,
      });
      const schema = CONTENT_SCHEMAS[input.type] as z.ZodType<ContentBody, z.ZodTypeDef, unknown>;
      body = (await deps.llm.generate(prompt, schema, { userId: user.id, purpose: 'generate' })).data;
    }
  } catch (err) {
    await refundDailyMessage(deps.db, user.id);
    if (err instanceof LLMError) {
      throw new HttpError(503, 'La génération a échoué (service d’IA indisponible ou réponse invalide). Réessayez dans un instant.');
    }
    throw err;
  }
  if (input.type === 'quiz') body = shuffleQuiz(body as Quiz);
  // LaTeX ou Markdown éventuels → texte lisible, avant la typographie française.
  body = frenchSpacing(plainTextDeep(body));

  const [row] = await deps.db
    .insert(contents)
    .values({
      authorId: user.id,
      classId: cls.id,
      sourceDocumentId,
      sourceTitre,
      type: input.type,
      chapitre,
      notion,
      titre: body.titre,
      body,
    })
    .returning();
  return toDetail(row!);
}

export async function listContents(deps: AppDeps, user: User, classId: string): Promise<ContentSummary[]> {
  const cls = await getOwnedClass(deps, user, classId);
  const rows = await deps.db.select().from(contents).where(eq(contents.classId, cls.id)).orderBy(desc(contents.createdAt));
  return rows.map(toSummary);
}

async function getOwnedContent(deps: AppDeps, user: User, id: string): Promise<ContentRow> {
  if (!uuid.safeParse(id).success) throw notFound('Contenu introuvable.');
  const [row] = await deps.db.select().from(contents).where(eq(contents.id, id)).limit(1);
  if (!row) throw notFound('Contenu introuvable.');
  await getOwnedClass(deps, user, row.classId).catch(() => {
    throw notFound('Contenu introuvable.');
  });
  return row;
}

export async function getContent(deps: AppDeps, user: User, id: string): Promise<ContentDetail> {
  return toDetail(await getOwnedContent(deps, user, id));
}

/** Relecture : nouveau titre et/ou contenu corrigé, revalidé par le schéma du type. */
export async function updateContent(deps: AppDeps, user: User, id: string, input: { titre?: string; body?: unknown }) {
  const row = await getOwnedContent(deps, user, id);
  let body = (input.body === undefined ? row.body : CONTENT_SCHEMAS[row.type].parse(input.body)) as ContentBody;
  if (input.titre) body = { ...body, titre: input.titre };
  const [updated] = await deps.db
    .update(contents)
    .set({ titre: body.titre, body, updatedAt: new Date() })
    .where(eq(contents.id, row.id))
    .returning();
  return toDetail(updated!);
}

export async function setPublished(deps: AppDeps, user: User, id: string, publie: boolean) {
  const row = await getOwnedContent(deps, user, id);
  const [updated] = await deps.db
    .update(contents)
    .set({ publishedAt: publie ? (row.publishedAt ?? new Date()) : null, updatedAt: new Date() })
    .where(eq(contents.id, row.id))
    .returning();
  return toDetail(updated!);
}

export async function deleteContent(deps: AppDeps, user: User, id: string) {
  const row = await getOwnedContent(deps, user, id);
  await deps.db.delete(contents).where(eq(contents.id, row.id));
}

// ── Apprenti ─────────────────────────────────────────────────────────────────

async function classIdsOf(deps: AppDeps, userId: string) {
  const rows = await deps.db.select({ id: classMembers.classId }).from(classMembers).where(eq(classMembers.userId, userId));
  return rows.map((r) => r.id);
}

export async function listRevisions(deps: AppDeps, user: User): Promise<RevisionItem[]> {
  const ids = await classIdsOf(deps, user.id);
  if (!ids.length) return [];
  const rows = await deps.db
    .select()
    .from(contents)
    .where(and(inArray(contents.classId, ids), isNotNull(contents.publishedAt)))
    .orderBy(desc(contents.publishedAt));
  const best = await deps.db
    .select({ contentId: quizAttempts.contentId, score: max(quizAttempts.score), total: max(quizAttempts.total) })
    .from(quizAttempts)
    .where(eq(quizAttempts.userId, user.id))
    .groupBy(quizAttempts.contentId);
  const bestById = new Map(best.map((b) => [b.contentId, b]));
  return rows.map((c) => {
    const b = bestById.get(c.id);
    return {
      id: c.id,
      type: c.type,
      titre: c.titre,
      chapitre: (c.chapitre as Chapitre | null) ?? null,
      nbElements: countItems(c.type, c.body as ContentBody),
      publieLe: c.publishedAt!.toISOString(),
      meilleurScore: b ? { score: b.score ?? 0, total: b.total ?? 0 } : null,
    };
  });
}

/** Contenu publié dans une classe de l'apprenti, sinon 404 (un brouillon n'existe pas pour lui). */
async function getPublishedForApprenti(deps: AppDeps, user: User, id: string): Promise<ContentRow> {
  if (!uuid.safeParse(id).success) throw notFound('Contenu introuvable.');
  const ids = await classIdsOf(deps, user.id);
  const [row] = ids.length
    ? await deps.db
        .select()
        .from(contents)
        .where(and(eq(contents.id, id), inArray(contents.classId, ids), isNotNull(contents.publishedAt)))
        .limit(1)
    : [];
  if (!row) throw notFound('Contenu introuvable.');
  return row;
}

export async function getRevision(deps: AppDeps, user: User, id: string): Promise<RevisionDetail> {
  const row = await getPublishedForApprenti(deps, user, id);
  const base = { id: row.id, type: row.type, titre: row.titre, chapitre: (row.chapitre as Chapitre | null) ?? null };
  if (row.type !== 'quiz') return { ...base, body: row.body as Fiche | Flashcards };
  // Les bonnes réponses restent sur le serveur jusqu'à la correction.
  const quiz = row.body as Quiz;
  return { ...base, body: { titre: quiz.titre, questions: quiz.questions.map((q) => ({ enonce: q.enonce, choix: q.choix })) } };
}

export async function submitQuizAttempt(
  deps: AppDeps,
  user: User,
  id: string,
  input: { reponses: number[]; dureeSecondes?: number },
): Promise<QuizCorrection> {
  const row = await getPublishedForApprenti(deps, user, id);
  if (row.type !== 'quiz') throw badRequest('Ce contenu n’est pas un quiz.');
  const quiz = row.body as Quiz;
  if (input.reponses.length !== quiz.questions.length) throw badRequest('Réponds à toutes les questions.');

  const questions = quiz.questions.map((q, i) => {
    const reponse = input.reponses[i]!;
    return {
      enonce: q.enonce,
      choix: q.choix,
      reponse,
      bonne_reponse: q.bonne_reponse,
      correct: reponse === q.bonne_reponse,
      explication: q.explication,
    };
  });
  const score = questions.filter((q) => q.correct).length;
  await deps.db.insert(quizAttempts).values({
    contentId: row.id,
    userId: user.id,
    score,
    total: questions.length,
    // L'énoncé est gardé : les statistiques restent justes si le formateur retire une question ensuite.
    reponses: questions.map((q) => ({ enonce: q.enonce, reponse: q.reponse, correct: q.correct })),
    dureeSecondes: input.dureeSecondes,
  });
  return { score, total: questions.length, questions };
}

export async function exportAttempts(deps: AppDeps, userId: string) {
  const rows = await deps.db
    .select({ titre: contents.titre, score: quizAttempts.score, total: quizAttempts.total, le: quizAttempts.createdAt })
    .from(quizAttempts)
    .innerJoin(contents, eq(contents.id, quizAttempts.contentId))
    .where(eq(quizAttempts.userId, userId));
  return rows.map((r) => ({ quiz: r.titre, score: r.score, total: r.total, le: r.le.toISOString() }));
}
