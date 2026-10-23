import { Router, type Response } from 'express';
import { sendMessageSchema, startConversationSchema, type TutorStreamEvent } from '@mathsuivi/shared';
import type { AppDeps } from '../../deps.js';
import type { Conversation, User } from '../../db/schema.js';
import { consumeDailyMessage, getDailyUsage } from '../../llm/journal.js';
import { HttpError, parseBody } from '../../lib/http.js';
import { requireRole } from '../auth/session.js';
import {
  assertIaAllowed,
  createConversation,
  deleteConversation,
  getConversationDetail,
  getOwnConversation,
  listConversations,
  runTurn,
  toQuota,
  toSummary,
  type TurnRequest,
} from './service.js';

/** Ouvre un flux SSE ; l'IA est arrêtée si l'apprenti ferme la page. */
function openStream(res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  const emit = (event: TutorStreamEvent) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  return { emit, signal: controller.signal, end: () => res.end() };
}

export function tutorRouter(deps: AppDeps) {
  const router = Router();
  router.use(requireRole('apprenti'));

  /** Réserve un message dans la limite du jour, ou répond 429 avant d'ouvrir le flux. */
  async function reserve(user: User) {
    const quota = await consumeDailyMessage(deps.db, user.id, deps.env.DAILY_MESSAGE_LIMIT);
    if (!quota.allowed) {
      throw new HttpError(429, `Tu as utilisé tes ${quota.limit} messages d’aujourd’hui. Bravo pour ton travail ! Reviens demain.`);
    }
    return quota;
  }

  async function stream(res: Response, user: User, conv: Conversation, turn: TurnRequest, isNew: boolean) {
    const quota = await reserve(user);
    const { emit, signal, end } = openStream(res);
    if (isNew) emit({ type: 'debut', conversation: toSummary(conv) });
    try {
      await runTurn(deps, user, conv, turn, quota, emit, signal);
    } catch (err) {
      console.error('[tuteur] erreur inattendue :', (err as Error)?.message);
      emit({ type: 'erreur', message: 'Oups, une erreur est survenue. Réessaie dans un instant.' });
    } finally {
      end();
    }
  }

  router.get('/quota', async (req, res) => {
    res.json(toQuota(await getDailyUsage(deps.db, req.user!.id, deps.env.DAILY_MESSAGE_LIMIT)));
  });

  router.get('/conversations', async (req, res) => {
    res.json(await listConversations(deps, req.user!));
  });

  /** Nouvel exercice : crée la conversation et streame la première réponse. */
  router.post('/conversations', async (req, res) => {
    const user = req.user!;
    await assertIaAllowed(deps, user);
    const { enonce } = parseBody(startConversationSchema, req.body);
    await getDailyUsage(deps.db, user.id, deps.env.DAILY_MESSAGE_LIMIT).then((q) => {
      if (!q.allowed) throw new HttpError(429, `Tu as utilisé tes ${q.limit} messages d’aujourd’hui. Reviens demain.`);
    });
    const conv = await createConversation(deps, user, enonce);
    await stream(res, user, conv, { texte: conv.enonce, demandeIndice: false, premier: true }, true);
  });

  router.get('/conversations/:id', async (req, res) => {
    res.json(await getConversationDetail(deps, req.user!, req.params.id));
  });

  router.post('/conversations/:id/messages', async (req, res) => {
    const user = req.user!;
    await assertIaAllowed(deps, user);
    const { contenu, demandeIndice } = parseBody(sendMessageSchema, req.body);
    const conv = await getOwnConversation(deps, user, req.params.id);
    await stream(res, user, conv, { texte: contenu, demandeIndice: !!demandeIndice, premier: false }, false);
  });

  router.delete('/conversations/:id', async (req, res) => {
    await deleteConversation(deps, req.user!, req.params.id);
    res.status(204).end();
  });

  return router;
}
