import multer from 'multer';
import type { RequestHandler } from 'express';
import { HttpError } from '../../lib/http.js';

/**
 * Réception d'un seul fichier, en mémoire (jamais écrit en clair sur le disque).
 * Les erreurs de multer deviennent des messages clairs.
 */
export function singleFile(field: string, maxMb: number): RequestHandler {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1, fields: 10, fieldSize: 10_000 },
  }).single(field);

  return (req, res, next) => {
    upload(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `Fichier trop lourd (maximum ${maxMb} Mo).`));
        return next(new HttpError(400, 'Envoi du fichier invalide.'));
      }
      next(err);
    });
  };
}
