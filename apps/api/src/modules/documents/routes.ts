import { Router } from 'express';
import { z } from 'zod';
import { documentUploadSchema } from '@mathsuivi/shared';
import type { AppDeps } from '../../deps.js';
import { parseBody } from '../../lib/http.js';
import { requireRole } from '../auth/session.js';
import { deleteDocument, getDocumentDetail, importCourse, listDocuments, readDocumentFile } from './service.js';
import { singleFile } from './upload.js';

/** Cours de la classe, importés par le formateur. */
export function documentsRouter(deps: AppDeps) {
  const router = Router();
  router.use(requireRole('formateur', 'admin'));

  router.get('/', async (req, res) => {
    const { classId } = parseBody(z.object({ classId: z.string() }), req.query);
    res.json(await listDocuments(deps, req.user!, classId));
  });

  router.post('/', singleFile('fichier', deps.env.UPLOAD_MAX_MB), async (req, res) => {
    const input = parseBody(documentUploadSchema, req.body);
    res.status(201).json(await importCourse(deps, req.user!, input, req.file));
  });

  router.get('/:id', async (req, res) => {
    res.json(await getDocumentDetail(deps, req.user!, req.params.id));
  });

  router.get('/:id/fichier', async (req, res) => {
    const { doc, data } = await readDocumentFile(deps, req.user!, req.params.id);
    res.setHeader('Content-Type', doc.mime);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(doc.nomFichier)}`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(data);
  });

  router.delete('/:id', async (req, res) => {
    await deleteDocument(deps, req.user!, req.params.id);
    res.status(204).end();
  });

  return router;
}
