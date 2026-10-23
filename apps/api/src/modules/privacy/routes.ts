import { Router } from 'express';
import { consentUpdateSchema, deleteAccountSchema, updateProfileSchema } from '@mathsuivi/shared';
import { eq } from 'drizzle-orm';
import type { AppDeps } from '../../deps.js';
import { users } from '../../db/schema.js';
import { conflict, forbidden, parseBody } from '../../lib/http.js';
import { endSession, requireRole } from '../auth/session.js';
import { countApprentisInClasses } from '../classes/service.js';
import { buildMe, deleteUser, exportUserData, updateOwnIaConsent } from './service.js';

export function meRouter(deps: AppDeps) {
  const router = Router();
  router.use(requireRole());

  router.get('/', async (req, res) => {
    res.json(await buildMe(deps, req.user!));
  });

  // Les apprentis gardent le pseudo unique de leur classe ; seuls les formateurs le modifient ici.
  router.patch('/', async (req, res) => {
    if (req.user!.role === 'apprenti') throw forbidden();
    const { pseudo } = parseBody(updateProfileSchema, req.body);
    const [user] = await deps.db.update(users).set({ pseudo }).where(eq(users.id, req.user!.id)).returning();
    res.json(await buildMe(deps, user!));
  });

  router.post('/consentements', async (req, res) => {
    const { accord } = parseBody(consentUpdateSchema, req.body);
    await updateOwnIaConsent(deps, req.user!, accord);
    res.json(await buildMe(deps, req.user!));
  });

  router.get('/export', async (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="mes-donnees-coach-maths.json"');
    res.json(await exportUserData(deps, req.user!));
  });

  router.delete('/', async (req, res) => {
    parseBody(deleteAccountSchema, req.body);
    // Sinon les comptes de ses apprentis resteraient sans classe, donc inaccessibles et non supprimables.
    if (req.user!.role !== 'apprenti' && (await countApprentisInClasses(deps, req.user!.id)) > 0) {
      throw conflict('Supprimez d’abord vos classes (et les comptes de leurs apprentis).');
    }
    await endSession(deps, req, res);
    await deleteUser(deps, req.user!.id);
    res.status(204).end();
  });

  return router;
}
