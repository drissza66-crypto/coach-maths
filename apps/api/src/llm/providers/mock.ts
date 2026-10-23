import { setTimeout as sleep } from 'node:timers/promises';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { LLMError, type LLMErrorKind } from '../errors.js';
import type {
  CallOptions,
  ChatChunk,
  ChatMessage,
  GenerateResult,
  ImageInput,
  LLMProvider,
  OutputSchema,
  VisionResult,
} from '../types.js';

/**
 * Faux fournisseur, déterministe et sans réseau : développer et tester
 * l'application entière sans aucune clé d'API.
 */
export interface MockOptions {
  /** Délai entre deux mots du streaming (0 en test). */
  delayMs?: number;
  /** Simule une panne à chaque appel (tester les messages d'erreur et le repli). */
  fail?: LLMErrorKind;
  model?: string;
}

// Réponses socratiques : jamais de résultat, toujours une question.
const RULES: { test: RegExp; reply: string }[] = [
  {
    test: /(donne|dis|envoie)[- ]?(moi)? (juste )?(la|le|les) (réponse|résultat|solution)|c.?est quoi (la réponse|le résultat)|fais[- ](le|l.exercice)|juste la réponse|corrigé/i,
    reply:
      'Je ne vais pas te donner le résultat, mais on va le trouver ensemble. ' +
      'Première question : qu’est-ce qu’on te demande de calculer ?',
  },
  {
    test: /pythagore|hypot[ée]nuse|triangle rectangle|diagonale|[ée]querre/i,
    reply:
      'Bonne piste ! Dans un triangle rectangle, quel est le côté le plus long ? ' +
      'Comment s’appelle-t-il ?',
  },
  {
    test: /b[ée]ton|dosage|ciment|mortier|sable|gravier/i,
    reply:
      'Un dosage, c’est une proportion. Pour 1 m³ de béton, quelle quantité de ciment ' +
      'donne ton énoncé ?',
  },
  {
    test: /pente|toiture|[ée]vacuation|rampe/i,
    reply: 'La pente compare la hauteur et la longueur. Quelles sont ces deux mesures dans ton exercice ?',
  },
  {
    test: /pourcent|%|remise|tva|devis|r[ée]duction/i,
    reply: 'Un pourcentage, c’est « sur 100 ». Que représente 100 % dans ton exercice ?',
  },
  {
    test: /volume|m³|m3|cuve|fouille/i,
    reply: 'Pour un volume, on multiplie trois longueurs. Quelles sont ces trois longueurs ici ?',
  },
  {
    test: /carrel|surface|aire|m²|m2|peinture|parquet/i,
    reply:
      'Pour carreler, il faut d’abord connaître la surface. Quelle forme a la pièce, ' +
      'et quelles mesures as-tu ?',
  },
  {
    test: /puissance|watt|kwh|[ée]nergie|radiateur|ampoule/i,
    reply: 'L’énergie dépend de la puissance et du temps. Quelle puissance et quelle durée as-tu ?',
  },
];

const DEFAULT_REPLY =
  'D’accord, on regarde ça ensemble. Lis l’énoncé avec moi : qu’est-ce qu’on te demande de trouver ?';

export const MOCK_OCR_TEXT =
  'Exercice 3 — Un carreleur doit poser du carrelage dans une pièce rectangulaire ' +
  'de 4,5 m sur 3,2 m. Les carreaux sont vendus par paquets de 1,44 m². ' +
  'Combien de paquets doit-il acheter ?';

export function mockReply(messages: ChatMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  return RULES.find((r) => r.test.test(last))?.reply ?? DEFAULT_REPLY;
}

type JsonNode = Record<string, unknown>;

/** Valeur plausible respectant un schéma JSON (y compris longueurs et bornes). */
export function sampleFromJsonSchema(node: JsonNode, key = 'exemple'): unknown {
  if ('const' in node) return node.const;
  if (Array.isArray(node.enum)) return node.enum[0];
  const variants = (node.anyOf ?? node.oneOf) as JsonNode[] | undefined;
  if (variants?.length) return sampleFromJsonSchema(variants.find((v) => v.type !== 'null') ?? variants[0]!, key);
  const type = Array.isArray(node.type) ? node.type.find((t) => t !== 'null') : node.type;
  switch (type) {
    case 'object': {
      const props = (node.properties ?? {}) as Record<string, JsonNode>;
      return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, sampleFromJsonSchema(v, k)]));
    }
    case 'array': {
      const min = Number(node.minItems ?? 0);
      const max = Number(node.maxItems ?? Infinity);
      const count = Math.min(Math.max(min, 2), max);
      return Array.from({ length: count }, (_, i) => sampleFromJsonSchema(node.items as JsonNode, `${key} ${i + 1}`));
    }
    case 'string': {
      let text = `${key[0]?.toUpperCase() ?? ''}${key.slice(1)} (démo)`;
      const min = Number(node.minLength ?? 0);
      while (text.length < min) text += ' …';
      return node.maxLength ? text.slice(0, Number(node.maxLength)) : text;
    }
    case 'integer':
    case 'number': {
      const min = Number(node.minimum ?? node.exclusiveMinimum ?? 1);
      return node.exclusiveMinimum !== undefined ? min + 1 : Math.max(min, 1);
    }
    case 'boolean':
      return true;
    case 'null':
      return null;
    default:
      return null;
  }
}

export class MockProvider implements LLMProvider {
  readonly name = 'mock' as const;
  readonly model: string;

  constructor(private options: MockOptions = {}) {
    this.model = options.model ?? 'mock-socratique';
  }

  private failIfConfigured() {
    const kind = this.options.fail;
    if (kind) throw new LLMError(kind, this.name, `panne simulée : ${kind}`, kind === 'rate_limit' ? 10 : undefined);
  }

  async *chat(messages: ChatMessage[], options?: CallOptions): AsyncIterable<ChatChunk> {
    this.failIfConfigured();
    const words = mockReply(messages).split(/(?<= )/);
    for (const word of words) {
      if (options?.signal?.aborted) throw new LLMError('aborted', this.name);
      if (this.options.delayMs) await sleep(this.options.delayMs);
      yield { type: 'delta', text: word };
    }
    yield {
      type: 'done',
      usage: { inputTokens: messages.reduce((n, m) => n + m.content.length, 0) >> 2, outputTokens: words.length },
      provider: this.name,
      model: this.model,
    };
  }

  async generate<T>(prompt: string, schema: OutputSchema<T>): Promise<GenerateResult<T>> {
    this.failIfConfigured();
    const json = zodToJsonSchema(schema, { $refStrategy: 'none' }) as JsonNode;
    const result = schema.safeParse(sampleFromJsonSchema(json));
    if (!result.success) throw new LLMError('invalid_output', this.name, 'schéma non pris en charge par le mock');
    return {
      data: result.data,
      usage: { inputTokens: prompt.length >> 2, outputTokens: 50 },
      provider: this.name,
      model: this.model,
    };
  }

  async vision(_image: ImageInput, prompt: string): Promise<VisionResult> {
    this.failIfConfigured();
    return {
      text: MOCK_OCR_TEXT,
      usage: { inputTokens: prompt.length >> 2, outputTokens: 40 },
      provider: this.name,
      model: this.model,
    };
  }
}
