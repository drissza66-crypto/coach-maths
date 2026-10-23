import { LLMError } from './errors.js';

/**
 * Message affiché à l'apprenti quand l'IA ne répond pas.
 * Phrases courtes, pas de jargon, jamais de détail technique.
 */
export function userMessageFor(err: unknown): { message: string; retryAfterSeconds?: number } {
  const kind = err instanceof LLMError ? err.kind : 'unavailable';
  switch (kind) {
    case 'rate_limit':
      return { message: 'Le coach reçoit beaucoup de questions. Réessaie dans une minute. Ton message est gardé.', retryAfterSeconds: 60 };
    case 'quota':
      return { message: 'Le coach a atteint sa limite pour le moment. Préviens ton formateur. Ton message est gardé.' };
    case 'timeout':
    case 'unavailable':
      return { message: 'Le coach ne répond pas. Réessaie dans 2 minutes. Ton message est gardé.', retryAfterSeconds: 120 };
    case 'content_filter':
      return { message: 'Le coach ne peut pas répondre à ça. Reformule ta question sur ton exercice.' };
    case 'aborted':
      return { message: 'Réponse arrêtée.' };
    default:
      // auth, bad_request, invalid_output : problème de configuration, pas de la faute de l'apprenti.
      return { message: 'Le coach est en panne. Ton formateur est prévenu. Réessaie plus tard.' };
  }
}
