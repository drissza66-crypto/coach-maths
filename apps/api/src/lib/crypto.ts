import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { CLASS_CODE_ALPHABET, CLASS_CODE_LENGTH, isWeakPin } from '@mathsuivi/shared';

const scryptAsync = promisify(scrypt) as (pwd: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;

// N élevé : un PIN à 6 chiffres n'a que 10^6 valeurs, le hachage doit être lent.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 32;

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(pin, salt, KEYLEN, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [algo, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(pin, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return timingSafeEqual(actual, expected);
}

/** Jeton aléatoire pour les sessions et liens magiques. Seul son hash est stocké. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomClassCode(): string {
  let code = '';
  for (let i = 0; i < CLASS_CODE_LENGTH; i++) code += CLASS_CODE_ALPHABET[randomInt(CLASS_CODE_ALPHABET.length)];
  return code;
}

export function randomPin(): string {
  let pin: string;
  do pin = String(randomInt(1_000_000)).padStart(6, '0');
  while (isWeakPin(pin));
  return pin;
}
