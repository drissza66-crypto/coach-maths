import type { ZodType, ZodTypeDef } from 'zod';

export const PROVIDER_NAMES = ['mock', 'mistral', 'gemini', 'claude', 'openai-compatible'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

/** À quoi sert l'appel : sert au journal et aux limites, jamais transmis au fournisseur. */
export type LLMPurpose = 'chat' | 'generate' | 'vision' | 'classify';

export interface CallOptions {
  maxTokens?: number;
  /** Ignorée par les fournisseurs qui ne l'acceptent plus (Claude). */
  temperature?: number;
  /** Profondeur de raisonnement, pour les fournisseurs qui la gèrent (Claude). */
  effort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
  /** Métadonnées pour le journal (sans contenu). */
  userId?: string | null;
  purpose?: LLMPurpose;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type ChatChunk =
  | { type: 'delta'; text: string }
  | { type: 'done'; usage?: TokenUsage; provider: string; model: string };

export interface ImageInput {
  /** Déchiffrée en mémoire uniquement, jamais écrite en clair. */
  data: Buffer;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface GenerateResult<T> {
  data: T;
  usage?: TokenUsage;
  provider: string;
  model: string;
}

export interface VisionResult {
  text: string;
  usage?: TokenUsage;
  provider: string;
  model: string;
}

export type OutputSchema<T> = ZodType<T, ZodTypeDef, unknown>;

/**
 * Interface unique pour tous les fournisseurs d'IA.
 * Le reste de l'application ne connaît que ce contrat.
 */
export interface LLMProvider {
  readonly name: ProviderName;
  readonly model: string;

  /** Réponse en streaming, morceau par morceau. Se termine par un morceau "done". */
  chat(messages: ChatMessage[], options?: CallOptions): AsyncIterable<ChatChunk>;

  /** Sortie structurée, validée par le schéma Zod (fiches, quiz, flashcards…). */
  generate<T>(prompt: string, schema: OutputSchema<T>, options?: CallOptions): Promise<GenerateResult<T>>;

  /** Lecture d'une photo (énoncé, page de cours). */
  vision(image: ImageInput, prompt: string, options?: CallOptions): Promise<VisionResult>;
}
