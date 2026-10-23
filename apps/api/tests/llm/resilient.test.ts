import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LLMError, type LLMErrorKind } from '../../src/llm/errors.js';
import { ResilientProvider, type LLMCallRecord } from '../../src/llm/resilient.js';
import type { ChatChunk, LLMProvider, ProviderName } from '../../src/llm/types.js';

/** Fournisseur scripté : échoue selon la liste, puis réussit. */
function scripted(name: ProviderName, failures: (LLMErrorKind | { kind: LLMErrorKind; retryAfterMs: number })[] = []) {
  let calls = 0;
  const nextFailure = () => {
    const f = failures[calls++];
    if (!f) return null;
    return typeof f === 'string' ? new LLMError(f, name) : new LLMError(f.kind, name, undefined, f.retryAfterMs);
  };
  const provider: LLMProvider & { calls(): number } = {
    name,
    model: `${name}-model`,
    calls: () => calls,
    async *chat() {
      const failure = nextFailure();
      if (failure) throw failure;
      yield { type: 'delta', text: `réponse de ${name}` };
      yield { type: 'done', provider: name, model: `${name}-model`, usage: { inputTokens: 3, outputTokens: 4 } };
    },
    async generate<T>() {
      const failure = nextFailure();
      if (failure) throw failure;
      return { data: { ok: name } as T, provider: name, model: `${name}-model` };
    },
    async vision() {
      const failure = nextFailure();
      if (failure) throw failure;
      return { text: name, provider: name, model: `${name}-model` };
    },
  };
  return provider;
}

function setup(primary: LLMProvider, fallback: LLMProvider | null = null, overrides = {}) {
  const log: LLMCallRecord[] = [];
  const llm = new ResilientProvider(primary, fallback, {
    maxRetries: 2,
    baseDelayMs: 1,
    maxDelayMs: 50,
    log: (r) => {
      log.push(r);
    },
    ...overrides,
  });
  return { llm, log };
}

const schema = z.object({ ok: z.string() });
const text = async (stream: AsyncIterable<ChatChunk>) => {
  let out = '';
  for await (const c of stream) if (c.type === 'delta') out += c.text;
  return out;
};

describe('ResilientProvider', () => {
  it('réessaie une erreur passagère puis réussit sur le même fournisseur', async () => {
    const primary = scripted('mistral', ['rate_limit', 'unavailable']);
    const { llm, log } = setup(primary, scripted('gemini'));
    expect((await llm.generate('x', schema)).data).toEqual({ ok: 'mistral' });
    expect(primary.calls()).toBe(3);
    expect(log.map((l) => l.status)).toEqual(['rate_limit', 'unavailable', 'ok']);
  });

  it('quota épuisé : passe directement au repli, sans réessai', async () => {
    const primary = scripted('mistral', ['quota']);
    const { llm, log } = setup(primary, scripted('gemini'));
    expect((await llm.generate('x', schema)).data).toEqual({ ok: 'gemini' });
    expect(primary.calls()).toBe(1);
    expect(log.at(-1)).toMatchObject({ provider: 'gemini', fallbackUsed: true, status: 'ok' });
  });

  it('clé invalide : repli', async () => {
    const { llm } = setup(scripted('claude', ['auth']), scripted('mistral'));
    expect((await llm.vision({ data: Buffer.from(''), mimeType: 'image/png' }, 'x')).text).toBe('mistral');
  });

  it('attente Retry-After trop longue : repli au lieu de faire patienter l’apprenti', async () => {
    const primary = scripted('mistral', [{ kind: 'rate_limit', retryAfterMs: 60_000 }]);
    const started = Date.now();
    const { llm } = setup(primary, scripted('gemini'));
    expect((await llm.generate('x', schema)).data).toEqual({ ok: 'gemini' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('sans repli : renvoie la dernière erreur après les réessais', async () => {
    const { llm } = setup(scripted('mistral', ['unavailable', 'unavailable', 'unavailable']));
    await expect(llm.generate('x', schema)).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('tout échoue : erreur du dernier fournisseur essayé', async () => {
    const { llm } = setup(scripted('mistral', ['quota']), scripted('gemini', ['auth']));
    await expect(llm.generate('x', schema)).rejects.toMatchObject({ kind: 'auth', provider: 'gemini' });
  });

  it('contenu refusé : pas de repli (un autre modèle n’y changerait rien)', async () => {
    const fallback = scripted('gemini');
    const { llm } = setup(scripted('mistral', ['content_filter']), fallback);
    await expect(llm.generate('x', schema)).rejects.toMatchObject({ kind: 'content_filter' });
    expect(fallback.calls()).toBe(0);
  });

  it('chat : le repli marche tant que rien n’a été envoyé', async () => {
    const { llm, log } = setup(scripted('mistral', ['quota']), scripted('gemini'));
    expect(await text(llm.chat([{ role: 'user', content: 'x' }]))).toBe('réponse de gemini');
    expect(log.at(-1)).toMatchObject({ provider: 'gemini', fallbackUsed: true, status: 'ok', usage: { inputTokens: 3, outputTokens: 4 } });
  });

  it('chat : coupure en pleine réponse → erreur journalisée, pas de bascule', async () => {
    const broken: LLMProvider = {
      ...scripted('mistral'),
      async *chat() {
        yield { type: 'delta', text: 'Quelle ' };
        throw new LLMError('unavailable', 'mistral');
      },
    };
    const fallback = scripted('gemini');
    const { llm, log } = setup(broken, fallback);
    await expect(text(llm.chat([{ role: 'user', content: 'x' }]))).rejects.toMatchObject({ kind: 'unavailable' });
    expect(fallback.calls()).toBe(0);
    expect(log.at(-1)).toMatchObject({ provider: 'mistral', status: 'unavailable' });
  });

  it('le journal ne contient jamais le contenu des échanges', async () => {
    const { llm, log } = setup(scripted('mistral'));
    await text(llm.chat([{ role: 'user', content: 'Mon adresse secrète' }], { userId: 'u1', purpose: 'chat' }));
    expect(Object.keys(log[0]!).sort()).toEqual(
      ['fallbackUsed', 'latencyMs', 'model', 'provider', 'purpose', 'status', 'usage', 'userId'].sort(),
    );
    expect(JSON.stringify(log)).not.toMatch(/adresse|réponse de/);
  });

  it('une panne du journal ne fait pas échouer la réponse', async () => {
    const { llm } = setup(scripted('mistral'), null, {
      log: () => {
        throw new Error('base indisponible');
      },
    });
    expect((await llm.generate('x', schema)).data).toEqual({ ok: 'mistral' });
  });
});
