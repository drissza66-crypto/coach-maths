import { and, desc, eq, lt } from 'drizzle-orm';
import {
  METIER_LABELS,
  NIVEAU_LABELS,
  type Chapitre,
  type ConversationDetail,
  type ConversationSummary,
  type Quota,
  type TutorMessage,
  type TutorStreamEvent,
} from '@mathsuivi/shared';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { classMembers, classes, conversations, messages, moderationEvents, type Conversation, type User } from '../../db/schema.js';
import { refundDailyMessage, type DailyQuota } from '../../llm/journal.js';
import { LLMError } from '../../llm/errors.js';
import { userMessageFor } from '../../llm/user-messages.js';
import { forbidden, notFound } from '../../lib/http.js';
import { usersWithIaConsent } from '../privacy/service.js';
import { AnswerGuard } from './answer-guard.js';
import { detectCheat } from './cheat.js';
import { moderateInput } from './moderation.js';
import { buildChatMessages, classifyExercise, planTurn } from './orchestrator.js';

const uuid = z.string().uuid();

export const toQuota = (q: DailyQuota): Quota => ({ utilises: q.used, limite: q.limit, restants: Math.max(0, q.limit - q.used) });

export function toSummary(c: Conversation): ConversationSummary {
  return {
    id: c.id,
    enonce: c.enonce,
    chapitre: (c.chapitre as Chapitre | null) ?? null,
    etape: c.etape,
    niveauIndice: c.niveauIndice,
    resolue: c.resoluLe !== null,
    misAJourLe: c.updatedAt.toISOString(),
  };
}

const toMessage = (m: typeof messages.$inferSelect): TutorMessage => ({
  id: m.id,
  auteur: m.auteur,
  contenu: m.contenu,
  envoyeLe: m.createdAt.toISOString(),
});

export async function assertIaAllowed({ db }: AppDeps, user: User) {
  if (!(await usersWithIaConsent(db, [user.id])).has(user.id)) {
    throw forbidden(
      user.moinsDe15
        ? 'Le tuteur IA s’ouvrira quand ton formateur aura reçu l’accord de tes parents.'
        : 'Active d’abord le tuteur IA dans « Mes données ».',
    );
  }
}

export async function getOwnConversation({ db }: AppDeps, user: User, id: string): Promise<Conversation> {
  if (!uuid.safeParse(id).success) throw notFound('Conversation introuvable.');
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, user.id)))
    .limit(1);
  if (!conv) throw notFound('Conversation introuvable.');
  return conv;
}

export async function listConversations({ db }: AppDeps, user: User): Promise<ConversationSummary[]> {
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, user.id))
    .orderBy(desc(conversations.updatedAt))
    .limit(30);
  return rows.map(toSummary);
}

export async function getConversationDetail(deps: AppDeps, user: User, id: string): Promise<ConversationDetail> {
  const conv = await getOwnConversation(deps, user, id);
  const rows = await deps.db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conv.id))
    .orderBy(messages.createdAt);
  return { ...toSummary(conv), notion: conv.notion, messages: rows.map(toMessage) };
}

export async function deleteConversation(deps: AppDeps, user: User, id: string) {
  const conv = await getOwnConversation(deps, user, id);
  await deps.db.delete(conversations).where(eq(conversations.id, conv.id));
}

export async function createConversation(deps: AppDeps, user: User, enonceBrut: string): Promise<Conversation> {
  const enonce = moderateInput(enonceBrut).texte;
  const classification = await classifyExercise(deps.llm, enonce, user.id);
  const [conv] = await deps.db
    .insert(conversations)
    .values({
      userId: user.id,
      enonce,
      chapitre: classification.chapitre,
      notion: classification.notion,
      reponseAttendue: classification.reponse_attendue,
    })
    .returning();
  return conv!;
}

async function recordEvent({ db }: AppDeps, userId: string, conversationId: string, categorie: string) {
  await db.insert(moderationEvents).values({ userId, conversationId, categorie });
}

async function promptContext(deps: AppDeps, user: User, conv: Conversation) {
  const [cls] = await deps.db
    .select({ metier: classes.metier })
    .from(classMembers)
    .innerJoin(classes, eq(classes.id, classMembers.classId))
    .where(eq(classMembers.userId, user.id))
    .limit(1);
  const historique = await deps.db
    .select({ auteur: messages.auteur, contenu: messages.contenu })
    .from(messages)
    .where(eq(messages.conversationId, conv.id))
    .orderBy(desc(messages.createdAt))
    .limit(deps.env.CHAT_HISTORY_MESSAGES);
  return {
    niveau: user.niveau ? NIVEAU_LABELS[user.niveau] : 'CAP',
    metier: cls ? METIER_LABELS[cls.metier] : 'métiers du bâtiment',
    historique: historique.reverse(),
  };
}

export interface TurnRequest {
  texte: string;
  demandeIndice: boolean;
  premier: boolean;
}

/**
 * Un tour de conversation : modération, plan (étape, indice, consigne), appel à l'IA
 * en streaming à travers answerGuard, puis enregistrement. Les messages ne sont
 * enregistrés qu'en cas de succès : en cas de panne, l'apprenti garde son texte
 * et son message ne lui est pas décompté.
 */
export async function runTurn(
  deps: AppDeps,
  user: User,
  conv: Conversation,
  req: TurnRequest,
  quota: DailyQuota,
  emit: (event: TutorStreamEvent) => void,
  signal: AbortSignal,
) {
  const debut = new Date();
  const moderation = moderateInput(req.texte);
  const texte = moderation.texte;

  // Mal-être ou langage inadapté : réponse fixe, sans IA.
  if (moderation.reponse) {
    await recordEvent(deps, user.id, conv.id, moderation.categorie!);
    await refundDailyMessage(deps.db, user.id);
    emit({ type: 'texte', texte: moderation.reponse });
    const saved = await persist(deps, conv, texte, moderation.reponse, conv, debut);
    emit({ type: 'fin', ...saved, quota: toQuota({ ...quota, used: Math.max(0, quota.used - 1) }) });
    return;
  }

  const cheat = detectCheat(texte);
  if (cheat.triche) await recordEvent(deps, user.id, conv.id, 'triche');
  if (cheat.injection) await recordEvent(deps, user.id, conv.id, 'injection');

  const plan = planTurn(conv, { texte, demandeIndice: req.demandeIndice, premier: req.premier, signal: cheat });
  const ctx = await promptContext(deps, user, conv);
  const chat = buildChatMessages(conv, plan, ctx, texte);
  const guard = new AnswerGuard(conv.reponseAttendue, [
    conv.enonce,
    texte,
    ...ctx.historique.filter((m) => m.auteur === 'apprenti').map((m) => m.contenu),
  ]);

  let reponse = '';
  try {
    for await (const chunk of deps.llm.chat(chat, { signal, userId: user.id, purpose: 'chat' })) {
      if (chunk.type !== 'delta') continue;
      const safe = guard.push(chunk.text);
      if (safe) {
        reponse += safe;
        emit({ type: 'texte', texte: safe });
      }
    }
    const rest = guard.flush();
    if (rest) {
      reponse += rest;
      emit({ type: 'texte', texte: rest });
    }
    if (!reponse.trim()) throw new LLMError('unavailable', deps.llm.name, 'réponse vide');
  } catch (err) {
    await refundDailyMessage(deps.db, user.id);
    const { message, retryAfterSeconds } = userMessageFor(err);
    emit({ type: 'erreur', message, reessayerDans: retryAfterSeconds });
    return;
  }

  if (guard.blocked) await recordEvent(deps, user.id, conv.id, 'fuite_bloquee');
  const saved = await persist(deps, conv, texte, reponse.trim(), plan, debut);
  emit({ type: 'fin', ...saved, quota: toQuota(quota) });
}

async function persist(
  deps: AppDeps,
  conv: Conversation,
  texteApprenti: string,
  texteTuteur: string,
  state: { etape: Conversation['etape']; niveauIndice: number; resolu?: boolean; resoluLe?: Date | null },
  debut: Date,
) {
  const fin = new Date(Math.max(Date.now(), debut.getTime() + 1));
  const resolu = 'resolu' in state && state.resolu !== undefined ? state.resolu : conv.resoluLe !== null;
  return deps.db.transaction(async (tx) => {
    const [apprenti] = await tx
      .insert(messages)
      .values({ conversationId: conv.id, auteur: 'apprenti', contenu: texteApprenti, createdAt: debut })
      .returning();
    const [tuteur] = await tx
      .insert(messages)
      .values({ conversationId: conv.id, auteur: 'tuteur', contenu: texteTuteur, createdAt: fin })
      .returning();
    await tx
      .update(conversations)
      .set({
        etape: state.etape,
        niveauIndice: state.niveauIndice,
        resoluLe: resolu ? (conv.resoluLe ?? fin) : null,
        updatedAt: fin,
      })
      .where(eq(conversations.id, conv.id));
    return {
      message: toMessage(tuteur!),
      messageApprenti: toMessage(apprenti!),
      etape: state.etape,
      niveauIndice: state.niveauIndice,
      resolue: resolu,
    };
  });
}

export async function purgeOldConversations({ db, env }: AppDeps, now = new Date()) {
  const limit = new Date(now.getTime() - env.CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await db.delete(conversations).where(lt(conversations.updatedAt, limit));
}

/** Compteurs de modération (sans texte) : même durée que le journal des appels. */
export async function purgeOldModerationEvents({ db, env }: AppDeps, now = new Date()) {
  const limit = new Date(now.getTime() - env.LLM_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await db.delete(moderationEvents).where(lt(moderationEvents.createdAt, limit));
}

export async function exportConversations({ db }: AppDeps, userId: string) {
  const convs = await db.select().from(conversations).where(eq(conversations.userId, userId));
  return Promise.all(
    convs.map(async (c) => ({
      enonce: c.enonce,
      chapitre: c.chapitre,
      creeLe: c.createdAt.toISOString(),
      messages: (await db.select().from(messages).where(eq(messages.conversationId, c.id)).orderBy(messages.createdAt)).map(
        (m) => ({ auteur: m.auteur, contenu: m.contenu, envoyeLe: m.createdAt.toISOString() }),
      ),
    })),
  );
}
