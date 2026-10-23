import { Router, type Response } from 'express';
import { sendMessageSchema, startConversationSchema, type PhotoReadResult, type TutorStreamEvent } from '@mathsuivi/shared';
import type { AppDeps } from '../../deps.js';
import { eq } from 'drizzle-orm';
import { conversations, type Conversation, type User } from '../../db/schema.js';
import { consumeDailyMessage, getDailyUsage, refundDailyMessage } from '../../llm/journal.js';
import { sniffMime } from '../documents/extract.js';
import { singleFile } from '../documents/upload.js';
import { HttpError, parseBody } from '../../lib/http.js';
import { requireRole } from '../auth/session.js';
import {
  assertIaAllowed,
  createConversation,
  deleteConversation,
  getConversationDetail,
  getOwnConversation,
  listConversations,
  readExercisePhoto,
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
    let ok = false;
    try {
      ok = await runTurn(deps, user, conv, turn, quota, emit, signal);
    } catch (err) {
      console.error('[tuteur] erreur inattendue :', (err as Error)?.message);
      emit({ type: 'erreur', message: 'Oups, une erreur est survenue. Réessaie dans un instant.' });
    } finally {
      // Premier message sans réponse : on ne garde pas une conversation vide.
      if (isNew && !ok) await deps.db.delete(conversations).where(eq(conversations.id, conv.id)).catch(() => undefined);
      end();
    }
  }

  /** Photo d'un énoncé → texte, que l'apprenti vérifie avant de commencer. */
  router.post('/photo', singleFile('photo', deps.env.UPLOAD_MAX_MB), async (req, res) => {
    const user = req.user!;
    await assertIaAllowed(deps, user);
    if (!req.file?.buffer.length) throw new HttpError(400, 'Choisis une photo.');
    const mime = sniffMime(req.file.buffer);
    if (!mime || mime === 'application/pdf') {
      throw new HttpError(415, 'Envoie une photo (JPEG, PNG ou WebP).');
    }
    const quota = await reserve(user);
    try {
      const texte = await readExercisePhoto(deps, user, { data: req.file.buffer, mimeType: mime });
      const result: PhotoReadResult = { texte, quota: toQuota(quota) };
      res.json(result);
    } catch (err) {
      await refundDailyMessage(deps.db, user.id);
      throw err;
    }
  });

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
