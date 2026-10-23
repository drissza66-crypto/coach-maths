import { z } from 'zod';
import { PROVIDER_NAMES, type ProviderName } from '../llm/types.js';

/** Chaîne facultative : une variable vide (« LLM_MODEL= ») vaut absente. */
const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

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

  // ── Fournisseur d'IA : choisi uniquement ici, jamais dans le code ──
  LLM_PROVIDER: z.preprocess((v) => (v === '' ? undefined : v), z.enum(PROVIDER_NAMES).default('mock')),
  LLM_MODEL: optionalString,
  LLM_API_KEY: optionalString,
  LLM_BASE_URL: optionalString,
  LLM_VISION_MODEL: optionalString,
  LLM_FALLBACK_PROVIDER: z.preprocess((v) => (v === '' ? undefined : v), z.enum(PROVIDER_NAMES).optional()),
  LLM_FALLBACK_MODEL: optionalString,
  LLM_FALLBACK_API_KEY: optionalString,
  LLM_FALLBACK_BASE_URL: optionalString,
  LLM_FALLBACK_VISION_MODEL: optionalString,
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  LLM_RETRY_BASE_MS: z.coerce.number().int().min(0).default(1000),
  LLM_RETRY_MAX_WAIT_MS: z.coerce.number().int().min(0).default(8000),
  DAILY_MESSAGE_LIMIT: z.coerce.number().int().positive().default(40),
  LLM_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  /** Conversations effacées après ce nombre de jours sans activité. */
  CHAT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  /** Messages précédents renvoyés à l'IA à chaque tour. */
  CHAT_HISTORY_MESSAGES: z.coerce.number().int().min(2).default(20),

  // ── Fichiers importés ──
  FILES_DIR: z.string().default('./.data/files'),
  /** 32 octets en base64 (openssl rand -base64 32). Obligatoire en production. */
  FILE_ENCRYPTION_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'FILE_ENCRYPTION_KEY doit faire 32 octets en base64.')
      .optional(),
  ),
  FILE_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  UPLOAD_MAX_MB: z.coerce.number().positive().max(50).default(10),

  /** Générations de fiches/quiz/cartes par formateur et par jour. */
  GENERATION_DAILY_LIMIT: z.coerce.number().int().positive().default(30),
  MOCK_DELAY_MS: z.coerce.number().int().min(0).default(15),
  MOCK_FAIL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['rate_limit', 'quota', 'auth', 'timeout', 'unavailable', 'content_filter']).optional(),
  ),
});

function checkProvider(
  label: string,
  provider: ProviderName,
  vars: { model?: string; apiKey?: string; baseUrl?: string },
  names: { model: string; apiKey: string; baseUrl: string },
): string[] {
  if (provider === 'mock') return [];
  const problems: string[] = [];
  if (!vars.model) problems.push(`${names.model} est obligatoire avec ${label}=${provider}.`);
  if (provider === 'openai-compatible') {
    if (!vars.baseUrl) problems.push(`${names.baseUrl} est obligatoire avec ${label}=openai-compatible.`);
  } else if (!vars.apiKey) {
    problems.push(`${names.apiKey} est obligatoire avec ${label}=${provider}.`);
  }
  return problems;
}

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
  const problems = [
    ...checkProvider(
      'LLM_PROVIDER',
      env.LLM_PROVIDER,
      { model: env.LLM_MODEL, apiKey: env.LLM_API_KEY, baseUrl: env.LLM_BASE_URL },
      { model: 'LLM_MODEL', apiKey: 'LLM_API_KEY', baseUrl: 'LLM_BASE_URL' },
    ),
    ...(env.LLM_FALLBACK_PROVIDER
      ? checkProvider(
          'LLM_FALLBACK_PROVIDER',
          env.LLM_FALLBACK_PROVIDER,
          { model: env.LLM_FALLBACK_MODEL, apiKey: env.LLM_FALLBACK_API_KEY, baseUrl: env.LLM_FALLBACK_BASE_URL },
          { model: 'LLM_FALLBACK_MODEL', apiKey: 'LLM_FALLBACK_API_KEY', baseUrl: 'LLM_FALLBACK_BASE_URL' },
        )
      : []),
  ];
  if (problems.length) throw new Error(`Configuration invalide :\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  return env;
}
