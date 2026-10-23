import type { Env } from '../config/env.js';
import { ClaudeProvider } from './providers/claude.js';
import { GeminiProvider } from './providers/gemini.js';
import { MistralProvider } from './providers/mistral.js';
import { MockProvider } from './providers/mock.js';
import { OpenAICompatibleProvider } from './providers/openai-compatible.js';
import { ResilientProvider, type LLMCallRecord } from './resilient.js';
import type { LLMProvider, ProviderName } from './types.js';

export interface ProviderSpec {
  provider: ProviderName;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  visionModel?: string;
}

/** Seul endroit qui associe un nom de fournisseur à son adaptateur. */
export function createProvider(spec: ProviderSpec, env: Env): LLMProvider {
  if (spec.provider === 'mock') return new MockProvider({ delayMs: env.MOCK_DELAY_MS, fail: env.MOCK_FAIL });
  const config = {
    model: spec.model!,
    apiKey: spec.apiKey,
    baseUrl: spec.baseUrl,
    visionModel: spec.visionModel,
    timeoutMs: env.LLM_TIMEOUT_MS,
  };
  switch (spec.provider) {
    case 'mistral':
      return new MistralProvider(config);
    case 'gemini':
      return new GeminiProvider(config);
    case 'claude':
      return new ClaudeProvider(config);
    case 'openai-compatible':
      return new OpenAICompatibleProvider(config);
  }
}

/** Fournisseur principal + repli facultatif, d'après les variables d'environnement. */
export function createLLM(env: Env, log?: (record: LLMCallRecord) => void | Promise<void>): ResilientProvider {
  const primary = createProvider(
    {
      provider: env.LLM_PROVIDER,
      model: env.LLM_MODEL,
      apiKey: env.LLM_API_KEY,
      baseUrl: env.LLM_BASE_URL,
      visionModel: env.LLM_VISION_MODEL,
    },
    env,
  );
  const fallback = env.LLM_FALLBACK_PROVIDER
    ? createProvider(
        {
          provider: env.LLM_FALLBACK_PROVIDER,
          model: env.LLM_FALLBACK_MODEL,
          apiKey: env.LLM_FALLBACK_API_KEY,
          baseUrl: env.LLM_FALLBACK_BASE_URL,
          visionModel: env.LLM_FALLBACK_VISION_MODEL,
        },
        env,
      )
    : null;
  return new ResilientProvider(primary, fallback, {
    maxRetries: env.LLM_MAX_RETRIES,
    baseDelayMs: env.LLM_RETRY_BASE_MS,
    maxDelayMs: env.LLM_RETRY_MAX_WAIT_MS,
    log,
  });
}
