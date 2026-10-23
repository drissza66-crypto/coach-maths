import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg);
export const unauthorized = (msg = 'Connecte-toi pour continuer.') => new HttpError(401, msg);
export const forbidden = (msg = 'Accès refusé.') => new HttpError(403, msg);
export const notFound = (msg = 'Introuvable.') => new HttpError(404, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

export function parseBody<S extends ZodTypeAny>(schema: S, body: unknown): z.output<S> {
  return schema.parse(body ?? {});
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: err.issues[0]?.message ?? 'Données invalides.' });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Données invalides.' });
    return;
  }
  // Aucun contenu utilisateur dans les logs : seulement le type d'erreur.
  console.error('[api] erreur inattendue :', err?.name ?? 'Error', err?.message);
  res.status(500).json({ error: 'Oups, une erreur est survenue. Réessaie dans un instant.' });
};

/**
 * Bloque les requêtes d'écriture venant d'un autre site (protection CSRF,
 * en plus du cookie SameSite=Lax).
 */
export function sameOrigin(allowedOrigin: string): RequestHandler {
  const allowed = new URL(allowedOrigin).origin;
  return (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin && origin !== allowed) return next(forbidden('Origine non autorisée.'));
    next();
  };
}
