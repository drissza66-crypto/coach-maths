import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Les prompts vivent dans src/prompts/*.md, indépendants du fournisseur.
 * Variables : {{nom}}. Une variable manquante est une erreur (jamais de « {{…}} » envoyé à l'IA).
 */
const cache = new Map<string, string>();

export const PROMPT_NAMES = ['tutor.system', 'classify.exercise'] as const;
export type PromptName = (typeof PROMPT_NAMES)[number];

function load(name: PromptName): string {
  let text = cache.get(name);
  if (text === undefined) {
    text = readFileSync(fileURLToPath(new URL(`../prompts/${name}.md`, import.meta.url)), 'utf8');
    cache.set(name, text);
  }
  return text;
}

export function variablesOf(name: PromptName): string[] {
  return [...new Set([...load(name).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!))];
}

export function renderPrompt(name: PromptName, vars: Record<string, string | number>): string {
  return load(name).replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`Prompt ${name} : variable {{${key}}} manquante.`);
    return String(vars[key]);
  });
}
