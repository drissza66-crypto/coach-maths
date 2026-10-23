import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { CourseDocument, CourseDocumentDetail } from '@mathsuivi/shared';
import type { AppDeps } from '../../deps.js';
import { documentChunks, documents, type DocumentRow, type User } from '../../db/schema.js';
import { createHash } from 'node:crypto';
import { HttpError, badRequest, conflict, notFound } from '../../lib/http.js';
import { getOwnedClass } from '../classes/service.js';
import { moderateInput } from '../tutor/moderation.js';
import { chunkPages, extractPdf, ocrImage, sniffMime } from './extract.js';

const uuid = z.string().uuid();

export function toCourseDocument(d: DocumentRow): CourseDocument {
  return {
    id: d.id,
    titre: d.titre,
    nomFichier: d.nomFichier,
    mime: d.mime,
    taille: d.taille,
    nbPages: d.nbPages,
    nbCaracteres: d.nbCaracteres,
    creeLe: d.createdAt.toISOString(),
    expireLe: d.expiresAt.toISOString(),
  };
}

/**
 * Nom de fichier affichable et sûr. Les navigateurs envoient le nom en UTF-8,
 * que l'analyseur multipart lit en latin-1 : « cours_Ã©tÃ©.pdf » → « cours_été.pdf ».
 */
export function safeFileName(name: string): string {
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  const decoded = utf8.includes('�') ? name : utf8;
  const base = decoded.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return (base || 'document').slice(0, 120);
}

export async function listDocuments(deps: AppDeps, user: User, classId: string): Promise<CourseDocument[]> {
  const cls = await getOwnedClass(deps, user, classId);
  const rows = await deps.db
    .select()
    .from(documents)
    .where(eq(documents.classId, cls.id))
    .orderBy(desc(documents.createdAt));
  return rows.map(toCourseDocument);
}

/** Document d'une classe du formateur connecté, sinon 404. */
export async function getOwnedDocument(deps: AppDeps, user: User, id: string): Promise<DocumentRow> {
  if (!uuid.safeParse(id).success) throw notFound('Document introuvable.');
  const [doc] = await deps.db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) throw notFound('Document introuvable.');
  await getOwnedClass(deps, user, doc.classId).catch(() => {
    throw notFound('Document introuvable.');
  });
  return doc;
}

export async function getDocumentDetail(deps: AppDeps, user: User, id: string): Promise<CourseDocumentDetail> {
  const doc = await getOwnedDocument(deps, user, id);
  const chunks = await deps.db
    .select({ contenu: documentChunks.contenu })
    .from(documentChunks)
    .where(eq(documentChunks.documentId, doc.id))
    .orderBy(documentChunks.idx)
    .limit(6);
  return { ...toCourseDocument(doc), apercu: chunks.map((c) => c.contenu).join('\n\n').slice(0, 3000) };
}

/**
 * Import d'un cours : vérification du type réel, extraction du texte (PDF ou OCR),
 * données personnelles masquées, fichier chiffré, passages indexés pour le tuteur.
 */
export async function importCourse(
  deps: AppDeps,
  user: User,
  input: { classId: string; titre: string },
  file: { buffer: Buffer; originalname: string } | undefined,
): Promise<CourseDocument> {
  if (!file?.buffer.length) throw badRequest('Choisissez un fichier.');
  const cls = await getOwnedClass(deps, user, input.classId);
  const mime = sniffMime(file.buffer);
  if (!mime) throw new HttpError(415, 'Format non accepté. Importez un PDF ou une photo (JPEG, PNG, WebP).');

  const hash = createHash('sha256').update(file.buffer).digest('hex');
  const [duplicate] = await deps.db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.classId, cls.id), eq(documents.sha256, hash)))
    .limit(1);
  if (duplicate) throw conflict('Ce document est déjà importé dans cette classe.');

  const pages =
    mime === 'application/pdf'
      ? await extractPdf(file.buffer)
      : [await ocrImage(deps.llm, { data: file.buffer, mimeType: mime }, user.id)];
  const chunks = chunkPages(pages.map((p) => moderateInput(p).texte));
  const nbCaracteres = chunks.reduce((n, c) => n + c.contenu.length, 0);

  const storageKey = await deps.files.put(file.buffer);
  try {
    const doc = await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(documents)
        .values({
          ownerId: user.id,
          classId: cls.id,
          titre: input.titre.trim(),
          nomFichier: safeFileName(file.originalname),
          mime,
          taille: file.buffer.length,
          sha256: hash,
          storageKey,
          nbPages: pages.length,
          nbCaracteres,
          expiresAt: new Date(Date.now() + deps.env.FILE_RETENTION_DAYS * 24 * 60 * 60 * 1000),
        })
        .returning();
      if (chunks.length) {
        await tx.insert(documentChunks).values(chunks.map((c, idx) => ({ documentId: row!.id, idx, ...c })));
      }
      return row!;
    });
    return toCourseDocument(doc);
  } catch (err) {
    await deps.files.remove(storageKey);
    throw err;
  }
}

export async function readDocumentFile(deps: AppDeps, user: User, id: string) {
  const doc = await getOwnedDocument(deps, user, id);
  return { doc, data: await deps.files.get(doc.storageKey) };
}

/** Supprime des documents : fichiers chiffrés d'abord, puis les lignes (et leurs passages). */
export async function removeDocuments(deps: AppDeps, rows: Pick<DocumentRow, 'id' | 'storageKey'>[]) {
  if (!rows.length) return;
  for (const r of rows) await deps.files.remove(r.storageKey);
  await deps.db.delete(documents).where(
    inArray(
      documents.id,
      rows.map((r) => r.id),
    ),
  );
}

export async function deleteDocument(deps: AppDeps, user: User, id: string) {
  await removeDocuments(deps, [await getOwnedDocument(deps, user, id)]);
}

/** Avant une suppression en cascade (compte, classe) : les fichiers ne sont pas en base. */
export async function removeFilesWhere(deps: AppDeps, where: { ownerId?: string; classId?: string }) {
  const condition = where.ownerId ? eq(documents.ownerId, where.ownerId) : eq(documents.classId, where.classId!);
  const rows = await deps.db.select({ id: documents.id, storageKey: documents.storageKey }).from(documents).where(condition);
  await removeDocuments(deps, rows);
}

/** Suppression automatique à expiration, et des fichiers sans document (reste d'une panne). */
export async function purgeDocuments(deps: AppDeps, now = new Date()) {
  const expired = await deps.db
    .select({ id: documents.id, storageKey: documents.storageKey })
    .from(documents)
    .where(lt(documents.expiresAt, now));
  await removeDocuments(deps, expired);

  const onDisk = await deps.files.list();
  if (!onDisk.length) return;
  const known = new Set(
    (await deps.db.select({ k: documents.storageKey }).from(documents)).map((r) => r.k),
  );
  const oneHourAgo = now.getTime() - 60 * 60 * 1000;
  for (const f of onDisk) {
    // Un fichier tout juste écrit peut appartenir à un import encore en cours.
    if (!known.has(f.storageKey) && f.modifiedAt.getTime() < oneHourAgo) await deps.files.remove(f.storageKey);
  }
}
