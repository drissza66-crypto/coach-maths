import { Router } from 'express';
import { z } from 'zod';
import { classCreateSchema, classUpdateSchema, deleteAccountSchema } from '@mathsuivi/shared';
import type { AppDeps } from '../../deps.js';
import { parseBody } from '../../lib/http.js';
import { requireRole } from '../auth/session.js';
import {
  createClass,
  deleteApprenti,
  deleteClass,
  getClassDetail,
  listClasses,
  recordParentalConsent,
  regenerateCode,
  resetApprentiPin,
  updateClass,
} from './service.js';

const parentalConsentSchema = z.object({ accord: z.boolean() });

export function classesRouter(deps: AppDeps) {
  const router = Router();
  router.use(requireRole('formateur', 'admin'));

  router.get('/', async (req, res) => {
    res.json(await listClasses(deps, req.user!));
  });

  router.post('/', async (req, res) => {
    const input = parseBody(classCreateSchema, req.body);
    res.status(201).json(await createClass(deps, req.user!, input));
  });

  router.get('/:id', async (req, res) => {
    res.json(await getClassDetail(deps, req.user!, req.params.id));
  });

  router.patch('/:id', async (req, res) => {
    const input = parseBody(classUpdateSchema, req.body);
    res.json(await updateClass(deps, req.user!, req.params.id, input));
  });

  router.delete('/:id', async (req, res) => {
    parseBody(deleteAccountSchema, req.body);
    await deleteClass(deps, req.user!, req.params.id);
    res.status(204).end();
  });

  router.post('/:id/code', async (req, res) => {
    res.json(await regenerateCode(deps, req.user!, req.params.id));
  });

  router.post('/:id/apprentis/:apprentiId/pin', async (req, res) => {
    res.json(await resetApprentiPin(deps, req.user!, req.params.id, req.params.apprentiId));
  });

  router.post('/:id/apprentis/:apprentiId/accord-parental', async (req, res) => {
    const { accord } = parseBody(parentalConsentSchema, req.body);
    res.json(await recordParentalConsent(deps, req.user!, req.params.id, req.params.apprentiId, accord));
  });

  router.delete('/:id/apprentis/:apprentiId', async (req, res) => {
    await deleteApprenti(deps, req.user!, req.params.id, req.params.apprentiId);
    res.status(204).end();
  });

  return router;
}
