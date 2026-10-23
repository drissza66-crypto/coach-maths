import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { parseBody } from '../../lib/http.js';
import { requireRole } from '../auth/session.js';
import { getClassDashboard, getQuizResults } from './service.js';
import { getApprentiProgressForFormateur } from '../progress/service.js';

const periodeSchema = z.object({
  periode: z.enum(['7', '30']).default('7').transform((p) => Number(p) as 7 | 30),
});

/** Tableau de bord du formateur : compteurs et taux, jamais le contenu des échanges. */
export function dashboardRouter(deps: AppDeps) {
  const router = Router();
  router.use(requireRole('formateur', 'admin'));

  router.get('/classes/:id', async (req, res) => {
    const { periode } = parseBody(periodeSchema, req.query);
    res.json(await getClassDashboard(deps, req.user!, req.params.id, periode));
  });

  router.get('/classes/:id/apprentis/:apprentiId', async (req, res) => {
    res.json(await getApprentiProgressForFormateur(deps, req.user!, req.params.id, req.params.apprentiId));
  });

  router.get('/quiz/:id', async (req, res) => {
    res.json(await getQuizResults(deps, req.user!, req.params.id));
  });

  return router;
}
