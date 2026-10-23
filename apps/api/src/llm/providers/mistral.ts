import type { ProviderName } from '../types.js';
import { OpenAICompatibleProvider, type HttpProviderConfig } from './openai-compatible.js';

/**
 * Mistral AI (hébergé dans l'UE). Même format que l'API OpenAI,
 * avec sorties JSON contraintes par schéma.
 */
export class MistralProvider extends OpenAICompatibleProvider {
  override readonly name: ProviderName = 'mistral';

  constructor(config: HttpProviderConfig) {
    super({ ...config, baseUrl: config.baseUrl ?? 'https://api.mistral.ai/v1' });
    this.jsonMode = 'json_schema';
  }
}
