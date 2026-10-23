import request from 'supertest';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO, apprentiAgent, formateurAgent, setup } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => ctx.close());

const register = (pseudo: string, aPlusDe15Ans = true) =>
  request
    .agent(ctx.app)
    .post('/api/auth/apprenti/inscription')
    .send({ code: DEMO.classCode, pseudo, pin: '305718', aPlusDe15Ans, accepteCgu: true, accepteTuteurIa: true })
    .expect(201);

describe('mes données (RGPD)', () => {
  it('exporte ses données sans aucun secret', async () => {
    const agent = await apprentiAgent(ctx.app, 'Truelle', DEMO.apprentis[0]!.pin);
    const res = await agent.get('/api/me/export').expect(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.body.compte).toMatchObject({ pseudo: 'Truelle', role: 'apprenti' });
    expect(res.body.consentements.map((c: { type: string }) => c.type).sort()).toEqual(['cgu', 'ia_tuteur']);
    expect(JSON.stringify(res.body)).not.toMatch(/pin|scrypt|token/i);
  });

  it('un apprenti de 15 ans ou plus retire puis redonne son accord', async () => {
    const agent = await apprentiAgent(ctx.app, 'Niveau', DEMO.apprentis[1]!.pin);
    let res = await agent.post('/api/me/consentements').send({ type: 'ia_tuteur', accord: false }).expect(200);
    expect(res.body.tuteurIaAutorise).toBe(false);
    res = await agent.post('/api/me/consentements').send({ type: 'ia_tuteur', accord: true }).expect(200);
    expect(res.body.tuteurIaAutorise).toBe(true);
  });

  it('un moins de 15 ans ne peut pas donner l’accord lui-même', async () => {
    const agent = await apprentiAgent(ctx.app, 'Equerre', DEMO.apprentis[2]!.pin);
    const res = await agent.post('/api/me/consentements').send({ type: 'ia_tuteur', accord: true }).expect(403);
    expect(res.body.error).toMatch(/parents/);
  });

  it('supprime son compte : confirmation exigée, puis effacement en cascade', async () => {
    const agent = request.agent(ctx.app);
    await agent
      .post('/api/auth/apprenti/inscription')
      .send({ code: DEMO.classCode, pseudo: 'Ephemere', pin: '305718', aPlusDe15Ans: true, accepteCgu: true, accepteTuteurIa: true })
      .expect(201);
    const { id } = (await agent.get('/api/me')).body;

    await agent.delete('/api/me').send({ confirmation: 'oui' }).expect(400);
    await agent.delete('/api/me').send({ confirmation: 'SUPPRIMER' }).expect(204);
    await agent.get('/api/me').expect(401);

    for (const table of ['users', 'class_members', 'consents', 'auth_sessions']) {
      const column = table === 'users' ? 'id' : 'user_id';
      const rows = await ctx.deps.db.execute(sql.raw(`select count(*)::int as n from ${table} where ${column} = '${id}'`));
      expect((rows as unknown as { rows: { n: number }[] }).rows[0]!.n, table).toBe(0);
    }
  });

  it('un formateur modifie son nom affiché, un apprenti non', async () => {
    const formateur = await formateurAgent(ctx.app);
    const res = await formateur.patch('/api/me').send({ pseudo: 'M. Démo' }).expect(200);
    expect(res.body.pseudo).toBe('M. Démo');
    const apprenti = await register('Rebelle');
    expect(apprenti.body.role).toBe('apprenti');
    const agent = await apprentiAgent(ctx.app, 'Rebelle', '305718');
    await agent.patch('/api/me').send({ pseudo: 'Autre' }).expect(403);
  });
});
