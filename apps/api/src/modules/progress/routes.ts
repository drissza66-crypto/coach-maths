import { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { requireRole } from '../auth/session.js';
import { recordActivity } from './activity.js';
import { computeProgress } from './service.js';

export function progressRouter(deps: AppDeps) {
  const router = Router();

  /** Battement d'activité envoyé chaque minute par une page visible et utilisée. */
  router.post('/activite', requireRole(), async (req, res) => {
    // Seul le temps des apprentis est suivi.
    if (req.user!.role === 'apprenti') await recordActivity(deps.db, req.user!.id);
    res.status(204).end();
  });

  router.get('/progres', requireRole('apprenti'), async (req, res) => {
    res.json(await computeProgress(deps, req.user!));
  });

  return router;
}
