import { Router, type RequestHandler } from 'express';
import {
  apprentiLoginSchema,
  apprentiRegisterSchema,
  changePinSchema,
  classCheckSchema,
  magicLinkRequestSchema,
  magicLinkVerifySchema,
  type ClassCheckResult,
} from '@mathsuivi/shared';
import type { AppDeps } from '../../deps.js';
import { parseBody } from '../../lib/http.js';
import { buildMe } from '../privacy/service.js';
import { endSession, requireRole, startSession } from './session.js';
import {
  changePin,
  findOpenClass,
  loginApprenti,
  registerApprenti,
  requestMagicLink,
  verifyMagicLink,
} from './service.js';

export function authRouter(deps: AppDeps, limiter: RequestHandler) {
  const router = Router();

  router.post('/formateur/lien', limiter, async (req, res) => {
    const { email } = parseBody(magicLinkRequestSchema, req.body);
    const { devLink } = await requestMagicLink(deps, email);
    res.json({
      message: 'Si cette adresse est autorisée, un lien de connexion vient d’être envoyé.',
      ...(devLink && { devLink }),
    });
  });

  router.post('/formateur/verifier', limiter, async (req, res) => {
    const { token } = parseBody(magicLinkVerifySchema, req.body);
    const user = await verifyMagicLink(deps, token);
    await startSession(deps, res, user.id);
    res.json(await buildMe(deps, user));
  });

  router.post('/apprenti/classe', limiter, async (req, res) => {
    const { code } = parseBody(classCheckSchema, req.body);
    const cls = await findOpenClass(deps, code);
    const result: ClassCheckResult = { nom: cls.nom, metier: cls.metier, niveau: cls.niveau };
    res.json(result);
  });

  router.post('/apprenti/inscription', limiter, async (req, res) => {
    const input = parseBody(apprentiRegisterSchema, req.body);
    const user = await registerApprenti(deps, input);
    await startSession(deps, res, user.id);
    res.status(201).json(await buildMe(deps, user));
  });

  router.post('/apprenti/connexion', limiter, async (req, res) => {
    const input = parseBody(apprentiLoginSchema, req.body);
    const user = await loginApprenti(deps, input);
    await startSession(deps, res, user.id);
    res.json(await buildMe(deps, user));
  });

  router.post('/pin', requireRole('apprenti'), async (req, res) => {
    const input = parseBody(changePinSchema, req.body);
    await changePin(deps, req.user!, req.sessionId!, input);
    res.status(204).end();
  });

  router.post('/deconnexion', async (req, res) => {
    await endSession(deps, req, res);
    res.status(204).end();
  });

  return router;
}
