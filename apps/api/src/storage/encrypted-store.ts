import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Env } from '../config/env.js';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_PATTERN = /^[0-9a-f-]{36}$/;

/**
 * Fichiers chiffrés sur disque (AES-256-GCM, une IV aléatoire par fichier).
 * Format : [IV 12 octets][tag 16 octets][contenu chiffré].
 * Le tag d'authentification détecte toute modification du fichier.
 */
export class EncryptedStore {
  constructor(
    private readonly dir: string,
    private readonly key: Buffer,
  ) {
    if (key.length !== 32) throw new Error('La clé de chiffrement doit faire 32 octets.');
  }

  private path(storageKey: string) {
    // La clé de stockage est générée par nous : on refuse tout autre format (traversée de dossier).
    if (!KEY_PATTERN.test(storageKey)) throw new Error('Clé de stockage invalide.');
    return join(this.dir, `${storageKey}.bin`);
  }

  async put(data: Buffer): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const storageKey = randomUUID();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const target = this.path(storageKey);
    // Écriture atomique : jamais de fichier à moitié écrit.
    await writeFile(`${target}.tmp`, Buffer.concat([iv, cipher.getAuthTag(), encrypted]));
    await rename(`${target}.tmp`, target);
    return storageKey;
  }

  async get(storageKey: string): Promise<Buffer> {
    const raw = await readFile(this.path(storageKey));
    const iv = raw.subarray(0, IV_LENGTH);
    const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(raw.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]);
  }

  async remove(storageKey: string) {
    await rm(this.path(storageKey), { force: true });
  }

  /** Clés présentes sur disque, avec leur date de modification (nettoyage des orphelins). */
  async list(): Promise<{ storageKey: string; modifiedAt: Date }[]> {
    if (!existsSync(this.dir)) return [];
    const names = (await readdir(this.dir)).filter((n) => n.endsWith('.bin'));
    return Promise.all(
      names.map(async (n) => ({ storageKey: n.slice(0, -4), modifiedAt: (await stat(join(this.dir, n))).mtime })),
    );
  }
}

/**
 * Clé de chiffrement : FILE_ENCRYPTION_KEY (base64, 32 octets) obligatoire en production.
 * En développement, une clé locale est créée une fois pour toutes dans le dossier des fichiers.
 */
export async function resolveEncryptionKey(env: Env): Promise<Buffer> {
  if (env.FILE_ENCRYPTION_KEY) return Buffer.from(env.FILE_ENCRYPTION_KEY, 'base64');
  if (env.NODE_ENV === 'production') {
    throw new Error('Configuration invalide : FILE_ENCRYPTION_KEY est obligatoire en production.');
  }
  const keyFile = join(env.FILES_DIR, '.cle-developpement');
  if (existsSync(keyFile)) return Buffer.from((await readFile(keyFile, 'utf8')).trim(), 'base64');
  await mkdir(env.FILES_DIR, { recursive: true });
  const key = randomBytes(32);
  await writeFile(keyFile, key.toString('base64'), { mode: 0o600 });
  console.warn(`[fichiers] clé de développement créée dans ${keyFile} (définir FILE_ENCRYPTION_KEY en production).`);
  return key;
}
