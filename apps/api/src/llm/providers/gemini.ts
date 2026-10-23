import { LLMError } from '../errors.js';
import { deadline, postJson, readSse } from '../http.js';
import { jsonInstruction, parseStructured, withRepair } from '../structured.js';
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

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION']);

/** Google Gemini (API Generative Language). */
export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini' as const;
  readonly model: string;
  private readonly baseUrl: string;

  constructor(private config: HttpProviderConfig) {
    this.model = config.model;
    this.baseUrl = (config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  }

  private url(model: string, method: string) {
    return `${this.baseUrl}/models/${encodeURIComponent(model)}:${method}`;
  }

  private headers() {
    return { 'x-goog-api-key': this.config.apiKey ?? '' };
  }

  private body(messages: ChatMessage[], options: CallOptions, maxTokens: number, extra: object = {}) {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    return {
      ...(system && { systemInstruction: { parts: [{ text: system }] } }),
      contents: messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: {
        maxOutputTokens: options.maxTokens ?? maxTokens,
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...extra,
      },
    };
  }

  /** Texte visible de la réponse ; lève content_filter si Gemini a bloqué le contenu. */
  private read(json: GeminiResponse): { text: string; usage?: TokenUsage } {
    if (json.promptFeedback?.blockReason) throw new LLMError('content_filter', this.name);
    const candidate = json.candidates?.[0];
    if (candidate?.finishReason && BLOCKED.has(candidate.finishReason)) {
      throw new LLMError('content_filter', this.name);
    }
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('');
    const u = json.usageMetadata;
    const usage = u ? { inputTokens: u.promptTokenCount ?? 0, outputTokens: u.candidatesTokenCount ?? 0 } : undefined;
    return { text, usage };
  }

  async *chat(messages: ChatMessage[], options: CallOptions = {}): AsyncIterable<ChatChunk> {
    const signal = deadline(this.config.timeoutMs, options.signal);
    const res = await postJson(
      this.name,
      `${this.url(this.model, 'streamGenerateContent')}?alt=sse`,
      this.body(messages, options, DEFAULT_MAX_TOKENS.chat),
      this.headers(),
      signal,
    );
    let usage: TokenUsage | undefined;
    for await (const data of readSse(this.name, res, signal)) {
      let json: GeminiResponse;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      const chunk = this.read(json);
      if (chunk.text) yield { type: 'delta', text: chunk.text };
      if (chunk.usage) usage = chunk.usage;
    }
    yield { type: 'done', usage, provider: this.name, model: this.model };
  }

  private async complete(model: string, body: object, options: CallOptions) {
    const signal = deadline(this.config.timeoutMs, options.signal);
    const res = await postJson(this.name, this.url(model, 'generateContent'), body, this.headers(), signal);
    return this.read((await res.json()) as GeminiResponse);
  }

  generate<T>(prompt: string, schema: OutputSchema<T>, options: CallOptions = {}): Promise<GenerateResult<T>> {
    return withRepair(async (isRetry) => {
      const content =
        prompt + jsonInstruction(schema) + (isRetry ? '\nAttention : ta réponse précédente n’était pas un JSON valide.' : '');
      const { text, usage } = await this.complete(
        this.model,
        this.body([{ role: 'user', content }], options, DEFAULT_MAX_TOKENS.generate, {
          responseMimeType: 'application/json',
        }),
        options,
      );
      return { data: parseStructured(this.name, text, schema), usage, provider: this.name, model: this.model };
    });
  }

  async vision(image: ImageInput, prompt: string, options: CallOptions = {}): Promise<VisionResult> {
    const model = this.config.visionModel ?? this.model;
    const parts: Part[] = [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: image.data.toString('base64') } }];
    const { text, usage } = await this.complete(
      model,
      {
        contents: [{ role: 'user', parts }],
        generationConfig: { maxOutputTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS.vision },
      },
      options,
    );
    return { text, usage, provider: this.name, model };
  }
}
