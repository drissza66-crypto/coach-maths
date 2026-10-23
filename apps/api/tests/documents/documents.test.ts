import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage, ImageInput, LLMProvider } from '../../src/llm/types.js';
import { MOCK_OCR_TEXT } from '../../src/llm/providers/mock.js';
import { chunkPages, sniffMime } from '../../src/modules/documents/extract.js';
import { purgeDocuments, safeFileName } from '../../src/modules/documents/service.js';
import { formatExtracts, searchTerms } from '../../src/modules/documents/search.js';
import { EncryptedStore } from '../../src/storage/encrypted-store.js';
import { DEMO, apprentiAgent, formateurAgent, setup } from '../helpers.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function makePdf(pages: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage();
    text.split('\n').forEach((line, i) => page.drawText(line, { x: 40, y: 750 - i * 18, size: 12, font }));
  }
  return Buffer.from(await doc.save());
}

async function makeScannedPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage().drawRectangle({ x: 50, y: 50, width: 200, height: 100 });
  return Buffer.from(await doc.save());
}

const COURS = [
  'Aire du rectangle\nPour calculer la surface à carreler, on multiplie la longueur par la largeur.\nAire = longueur × largeur, en m².',
  'Théorème de Pythagore\nDans un triangle rectangle, le carré de l’hypoténuse est égal à la somme des carrés des deux autres côtés.\nContact formateur : jean.dupont@cfa.fr',
];

/** Fournisseur qui enregistre ce qu'on lui envoie (prompt du tuteur, images). */
class CaptureProvider implements LLMProvider {
  readonly name = 'mistral' as const;
  readonly model = 'capture';
  chats: ChatMessage[][] = [];
  images: ImageInput[] = [];
  ocr = MOCK_OCR_TEXT;
  async *chat(messages: ChatMessage[]) {
    this.chats.push(messages);
    yield { type: 'delta' as const, text: 'Que cherches-tu ?' };
    yield { type: 'done' as const, provider: this.name, model: this.model };
  }
  async generate<T>() {
    const data = { chapitre: 'aires_volumes', notion: 'aire du rectangle', reponse_attendue: null, est_exercice_maths: true };
    return { data: data as T, provider: this.name, model: this.model };
  }
  async vision(image: ImageInput) {
    this.images.push(image);
    return { text: this.ocr, provider: this.name, model: this.model };
  }
}

describe('stockage chiffré', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'store-'));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('chiffre sur disque et relit à l’identique', async () => {
    const store = new EncryptedStore(dir, randomBytes(32));
    const secret = Buffer.from('Cours confidentiel : aire du rectangle');
    const key = await store.put(secret);
    const onDisk = await readFile(join(dir, `${key}.bin`));
    expect(onDisk.includes(Buffer.from('confidentiel'))).toBe(false);
    expect(await store.get(key)).toEqual(secret);
  });

  it('détecte un fichier modifié et refuse une mauvaise clé', async () => {
    const store = new EncryptedStore(dir, randomBytes(32));
    const key = await store.put(Buffer.from('original'));
    const path = join(dir, `${key}.bin`);
    const raw = await readFile(path);
    raw[raw.length - 1]! ^= 0xff;
    await writeFile(path, raw);
    await expect(store.get(key)).rejects.toThrow();
    await expect(new EncryptedStore(dir, randomBytes(32)).get(await store.put(Buffer.from('x')))).rejects.toThrow();
  });

  it('refuse un chemin fabriqué (traversée de dossier)', async () => {
    const store = new EncryptedStore(dir, randomBytes(32));
    await expect(store.get('../../etc/passwd')).rejects.toThrow(/invalide/);
  });
});

describe('outils d’extraction', () => {
  it('reconnaît le vrai type d’après les premiers octets', async () => {
    expect(sniffMime(await makePdf(['x']))).toBe('application/pdf');
    expect(sniffMime(PNG)).toBe('image/png');
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffMime(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
  });

  it('découpe en passages sans dépasser la taille', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Phrase numéro ${i} sur le carrelage.`).join(' ');
    const chunks = chunkPages(['Titre\n\nCourt paragraphe.', long], 300);
    expect(chunks[0]).toEqual({ page: 1, contenu: 'Titre\nCourt paragraphe.' });
    expect(chunks.filter((c) => c.page === 2).length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.contenu.length <= 600)).toBe(true);
  });

  it('noms de fichiers : accents réparés, caractères dangereux retirés', () => {
    expect(safeFileName(Buffer.from('cours_été.pdf').toString('latin1'))).toBe('cours_été.pdf');
    expect(safeFileName('../../a"b<c>.pdf')).toBe('.._.._a_b_c_.pdf');
  });

  it('mots de recherche et mise en forme des extraits', () => {
    expect(searchTerms('L’aire d’un rectangle de 4,5 m ?')).toEqual(['aire', 'rectangle']);
    const text = formatExtracts([{ titre: 'Aires', page: 2, contenu: 'Aire = L × l' }]);
    expect(text).toBe('[Cours « Aires », page 2]\nAire = L × l');
    expect(formatExtracts([])).toBeUndefined();
  });
});

describe('cours du formateur', () => {
  const capture = new CaptureProvider();
  let ctx: Awaited<ReturnType<typeof setup>>;
  let formateur: request.Agent;
  let classId: string;

  beforeAll(async () => {
    ctx = await setup({ UPLOAD_MAX_MB: '1' }, capture);
    formateur = await formateurAgent(ctx.app);
    classId = (await formateur.get('/api/classes')).body[0].id;
  });
  afterAll(() => ctx.close());
  beforeEach(() => {
    capture.chats = [];
    capture.images = [];
    capture.ocr = MOCK_OCR_TEXT;
  });

  const upload = (agent: request.Agent, file: Buffer, name: string, titre = 'Cours aires') =>
    agent.post('/api/documents').field('classId', classId).field('titre', titre).attach('fichier', file, name);

  let pdfId: string;

  it('importe un PDF : texte extrait, fichier chiffré, suppression programmée', async () => {
    const res = await upload(formateur, await makePdf(COURS), 'aires_et_pythagore.pdf').expect(201);
    pdfId = res.body.id;
    expect(res.body).toMatchObject({ titre: 'Cours aires', nbPages: 2, mime: 'application/pdf' });
    const days = (Date.parse(res.body.expireLe) - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(30);

    const files = await readdir(ctx.filesDir);
    expect(files).toHaveLength(1);
    const onDisk = await readFile(join(ctx.filesDir, files[0]!));
    expect(onDisk.includes(Buffer.from('rectangle'))).toBe(false);

    const detail = await formateur.get(`/api/documents/${pdfId}`).expect(200);
    expect(detail.body.apercu).toContain('Aire = longueur × largeur');
  });

  it('masque les données personnelles du texte indexé', async () => {
    const detail = await formateur.get(`/api/documents/${pdfId}`).expect(200);
    expect(detail.body.apercu).not.toContain('jean.dupont');
  });

  it('rend le fichier original au formateur, à l’identique', async () => {
    const original = await makePdf(COURS);
    const res = await formateur
      .get(`/api/documents/${pdfId}/fichier`)
      .buffer(true)
      .parse((r, cb) => {
        const parts: Buffer[] = [];
        r.on('data', (c: Buffer) => parts.push(c));
        r.on('end', () => cb(null, Buffer.concat(parts)));
      })
      .expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('aires_et_pythagore.pdf');
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((res.body as Buffer).length).toBeGreaterThan(original.length / 2);
  });

  it('refuse le même fichier deux fois dans la classe', async () => {
    const res = await upload(formateur, await makePdf(COURS), 'copie.pdf');
    // pdf-lib horodate le PDF : on renvoie exactement le fichier stocké.
    const stored = await formateur
      .get(`/api/documents/${pdfId}/fichier`)
      .buffer(true)
      .parse((r, cb) => {
        const parts: Buffer[] = [];
        r.on('data', (c: Buffer) => parts.push(c));
        r.on('end', () => cb(null, Buffer.concat(parts)));
      });
    if (res.status === 201) await formateur.delete(`/api/documents/${res.body.id}`);
    const dup = await upload(formateur, stored.body as Buffer, 'copie.pdf').expect(409);
    expect(dup.body.error).toMatch(/déjà importé/);
  });

  it('importe une photo de cours par OCR (modèle de vision)', async () => {
    capture.ocr = 'Pourcentages\nUne remise de 10 % sur 200 € : on calcule 10 % de 200.';
    const res = await upload(formateur, PNG, 'photo.png', 'Cours pourcentages').expect(201);
    expect(res.body).toMatchObject({ nbPages: 1, mime: 'image/png' });
    expect(capture.images[0]!.mimeType).toBe('image/png');
    await formateur.delete(`/api/documents/${res.body.id}`).expect(204);
  });

  it.each([
    ['un faux PDF (page HTML renommée)', Buffer.from('<html>pas un pdf</html>'), 'cours.pdf', 415, /Format non accepté/],
    ['un PDF scanné sans texte', null, 'scan.pdf', 422, /document scanné/],
    ['un fichier trop lourd', Buffer.concat([PNG, Buffer.alloc(1.2 * 1024 * 1024)]), 'grosse.png', 413, /trop lourd/],
  ])('refuse %s', async (_, file, name, status, message) => {
    const res = await upload(formateur, file ?? (await makeScannedPdf()), name).expect(status);
    expect(res.body.error).toMatch(message);
  });

  it('photo illisible : message clair, rien n’est stocké', async () => {
    capture.ocr = 'ILLISIBLE';
    const before = (await readdir(ctx.filesDir)).length;
    const res = await upload(formateur, PNG, 'flou.png', 'Flou').expect(422);
    expect(res.body.error).toMatch(/n’arrive pas à lire/);
    expect(await readdir(ctx.filesDir)).toHaveLength(before);
  });

  it('accès réservé au formateur de la classe', async () => {
    const autre = await formateurAgent(ctx.app, 'autre@cfa.test');
    await autre.get(`/api/documents/${pdfId}`).expect(404);
    await autre.get(`/api/documents/${pdfId}/fichier`).expect(404);
    await autre.get(`/api/documents?classId=${classId}`).expect(404);
    const apprenti = await apprentiAgent(ctx.app, 'Truelle', DEMO.apprentis[0]!.pin);
    await apprenti.get(`/api/documents/${pdfId}`).expect(403);
    const list = await formateur.get(`/api/documents?classId=${classId}`).expect(200);
    expect(list.body.map((d: { id: string }) => d.id)).toContain(pdfId);
  });

  it('RAG : le tuteur reçoit les passages du cours liés à l’exercice', async () => {
    const apprenti = await apprentiAgent(ctx.app, 'Truelle', DEMO.apprentis[0]!.pin);
    await apprenti
      .post('/api/tuteur/conversations')
      .send({ enonce: 'Quelle surface de carrelage pour une pièce rectangulaire de 4 m sur 3 m ?' })
      .expect(200);
    const system = capture.chats.at(-1)![0]!.content;
    expect(system).toContain('[Cours « Cours aires », page 1]');
    expect(system).toContain('on multiplie la longueur par la largeur');
    expect(system).not.toContain('hypoténuse'); // passage hors sujet non retenu
  });

  it('suppression d’un cours : fichier effacé, plus de passages pour le tuteur', async () => {
    await formateur.delete(`/api/documents/${pdfId}`).expect(204);
    expect(await readdir(ctx.filesDir)).toHaveLength(0);
    const { rows } = (await ctx.deps.db.execute(sql`select count(*)::int n from document_chunks`)) as unknown as {
      rows: { n: number }[];
    };
    expect(rows[0]!.n).toBe(0);
  });

  it('suppression automatique à expiration, et des fichiers orphelins', async () => {
    const res = await upload(formateur, await makePdf(['Volume d’un pavé\nV = longueur × largeur × hauteur']), 'volume.pdf', 'Volumes').expect(201);
    await writeFile(join(ctx.filesDir, '00000000-0000-0000-0000-000000000000.bin'), 'reste');
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(join(ctx.filesDir, '00000000-0000-0000-0000-000000000000.bin'), old, old);

    await purgeDocuments(ctx.deps); // rien d'expiré : seul l'orphelin part
    expect(await readdir(ctx.filesDir)).toHaveLength(1);
    await formateur.get(`/api/documents/${res.body.id}`).expect(200);

    await purgeDocuments(ctx.deps, new Date(Date.now() + 31 * 86_400_000));
    expect(await readdir(ctx.filesDir)).toHaveLength(0);
    await formateur.get(`/api/documents/${res.body.id}`).expect(404);
  });

  it('suppression de la classe : ses fichiers sont effacés', async () => {
    const created = await formateur.post('/api/classes').send({ nom: 'Classe temporaire', metier: 'macon', niveau: 'CAP1' });
    const res = await formateur
      .post('/api/documents')
      .field('classId', created.body.id)
      .field('titre', 'Cours')
      .attach('fichier', await makePdf(['Échelle\n1/50 : 1 cm pour 50 cm']), 'echelle.pdf')
      .expect(201);
    expect(res.body.id).toBeTruthy();
    await formateur.delete(`/api/classes/${created.body.id}`).send({ confirmation: 'SUPPRIMER' }).expect(204);
    expect(await readdir(ctx.filesDir)).toHaveLength(0);
  });
});

describe('photo d’énoncé de l’apprenti', () => {
  const capture = new CaptureProvider();
  let ctx: Awaited<ReturnType<typeof setup>>;
  let apprenti: request.Agent;
  beforeAll(async () => {
    ctx = await setup({ DAILY_MESSAGE_LIMIT: '10' }, capture);
    apprenti = await apprentiAgent(ctx.app, 'Truelle', DEMO.apprentis[0]!.pin);
  });
  afterAll(() => ctx.close());

  it('lit le texte, masque les données personnelles, ne stocke rien', async () => {
    capture.ocr = 'Nom : Léo, tél 06 12 34 56 78\nUne pièce de 4,5 m sur 3,2 m. Quelle surface ?';
    const res = await apprenti.post('/api/tuteur/photo').attach('photo', PNG, 'exo.png').expect(200);
    expect(res.body.texte).toContain('4,5 m sur 3,2 m');
    expect(res.body.texte).not.toContain('06 12');
    expect(res.body.quota).toMatchObject({ utilises: 1, limite: 10 });
    expect(await readdir(ctx.filesDir)).toHaveLength(0);
  });

  it('photo illisible : message clair et message non décompté', async () => {
    capture.ocr = 'ILLISIBLE';
    const before = (await apprenti.get('/api/tuteur/quota')).body.utilises;
    const res = await apprenti.post('/api/tuteur/photo').attach('photo', PNG, 'flou.png').expect(422);
    expect(res.body.error).toMatch(/Reprends-la bien à plat/);
    expect((await apprenti.get('/api/tuteur/quota')).body.utilises).toBe(before);
  });

  it('refuse un PDF ou un fichier qui n’est pas une image', async () => {
    await apprenti.post('/api/tuteur/photo').attach('photo', await makePdf(['x']), 'a.pdf').expect(415);
    await apprenti.post('/api/tuteur/photo').attach('photo', Buffer.from('MZ\x90\x00'), 'virus.png').expect(415);
  });

  it('fonctionne en mode Mock, sans clé', async () => {
    const mock = await setup();
    const agent = await apprentiAgent(mock.app, 'Niveau', DEMO.apprentis[1]!.pin);
    const res = await agent.post('/api/tuteur/photo').attach('photo', PNG, 'exo.png').expect(200);
    expect(res.body.texte).toBe(MOCK_OCR_TEXT);
    await mock.close();
  });
});
