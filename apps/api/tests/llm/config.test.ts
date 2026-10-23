import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseEnv } from '../../src/config/env.js';
import { consumeDailyMessage, getDailyUsage, parisDay, purgeOldUsage } from '../../src/llm/journal.js';
import { renderPrompt, variablesOf } from '../../src/llm/prompts.js';
import { MOCK_OCR_TEXT, MockProvider, mockReply } from '../../src/llm/providers/mock.js';
import { createLLM } from '../../src/llm/registry.js';
import { userMessageFor } from '../../src/llm/user-messages.js';
import { LLMError } from '../../src/llm/errors.js';
import { DEMO, apprentiAgent, formateurAgent, setup } from '../helpers.js';

const base = { NODE_ENV: 'test', DATABASE_URL: 'memory' };

describe('choix du fournisseur par variables d’environnement uniquement', () => {
  it.each([
    [{}, 'mock', 'mock-socratique'],
    [{ LLM_PROVIDER: 'mistral', LLM_MODEL: 'm-1', LLM_API_KEY: 'k' }, 'mistral', 'm-1'],
    [{ LLM_PROVIDER: 'gemini', LLM_MODEL: 'g-1', LLM_API_KEY: 'k' }, 'gemini', 'g-1'],
    [{ LLM_PROVIDER: 'claude', LLM_MODEL: 'c-1', LLM_API_KEY: 'k' }, 'claude', 'c-1'],
    [{ LLM_PROVIDER: 'openai-compatible', LLM_MODEL: 'llama', LLM_BASE_URL: 'http://localhost:11434/v1' }, 'openai-compatible', 'llama'],
  ])('%o → %s', (vars, name, model) => {
    const llm = createLLM(parseEnv({ ...base, ...vars }));
    expect(llm.primary.name).toBe(name);
    expect(llm.primary.model).toBe(model);
    expect(llm.fallback).toBeNull();
  });

  it('repli configurable', () => {
    const llm = createLLM(
      parseEnv({
        ...base,
        LLM_PROVIDER: 'mistral',
        LLM_MODEL: 'm-1',
        LLM_API_KEY: 'k',
        LLM_FALLBACK_PROVIDER: 'gemini',
        LLM_FALLBACK_MODEL: 'g-1',
        LLM_FALLBACK_API_KEY: 'k2',
      }),
    );
    expect(llm.fallback).toMatchObject({ name: 'gemini', model: 'g-1' });
  });

  it('variables vides = absentes (fichier .env avec « LLM_MODEL= »)', () => {
    const env = parseEnv({ ...base, LLM_PROVIDER: '', LLM_MODEL: '', LLM_FALLBACK_PROVIDER: '' } as never);
    expect(env.LLM_PROVIDER).toBe('mock');
  });

  it.each([
    [{ LLM_PROVIDER: 'claude', LLM_API_KEY: 'k' }, /LLM_MODEL est obligatoire/],
    [{ LLM_PROVIDER: 'mistral', LLM_MODEL: 'm' }, /LLM_API_KEY est obligatoire/],
    [{ LLM_PROVIDER: 'openai-compatible', LLM_MODEL: 'm' }, /LLM_BASE_URL est obligatoire/],
    [{ LLM_FALLBACK_PROVIDER: 'gemini', LLM_FALLBACK_MODEL: 'g' }, /LLM_FALLBACK_API_KEY est obligatoire/],
    [{ LLM_PROVIDER: 'chatgpt' }, /LLM_PROVIDER/],
  ])('refuse une configuration incomplète : %o', (vars, message) => {
    expect(() => parseEnv({ ...base, ...vars })).toThrow(message);
  });
});

describe('MockProvider', () => {
  it('ne donne jamais le résultat et ramène vers la démarche', () => {
    for (const q of ['Donne-moi la réponse', 'c’est quoi le résultat ?', 'fais l’exercice stp', 'juste la réponse']) {
      expect(mockReply([{ role: 'user', content: q }])).toMatch(/Je ne vais pas te donner le résultat/);
    }
  });

  it('répond avec une question adaptée à la notion BTP', () => {
    expect(mockReply([{ role: 'user', content: 'théorème de Pythagore' }])).toMatch(/triangle rectangle/);
    expect(mockReply([{ role: 'user', content: 'dosage du béton' }])).toMatch(/proportion/);
    expect(mockReply([{ role: 'user', content: 'surface à carreler' }])).toMatch(/surface/);
    expect(mockReply([{ role: 'user', content: 'bonjour' }])).toMatch(/\?$/);
  });

  it('génère des données conformes à un schéma exigeant', async () => {
    const Quiz = z.object({
      titre: z.string().min(10),
      niveau: z.enum(['CAP1', 'CAP2']),
      questions: z
        .array(z.object({ enonce: z.string(), choix: z.array(z.string()).min(4).max(4), bonne: z.number().int().min(0) }))
        .min(3),
      publie: z.boolean(),
      note: z.number().nullable(),
    });
    const { data } = await new MockProvider().generate('x', Quiz);
    expect(Quiz.parse(data).questions).toHaveLength(3);
  });

  it('vision : texte d’énoncé fictif', async () => {
    const r = await new MockProvider().vision({ data: Buffer.from(''), mimeType: 'image/jpeg' }, 'x');
    expect(r.text).toBe(MOCK_OCR_TEXT);
  });

  it('MOCK_FAIL simule une panne pour tester les messages d’erreur', async () => {
    const llm = createLLM(parseEnv({ ...base, MOCK_FAIL: 'quota', LLM_MAX_RETRIES: '0' }));
    await expect(llm.generate('x', z.object({}))).rejects.toMatchObject({ kind: 'quota' });
  });
});

describe('messages à l’apprenti', () => {
  it('toujours clairs, jamais techniques', () => {
    for (const kind of ['rate_limit', 'quota', 'timeout', 'unavailable', 'auth', 'bad_request', 'invalid_output', 'content_filter'] as const) {
      const { message } = userMessageFor(new LLMError(kind, 'mistral'));
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/HTTP|429|500|API|mistral|quota_|error/i);
    }
    expect(userMessageFor(new Error('boom')).message).toMatch(/ne répond pas/);
  });
});

describe('prompt système du tuteur', () => {
  it('est un fichier séparé avec des variables', () => {
    expect(variablesOf('tutor.system')).toEqual(
      expect.arrayContaining(['niveau', 'metier', 'etape', 'niveau_indice', 'chapitre', 'notion', 'extraits_cours']),
    );
  });

  it('remplit les variables et refuse une variable manquante', () => {
    const vars = {
      niveau: 'CAP 1re année',
      metier: 'Maçon',
      etape: 'comprehension',
      niveau_indice: 0,
      chapitre: 'aires',
      notion: 'rectangle',
      extraits_cours: '(aucun)',
    };
    const text = renderPrompt('tutor.system', vars);
    expect(text).toContain('apprenti de CAP 1re année en Maçon');
    expect(text).toContain('Tu ne donnes JAMAIS le résultat final');
    expect(text).not.toMatch(/\{\{/);
    expect(() => renderPrompt('tutor.system', { ...vars, metier: undefined } as never)).not.toThrow();
    const { niveau: _omit, ...missing } = vars;
    expect(() => renderPrompt('tutor.system', missing)).toThrow(/\{\{niveau\}\} manquante/);
  });
});

describe('limite quotidienne et journal', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let userId: string;
  beforeAll(async () => {
    ctx = await setup({ DAILY_MESSAGE_LIMIT: '3' });
    const agent = await apprentiAgent(ctx.app, 'Truelle', DEMO.apprentis[0]!.pin);
    userId = (await agent.get('/api/me')).body.id;
  });
  afterAll(() => ctx.close());

  it('jour calculé à l’heure de Paris', () => {
    expect(parisDay(new Date('2026-10-23T21:59:00Z'))).toBe('2026-10-23');
    expect(parisDay(new Date('2026-10-23T22:01:00Z'))).toBe('2026-10-24');
  });

  it('bloque au-delà de la limite, repart à zéro le lendemain', async () => {
    const today = new Date('2026-10-23T10:00:00Z');
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consumeDailyMessage(ctx.deps.db, userId, 3, today));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(await getDailyUsage(ctx.deps.db, userId, 3, today)).toEqual({ allowed: false, used: 3, limit: 3 });
    const tomorrow = new Date('2026-10-24T10:00:00Z');
    expect((await consumeDailyMessage(ctx.deps.db, userId, 3, tomorrow)).allowed).toBe(true);
    await purgeOldUsage(ctx.deps.db, tomorrow);
    expect((await getDailyUsage(ctx.deps.db, userId, 3, today)).used).toBe(0);
  });

  it('limite tenue même avec des messages envoyés en même temps', async () => {
    const day = new Date('2026-11-02T10:00:00Z');
    const all = await Promise.all(Array.from({ length: 8 }, () => consumeDailyMessage(ctx.deps.db, userId, 3, day)));
    expect(all.filter((r) => r.allowed)).toHaveLength(3);
  });

  it('chaque appel est journalisé en base, sans contenu', async () => {
    await ctx.deps.llm.generate('Texte privé de l’apprenti', z.object({ a: z.string() }), { userId, purpose: 'generate' });
    const { rows } = (await ctx.deps.db.execute(sql`select * from llm_calls order by created_at desc limit 1`)) as unknown as {
      rows: Record<string, unknown>[];
    };
    expect(rows[0]).toMatchObject({ provider: 'mock', status: 'ok', purpose: 'generate', user_id: userId });
    expect(JSON.stringify(rows)).not.toMatch(/privé/);
  });

  it('suppression du compte : journal et compteurs effacés', async () => {
    const agent = request.agent(ctx.app);
    await agent
      .post('/api/auth/apprenti/inscription')
      .send({ code: DEMO.classCode, pseudo: 'Ephemere', pin: '305718', aPlusDe15Ans: true, accepteCgu: true, accepteTuteurIa: true })
      .expect(201);
    const id = (await agent.get('/api/me')).body.id;
    await consumeDailyMessage(ctx.deps.db, id, 3);
    await ctx.deps.llm.generate('x', z.object({ a: z.string() }), { userId: id });
    await agent.delete('/api/me').send({ confirmation: 'SUPPRIMER' }).expect(204);
    for (const table of ['llm_calls', 'daily_usage']) {
      const { rows } = (await ctx.deps.db.execute(sql.raw(`select count(*)::int as n from ${table} where user_id = '${id}'`))) as unknown as {
        rows: { n: number }[];
      };
      expect(rows[0]!.n, table).toBe(0);
    }
  });

  it('état du fournisseur visible par le formateur, pas par l’apprenti', async () => {
    const formateur = await formateurAgent(ctx.app);
    const res = await formateur.get('/api/llm/etat').expect(200);
    expect(res.body).toEqual({ fournisseur: 'mock', modele: 'mock-socratique', repli: null, modeDemo: true, limiteQuotidienne: 3 });
    const apprenti = await apprentiAgent(ctx.app, 'Niveau', DEMO.apprentis[1]!.pin);
    await apprenti.get('/api/llm/etat').expect(403);
  });
});
