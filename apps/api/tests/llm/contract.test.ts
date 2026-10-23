import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LLMError } from '../../src/llm/errors.js';
import { ClaudeProvider } from '../../src/llm/providers/claude.js';
import { GeminiProvider } from '../../src/llm/providers/gemini.js';
import { MistralProvider } from '../../src/llm/providers/mistral.js';
import { MockProvider } from '../../src/llm/providers/mock.js';
import { OpenAICompatibleProvider, type HttpProviderConfig } from '../../src/llm/providers/openai-compatible.js';
import type { ChatChunk, LLMProvider } from '../../src/llm/types.js';
import { FakeLLMServer, STRUCTURED } from './fake-server.js';

/**
 * Contrat commun : chaque adaptateur doit se comporter pareil vu de l'application.
 * Ajouter un fournisseur = l'ajouter à ADAPTERS et faire passer ces tests.
 */
const server = new FakeLLMServer();
beforeAll(() => server.start());
afterAll(() => server.stop());
beforeEach(() => server.reset());

const config = (baseUrl: string): HttpProviderConfig => ({
  model: 'modele-test',
  apiKey: 'cle-de-test',
  baseUrl,
  visionModel: 'modele-vision-test',
  timeoutMs: 5000,
});

const ADAPTERS: { name: string; create(): LLMProvider }[] = [
  { name: 'openai-compatible', create: () => new OpenAICompatibleProvider(config(`${server.url}/v1`)) },
  { name: 'mistral', create: () => new MistralProvider(config(`${server.url}/v1`)) },
  { name: 'gemini', create: () => new GeminiProvider(config(`${server.url}/v1beta`)) },
  { name: 'claude', create: () => new ClaudeProvider(config(server.url)) },
];

const Fiche = z.object({ titre: z.string().min(3), questions: z.array(z.string()).min(1) });
const image = { data: Buffer.from('fausse-image'), mimeType: 'image/png' as const };
const messages = [
  { role: 'system' as const, content: 'Tu es un tuteur.' },
  { role: 'user' as const, content: 'Aide-moi pour l’aire.' },
];

async function collect(stream: AsyncIterable<ChatChunk>) {
  const chunks: ChatChunk[] = [];
  for await (const c of stream) chunks.push(c);
  return chunks;
}

async function expectKind(promise: Promise<unknown>, kind: LLMError['kind']) {
  const err = await promise.then(
    () => null,
    (e) => e,
  );
  expect(err, `attendu : ${kind}`).toBeInstanceOf(LLMError);
  expect((err as LLMError).kind).toBe(kind);
  return err as LLMError;
}

describe.each(ADAPTERS)('adaptateur $name', ({ name, create }) => {
  it('chat : streame le texte puis termine par "done" avec les jetons', async () => {
    const chunks = await collect(create().chat(messages));
    const text = chunks.flatMap((c) => (c.type === 'delta' ? [c.text] : [])).join('');
    expect(text).toBe('Quelle est la longueur ?');
    expect(chunks.filter((c) => c.type === 'delta').length).toBeGreaterThan(1);
    const done = chunks.at(-1)!;
    expect(done).toMatchObject({ type: 'done', provider: name, usage: { inputTokens: 12, outputTokens: 5 } });
  });

  it('chat : envoie la clé et le prompt système', async () => {
    await collect(create().chat(messages));
    const { headers, body } = server.last;
    const auth = headers.authorization ?? headers['x-api-key'] ?? headers['x-goog-api-key'];
    expect(String(auth)).toContain('cle-de-test');
    expect(JSON.stringify(body)).toContain('Tu es un tuteur.');
  });

  it('generate : renvoie un objet validé par le schéma', async () => {
    const result = await create().generate('Fais une fiche.', Fiche);
    expect(result.data).toEqual(STRUCTURED);
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 30 });
  });

  it('generate : redemande une fois si le JSON est invalide', async () => {
    server.reset('bad-json-once');
    const result = await create().generate('Fais une fiche.', Fiche);
    expect(result.data).toEqual(STRUCTURED);
    expect(server.requests).toHaveLength(2);
  });

  it('vision : envoie l’image au modèle de vision', async () => {
    const result = await create().vision(image, 'Recopie l’énoncé.');
    expect(result.model).toBe('modele-vision-test');
    const sent = JSON.stringify(server.last);
    expect(sent).toContain(image.data.toString('base64'));
    expect(sent).toContain('modele-vision-test');
  });

  it('429 avec Retry-After → rate_limit réessayable', async () => {
    server.reset('429');
    const err = await expectKind(create().generate('x', Fiche), 'rate_limit');
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(3000);
  });

  it('429 « quota dépassé » → quota (pas de réessai)', async () => {
    server.reset('429-quota');
    const err = await expectKind(collect(create().chat(messages)), 'quota');
    expect(err.retryable).toBe(false);
  });

  it('401 → auth', async () => {
    server.reset('401');
    await expectKind(collect(create().chat(messages)), 'auth');
  });

  it('5xx / surcharge → unavailable', async () => {
    server.reset('500');
    await expectKind(create().vision(image, 'x'), 'unavailable');
  });

  it('contenu bloqué par le fournisseur → content_filter', async () => {
    server.reset('filter');
    await expectKind(collect(create().chat(messages)), 'content_filter');
  });
});

describe('spécificités', () => {
  it('Claude : jamais de temperature (refusée par l’API)', async () => {
    await collect(new ClaudeProvider(config(server.url)).chat(messages, { temperature: 0.2 }));
    expect(server.last.body).not.toHaveProperty('temperature');
    expect(server.last.body.system).toBe('Tu es un tuteur.');
  });

  it('Claude : sortie JSON contrainte par schéma', async () => {
    await new ClaudeProvider(config(server.url)).generate('x', Fiche);
    expect(server.last.body.output_config).toMatchObject({ format: { type: 'json_schema' } });
  });

  it('Mistral : sortie JSON contrainte par schéma ; OpenAI-compatible : json_object', async () => {
    await new MistralProvider(config(`${server.url}/v1`)).generate('x', Fiche);
    expect(server.last.body.response_format).toMatchObject({ type: 'json_schema' });
    await new OpenAICompatibleProvider(config(`${server.url}/v1`)).generate('x', Fiche);
    expect(server.last.body.response_format).toEqual({ type: 'json_object' });
  });

  it('Gemini : le prompt système passe dans systemInstruction', async () => {
    await collect(new GeminiProvider(config(`${server.url}/v1beta`)).chat(messages));
    expect(server.last.body.systemInstruction).toEqual({ parts: [{ text: 'Tu es un tuteur.' }] });
    expect(server.last.path).toContain('modele-test:streamGenerateContent');
  });

  it('OpenAI-compatible sans clé (Ollama) : aucun en-tête Authorization', async () => {
    await collect(new OpenAICompatibleProvider({ ...config(`${server.url}/v1`), apiKey: undefined }).chat(messages));
    expect(server.last.headers.authorization).toBeUndefined();
  });

  it('serveur injoignable → unavailable', async () => {
    const dead = new OpenAICompatibleProvider(config('http://127.0.0.1:9/v1'));
    await expectKind(collect(dead.chat(messages)), 'unavailable');
  });

  it('délai dépassé → timeout', async () => {
    const slow = new OpenAICompatibleProvider({ ...config(`${server.url}/v1`), timeoutMs: 1 });
    await expectKind(collect(slow.chat(messages)), 'timeout');
  });

  it('annulation par l’apprenti → aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const p = new OpenAICompatibleProvider(config(`${server.url}/v1`));
    await expectKind(collect(p.chat(messages, { signal: controller.signal })), 'aborted');
  });

  it('le mock respecte le même contrat', async () => {
    const mock = new MockProvider();
    const chunks = await collect(mock.chat(messages));
    expect(chunks.at(-1)).toMatchObject({ type: 'done', provider: 'mock' });
    expect(Fiche.safeParse((await mock.generate('x', Fiche)).data).success).toBe(true);
  });
});
