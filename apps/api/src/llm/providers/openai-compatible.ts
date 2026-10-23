import { LLMError } from '../errors.js';
import { deadline, postJson, readSse } from '../http.js';
import { jsonInstruction, parseStructured, toJsonSchema, withRepair } from '../structured.js';
import type {
  CallOptions,
  ChatChunk,
  ChatMessage,
  GenerateResult,
  ImageInput,
  LLMProvider,
  OutputSchema,
  ProviderName,
  TokenUsage,
  VisionResult,
} from '../types.js';

export interface HttpProviderConfig {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  visionModel?: string;
  timeoutMs: number;
}

// Larges : les modèles qui « réfléchissent » consomment une partie de ce budget avant de répondre.
export const DEFAULT_MAX_TOKENS = { chat: 2048, generate: 8192, vision: 4096 };

interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

const toUsage = (u?: OpenAIUsage): TokenUsage | undefined =>
  u ? { inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0 } : undefined;

/**
 * API « chat completions » au format OpenAI : Groq, OpenRouter, Ollama,
 * vLLM, LM Studio… L'adresse vient de LLM_BASE_URL.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: ProviderName = 'openai-compatible';
  readonly model: string;
  protected readonly baseUrl: string;
  /** json_object : le plus largement accepté. Les sous-classes peuvent imposer le schéma. */
  protected jsonMode: 'json_object' | 'json_schema' = 'json_object';

  constructor(protected config: HttpProviderConfig) {
    if (!config.baseUrl) throw new Error('LLM_BASE_URL est obligatoire pour openai-compatible.');
    this.model = config.model;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  protected headers(): Record<string, string> {
    return this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {};
  }

  protected imagePart(image: ImageInput): unknown {
    return { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data.toString('base64')}` } };
  }

  async *chat(messages: ChatMessage[], options: CallOptions = {}): AsyncIterable<ChatChunk> {
    const signal = deadline(this.config.timeoutMs, options.signal);
    const res = await postJson(
      this.name,
      `${this.baseUrl}/chat/completions`,
      {
        model: this.model,
        messages,
        stream: true,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS.chat,
        ...(options.temperature !== undefined && { temperature: options.temperature }),
      },
      this.headers(),
      signal,
    );

    let usage: TokenUsage | undefined;
    for await (const data of readSse(this.name, res, signal)) {
      if (data === '[DONE]') break;
      let event: {
        choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
        usage?: OpenAIUsage;
        error?: unknown;
      };
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      if (event.error) throw new LLMError('unavailable', this.name, 'erreur dans le flux');
      const choice = event.choices?.[0];
      if (choice?.delta?.content) yield { type: 'delta', text: choice.delta.content };
      if (choice?.finish_reason === 'content_filter') throw new LLMError('content_filter', this.name);
      if (event.usage) usage = toUsage(event.usage);
    }
    yield { type: 'done', usage, provider: this.name, model: this.model };
  }

  protected async complete(body: Record<string, unknown>, options: CallOptions) {
    const signal = deadline(this.config.timeoutMs, options.signal);
    const res = await postJson(this.name, `${this.baseUrl}/chat/completions`, body, this.headers(), signal);
    const json = (await res.json()) as {
      choices?: { message?: { content?: string | null }; finish_reason?: string }[];
      usage?: OpenAIUsage;
    };
    const choice = json.choices?.[0];
    if (choice?.finish_reason === 'content_filter') throw new LLMError('content_filter', this.name);
    return { text: choice?.message?.content ?? '', usage: toUsage(json.usage) };
  }

  protected responseFormat(schema: OutputSchema<unknown>) {
    return this.jsonMode === 'json_schema'
      ? { type: 'json_schema', json_schema: { name: 'sortie', schema: toJsonSchema(schema), strict: true } }
      : { type: 'json_object' };
  }

  generate<T>(prompt: string, schema: OutputSchema<T>, options: CallOptions = {}): Promise<GenerateResult<T>> {
    return withRepair(async (isRetry) => {
      const content =
        prompt + jsonInstruction(schema) + (isRetry ? '\nAttention : ta réponse précédente n’était pas un JSON valide.' : '');
      const { text, usage } = await this.complete(
        {
          model: this.model,
          messages: [{ role: 'user', content }],
          max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS.generate,
          response_format: this.responseFormat(schema),
          ...(options.temperature !== undefined && { temperature: options.temperature }),
        },
        options,
      );
      return { data: parseStructured(this.name, text, schema), usage, provider: this.name, model: this.model };
    });
  }

  async vision(image: ImageInput, prompt: string, options: CallOptions = {}): Promise<VisionResult> {
    const model = this.config.visionModel ?? this.model;
    const { text, usage } = await this.complete(
      {
        model,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, this.imagePart(image)] }],
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS.vision,
      },
      options,
    );
    return { text, usage, provider: this.name, model };
  }
}
