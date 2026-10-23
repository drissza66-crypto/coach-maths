import { setTimeout as sleep } from 'node:timers/promises';
import { LLMError } from './errors.js';
import type {
  CallOptions,
  ChatChunk,
  ChatMessage,
  GenerateResult,
  ImageInput,
  LLMPurpose,
  LLMProvider,
  OutputSchema,
  ProviderName,
  TokenUsage,
  VisionResult,
} from './types.js';

/** Une ligne de journal par appel : qui a répondu, jamais le contenu. */
export interface LLMCallRecord {
  userId: string | null;
  purpose: LLMPurpose;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  status: 'ok' | LLMError['kind'];
  latencyMs: number;
  usage?: TokenUsage;
}

export interface ResilienceOptions {
  /** Réessais sur le même fournisseur pour les erreurs passagères. */
  maxRetries: number;
  /** Attente de base entre deux essais (doublée à chaque fois). */
  baseDelayMs: number;
  /** Au-delà, on n'attend pas : on passe au repli (l'apprenti attend devant l'écran). */
  maxDelayMs: number;
  log?: (record: LLMCallRecord) => void | Promise<void>;
}

/**
 * Enveloppe un fournisseur principal (et un repli facultatif) :
 * 1. erreur passagère (429, 5xx, délai) → réessai avec attente croissante ;
 * 2. échec persistant, quota épuisé, clé invalide → fournisseur de repli ;
 * 3. tout échoue → LLMError, que les routes traduisent en message clair.
 * Le streaming ne bascule pas au milieu d'une réponse déjà commencée.
 */
export class ResilientProvider implements LLMProvider {
  readonly name: ProviderName;
  readonly model: string;
  private readonly chain: LLMProvider[];

  constructor(
    primary: LLMProvider,
    fallback: LLMProvider | null,
    private options: ResilienceOptions,
  ) {
    this.name = primary.name;
    this.model = primary.model;
    this.chain = fallback ? [primary, fallback] : [primary];
  }

  get primary() {
    return this.chain[0]!;
  }

  get fallback() {
    return this.chain[1] ?? null;
  }

  private async record(record: LLMCallRecord) {
    try {
      await this.options.log?.(record);
    } catch {
      // Le journal ne doit jamais faire échouer une réponse.
    }
  }

  private delayFor(err: LLMError, attempt: number): number | null {
    if (!err.retryable || attempt >= this.options.maxRetries) return null;
    const delay = err.retryAfterMs ?? this.options.baseDelayMs * 2 ** attempt;
    return delay <= this.options.maxDelayMs ? delay : null;
  }

  /**
   * Essaie chaque fournisseur, avec réessais, jusqu'au premier succès.
   * `logSuccess: false` : l'appelant journalise lui-même la fin (streaming).
   */
  private async run<R extends { usage?: TokenUsage; provider: string; model: string }>(
    purpose: LLMPurpose,
    options: CallOptions,
    call: (provider: LLMProvider) => Promise<R>,
    logSuccess = true,
  ): Promise<{ result: R; provider: LLMProvider; fallbackUsed: boolean; started: number }> {
    let lastError: LLMError | undefined;
    for (const [index, provider] of this.chain.entries()) {
      for (let attempt = 0; ; attempt++) {
        const started = Date.now();
        try {
          const result = await call(provider);
          if (logSuccess) {
            await this.record({
              userId: options.userId ?? null,
              purpose,
              provider: result.provider,
              model: result.model,
              fallbackUsed: index > 0,
              status: 'ok',
              latencyMs: Date.now() - started,
              usage: result.usage,
            });
          }
          return { result, provider, fallbackUsed: index > 0, started };
        } catch (err) {
          const error = toLLMError(err, provider.name);
          await this.record({
            userId: options.userId ?? null,
            purpose,
            provider: provider.name,
            model: provider.model,
            fallbackUsed: index > 0,
            status: error.kind,
            latencyMs: Date.now() - started,
          });
          // Annulé par l'apprenti, ou contenu refusé : un autre fournisseur n'y changerait rien.
          if (error.kind === 'aborted' || error.kind === 'content_filter') throw error;
          lastError = error;
          const delay = this.delayFor(error, attempt);
          if (delay === null) break;
          await sleep(delay, undefined, { signal: options.signal }).catch(() => {
            throw new LLMError('aborted', provider.name);
          });
        }
      }
    }
    throw lastError!;
  }

  async *chat(messages: ChatMessage[], options: CallOptions = {}): AsyncIterable<ChatChunk> {
    const purpose = options.purpose ?? 'chat';
    // Le premier morceau est attendu dans run() : réessai et repli restent possibles
    // tant que rien n'a été envoyé à l'apprenti.
    const opened = await this.run(
      purpose,
      options,
      async (provider) => {
        const iterator = provider.chat(messages, options)[Symbol.asyncIterator]();
        const first = await iterator.next();
        return { iterator, first, provider: provider.name, model: provider.model };
      },
      false,
    );
    const { iterator, first } = opened.result;
    const base = { userId: options.userId ?? null, purpose, fallbackUsed: opened.fallbackUsed };
    let provider: string = opened.provider.name;
    let model = opened.provider.model;
    let usage: TokenUsage | undefined;

    try {
      let next = first;
      while (!next.done) {
        if (next.value.type === 'done') ({ provider, model, usage } = next.value);
        yield next.value;
        next = await iterator.next();
      }
    } catch (err) {
      // Coupure en pleine réponse : pas de repli possible, l'apprenti pourra relancer.
      const error = toLLMError(err, provider);
      await this.record({ ...base, provider, model, status: error.kind, latencyMs: Date.now() - opened.started });
      throw error;
    }
    await this.record({ ...base, provider, model, status: 'ok', latencyMs: Date.now() - opened.started, usage });
  }

  async generate<T>(prompt: string, schema: OutputSchema<T>, options: CallOptions = {}): Promise<GenerateResult<T>> {
    return (await this.run(options.purpose ?? 'generate', options, (p) => p.generate(prompt, schema, options))).result;
  }

  async vision(image: ImageInput, prompt: string, options: CallOptions = {}): Promise<VisionResult> {
    return (await this.run(options.purpose ?? 'vision', options, (p) => p.vision(image, prompt, options))).result;
  }
}

function toLLMError(err: unknown, provider: string): LLMError {
  return err instanceof LLMError ? err : new LLMError('unavailable', provider, undefined, undefined, { cause: err });
}
