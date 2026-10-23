import { zodToJsonSchema } from 'zod-to-json-schema';
import { LLMError } from './errors.js';
import type { OutputSchema } from './types.js';

type Json = Record<string, unknown>;

// Mots-clés de validation que certains fournisseurs refusent dans un schéma de sortie.
// Zod revalide tout après coup : on peut les retirer sans risque.
const UNSUPPORTED = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'default',
]);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (!node || typeof node !== 'object') return node;
  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if (!UNSUPPORTED.has(key)) out[key] = strip(value);
  }
  return out;
}

/** Schéma JSON simple (objets fermés, sans contraintes fines) à partir d'un schéma Zod. */
export function toJsonSchema(schema: OutputSchema<unknown>): Json {
  return strip(zodToJsonSchema(schema, { $refStrategy: 'none', target: 'jsonSchema7' })) as Json;
}

/** Consigne ajoutée au prompt pour les fournisseurs sans contrainte de schéma native. */
export function jsonInstruction(schema: OutputSchema<unknown>): string {
  return (
    '\n\nRéponds uniquement avec un objet JSON valide, sans texte autour ni bloc de code, ' +
    `conforme à ce schéma JSON :\n${JSON.stringify(toJsonSchema(schema))}`
  );
}

/** Extrait et valide le JSON ; tolère un bloc ```json autour de la réponse. */
export function parseStructured<T>(provider: string, raw: string, schema: OutputSchema<T>): T {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new LLMError('invalid_output', provider, 'JSON illisible');
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new LLMError('invalid_output', provider, `JSON non conforme : ${result.error.issues[0]?.path.join('.')}`);
  }
  return result.data;
}

/**
 * Un essai, puis un second si la sortie est invalide : les modèles corrigent
 * presque toujours leur JSON quand on le leur redemande.
 */
export async function withRepair<T>(attempt: (isRetry: boolean) => Promise<T>): Promise<T> {
  try {
    return await attempt(false);
  } catch (err) {
    if (err instanceof LLMError && err.kind === 'invalid_output') return attempt(true);
    throw err;
  }
}
