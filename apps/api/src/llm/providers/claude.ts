import Anthropic, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import { LLMError, errorFromHttp } from '../errors.js';
import { parseStructured, toJsonSchema, withRepair } from '../structured.js';
import type {
  CallOptions,
  ChatChunk,
  ChatMessage,
  GenerateResult,
  ImageInput,
  LLMProvider,
  OutputSchema,
  TokenUsage,
  VisionResult,
} from '../types.js';
import { DEFAULT_MAX_TOKENS, type HttpProviderConfig } from './openai-compatible.js';

type MessageParam = Anthropic.Beta.BetaMessageParam;

/**
 * Anthropic Claude, via le SDK officiel.
 * - Pas de `temperature` : refusée par l'API sur les modèles actuels.
 * - La profondeur de réflexion se règle avec `effort`.
 * - Le SDK ne réessaie pas lui-même : c'est le rôle de ResilientProvider.
 */
export class ClaudeProvider implements LLMProvider {
  readonly name = 'claude' as const;
  readonly model: string;
  private client: Anthropic;

  constructor(private config: HttpProviderConfig) {
    this.model = config.model;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseUrl && { baseURL: config.baseUrl }),
      maxRetries: 0,
      timeout: config.timeoutMs,
    });
  }

  private split(messages: ChatMessage[]) {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const turns: MessageParam[] = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    return { ...(system && { system }), messages: turns };
  }

  /**
   * Repli côté serveur en cas de refus par les filtres de sécurité : l'API relance
   * la même requête sur un modèle adapté. Réservé aux modèles qui l'acceptent.
   */
  private refusalFallback(model: string) {
    return /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model)
      ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
      : {};
  }

  private outputConfig(options: CallOptions, format?: { type: 'json_schema'; schema: Record<string, unknown> }) {
    if (!options.effort && !format) return {};
    return { output_config: { ...(options.effort && { effort: options.effort }), ...(format && { format }) } };
  }

  private toError(err: unknown, signal?: AbortSignal): LLMError {
    if (err instanceof LLMError) return err;
    if (err instanceof APIUserAbortError) {
      return signal?.aborted ? new LLMError('aborted', this.name) : new LLMError('timeout', this.name);
    }
    if (err instanceof APIConnectionTimeoutError) return new LLMError('timeout', this.name);
    if (err instanceof APIConnectionError) return new LLMError('unavailable', this.name, 'network error');
    if (err instanceof APIError && typeof err.status === 'number') {
      return errorFromHttp(this.name, err.status, err.message, err.headers as Headers | undefined);
    }
    return new LLMError('unavailable', this.name, 'erreur inattendue', undefined, { cause: err });
  }

  private usage(u: { input_tokens: number; output_tokens: number }): TokenUsage {
    return { inputTokens: u.input_tokens, outputTokens: u.output_tokens };
  }

  private checkRefusal(stopReason: string | null) {
    if (stopReason === 'refusal') throw new LLMError('content_filter', this.name);
  }

  private firstText(content: Anthropic.Beta.BetaContentBlock[]): string {
    return content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }

  async *chat(messages: ChatMessage[], options: CallOptions = {}): AsyncIterable<ChatChunk> {
    try {
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS.chat,
          ...this.split(messages),
          ...this.outputConfig(options),
          ...this.refusalFallback(this.model),
        },
        { signal: options.signal },
      );
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'delta', text: event.delta.text };
        }
      }
      const final = await stream.finalMessage();
      this.checkRefusal(final.stop_reason);
      // final.model : le modèle qui a réellement répondu (après un éventuel repli serveur).
      yield { type: 'done', usage: this.usage(final.usage), provider: this.name, model: final.model };
    } catch (err) {
      throw this.toError(err, options.signal);
    }
  }

  generate<T>(prompt: string, schema: OutputSchema<T>, options: CallOptions = {}): Promise<GenerateResult<T>> {
    return withRepair(async () => {
      try {
        const response = await this.client.beta.messages.create(
          {
            model: this.model,
            max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS.generate,
            messages: [{ role: 'user', content: prompt }],
            ...this.outputConfig(options, { type: 'json_schema', schema: toJsonSchema(schema) }),
            ...this.refusalFallback(this.model),
          },
          { signal: options.signal },
        );
        this.checkRefusal(response.stop_reason);
        return {
          data: parseStructured(this.name, this.firstText(response.content), schema),
          usage: this.usage(response.usage),
          provider: this.name,
          model: response.model,
        };
      } catch (err) {
        throw this.toError(err, options.signal);
      }
    });
  }

  async vision(image: ImageInput, prompt: string, options: CallOptions = {}): Promise<VisionResult> {
    const model = this.config.visionModel ?? this.model;
    try {
      const response = await this.client.beta.messages.create(
        {
          model,
          max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS.vision,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data.toString('base64') } },
                { type: 'text', text: prompt },
              ],
            },
          ],
          ...this.outputConfig(options),
          ...this.refusalFallback(model),
        },
        { signal: options.signal },
      );
      this.checkRefusal(response.stop_reason);
      return { text: this.firstText(response.content), usage: this.usage(response.usage), provider: this.name, model: response.model };
    } catch (err) {
      throw this.toError(err, options.signal);
    }
  }
}
