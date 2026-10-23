import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Charge le fichier .env à la racine du projet s'il existe (les variables déjà définies gagnent). */
export function loadEnvFile() {
  const path = fileURLToPath(new URL('../../../../.env', import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}
