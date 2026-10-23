import { Router } from 'express';
import { z } from 'zod';
import { generateContentSchema, quizAttemptSchema, updateContentSchema } from '@mathsuivi/shared';
import type { AppDeps } from '../../deps.js';
import { parseBody } from '../../lib/http.js';
import { requireRole } from '../auth/session.js';
import {
  deleteContent,
  generateContent,
  getContent,
  getRevision,
  listContents,
  listRevisions,
  setPublished,
  submitQuizAttempt,
  updateContent,
} from './service.js';

/** Formateur : générer, relire, publier les fiches, quiz et cartes de la classe. */
export function contentsRouter(deps: AppDeps) {
  const router = Router();
  router.use(requireRole('formateur', 'admin'));

  router.get('/', async (req, res) => {
    const { classId } = parseBody(z.object({ classId: z.string() }), req.query);
    res.json(await listContents(deps, req.user!, classId));
  });

  router.post('/generer', async (req, res) => {
    const input = parseBody(generateContentSchema, req.body);
    res.status(201).json(await generateContent(deps, req.user!, input));
  });

  router.get('/:id', async (req, res) => {
    res.json(await getContent(deps, req.user!, req.params.id));
  });

  router.patch('/:id', async (req, res) => {
    const input = parseBody(updateContentSchema, req.body);
    res.json(await updateContent(deps, req.user!, req.params.id, input));
  });

  router.post('/:id/publication', async (req, res) => {
    const { publie } = parseBody(z.object({ publie: z.boolean() }), req.body);
    res.json(await setPublished(deps, req.user!, req.params.id, publie));
  });

  router.delete('/:id', async (req, res) => {
    await deleteContent(deps, req.user!, req.params.id);
    res.status(204).end();
  });

  return router;
}

/** Apprenti : réviser avec les contenus publiés pour sa classe. */
export function revisionsRouter(deps: AppDeps) {
  const router = Router();
  router.use(requireRole('apprenti'));

  router.get('/', async (req, res) => {
    res.json(await listRevisions(deps, req.user!));
  });

  router.get('/:id', async (req, res) => {
    res.json(await getRevision(deps, req.user!, req.params.id));
  });

  router.post('/:id/tentatives', async (req, res) => {
    const input = parseBody(quizAttemptSchema, req.body);
    res.status(201).json(await submitQuizAttempt(deps, req.user!, req.params.id, input));
  });

  return router;
}
