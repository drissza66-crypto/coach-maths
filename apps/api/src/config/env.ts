import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  APP_URL: z.string().url().default('http://localhost:5173'),

  /** Vide : PostgreSQL embarqué (PGlite) dans PGLITE_DATA_DIR. "memory" : en mémoire. */
  DATABASE_URL: z.string().optional(),
  PGLITE_DATA_DIR: z.string().default('./.data/pglite'),

  SESSION_TTL_DAYS: z.coerce.number().positive().default(7),
  MAGIC_LINK_TTL_MINUTES: z.coerce.number().positive().default(15),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().positive().default(15),
  RATE_LIMIT_ENABLED: bool(true),
  COOKIE_SECURE: bool(false),

  /** Domaines autorisés à créer un compte formateur par lien magique. */
  FORMATEUR_ALLOWED_DOMAINS: csv,

  MAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Coach Maths <no-reply@localhost>'),

  CONSENT_VERSION: z.string().default('2026-10'),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((i) => `  - ${i.path.join('.')} : ${i.message}`).join('\n');
    throw new Error(`Configuration invalide :\n${details}`);
  }
  const env = result.data;
  if (env.MAIL_TRANSPORT === 'smtp' && !env.SMTP_URL) {
    throw new Error('Configuration invalide : SMTP_URL est obligatoire avec MAIL_TRANSPORT=smtp.');
  }
  if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
    throw new Error('Configuration invalide : COOKIE_SECURE=true est obligatoire en production.');
  }
  return env;
}
