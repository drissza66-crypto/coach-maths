import { Router } from 'express';
import type { LLMStatus } from '@mathsuivi/shared';
import type { AppDeps } from '../../deps.js';
import { requireRole } from '../auth/session.js';

/** État du fournisseur d'IA, pour le formateur (jamais de clé ni d'adresse). */
export function llmRouter(deps: AppDeps) {
  const router = Router();

  router.get('/etat', requireRole('formateur', 'admin'), (_req, res) => {
    const { primary, fallback } = deps.llm;
    const status: LLMStatus = {
      fournisseur: primary.name,
      modele: primary.model,
      repli: fallback ? { fournisseur: fallback.name, modele: fallback.model } : null,
      modeDemo: primary.name === 'mock',
      limiteQuotidienne: deps.env.DAILY_MESSAGE_LIMIT,
    };
    res.json(status);
  });

  return router;
}
