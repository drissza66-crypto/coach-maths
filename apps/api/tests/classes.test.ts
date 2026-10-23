import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO, apprentiAgent, formateurAgent, setup } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setup>>;
let formateur: Awaited<ReturnType<typeof formateurAgent>>;
let demoClassId: string;

beforeAll(async () => {
  ctx = await setup();
  formateur = await formateurAgent(ctx.app);
  const list = await formateur.get('/api/classes').expect(200);
  demoClassId = list.body[0].id;
});
afterAll(() => ctx.close());

const member = async (pseudo: string) => {
  const detail = await formateur.get(`/api/classes/${demoClassId}`).expect(200);
  return detail.body.apprentis.find((a: { pseudo: string }) => a.pseudo === pseudo);
};

describe('classes du formateur', () => {
  it('liste ses classes avec le nombre d’apprentis', async () => {
    const res = await formateur.get('/api/classes').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ code: DEMO.classCode, nbApprentis: 3, archivee: false });
  });

  it('crée une classe avec un code lisible de 6 caractères', async () => {
    const res = await formateur
      .post('/api/classes')
      .send({ nom: 'CAP Plombier 2', metier: 'plombier', niveau: 'CAP2' })
      .expect(201);
    expect(res.body.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(res.body.nbApprentis).toBe(0);
  });

  it('montre le détail des apprentis sans leurs secrets', async () => {
    const res = await formateur.get(`/api/classes/${demoClassId}`).expect(200);
    expect(res.body.apprentis.map((a: { pseudo: string }) => a.pseudo)).toEqual(['Equerre', 'Niveau', 'Truelle']);
    expect(JSON.stringify(res.body)).not.toMatch(/pin_?hash|scrypt/i);
    expect(await member('Equerre')).toMatchObject({ moinsDe15Ans: true, tuteurIaAutorise: false });
  });

  it('un autre formateur ne voit pas la classe', async () => {
    const other = await formateurAgent(ctx.app, 'autre@cfa.test');
    await other.get(`/api/classes/${demoClassId}`).expect(404);
    await other.post(`/api/classes/${demoClassId}/code`).expect(404);
    const list = await other.get('/api/classes').expect(200);
    expect(list.body).toEqual([]);
  });

  it('renvoie 404 pour un identifiant mal formé', async () => {
    await formateur.get('/api/classes/pas-un-uuid').expect(404);
  });

  it('régénère le code : l’ancien ne marche plus', async () => {
    const created = await formateur.post('/api/classes').send({ nom: 'Test code', metier: 'macon', niveau: 'CAP1' });
    const old = created.body.code;
    const res = await formateur.post(`/api/classes/${created.body.id}/code`).expect(200);
    expect(res.body.code).not.toBe(old);
    await request(ctx.app).post('/api/auth/apprenti/classe').send({ code: old }).expect(404);
    await request(ctx.app).post('/api/auth/apprenti/classe').send({ code: res.body.code }).expect(200);
  });

  it('une classe archivée n’accepte plus de connexion', async () => {
    const created = await formateur.post('/api/classes').send({ nom: 'Archive', metier: 'peintre', niveau: 'CAP1' });
    await formateur.patch(`/api/classes/${created.body.id}`).send({ archivee: true }).expect(200);
    await request(ctx.app).post('/api/auth/apprenti/classe').send({ code: created.body.code }).expect(404);
  });
});

describe('gestion des apprentis', () => {
  it('réinitialise le PIN : code provisoire, déverrouillage, changement obligatoire', async () => {
    const truelle = await member('Truelle');
    const session = await apprentiAgent(ctx.app, 'Truelle', DEMO.apprentis[0]!.pin);

    const res = await formateur.post(`/api/classes/${demoClassId}/apprentis/${truelle.id}/pin`).expect(200);
    expect(res.body.pinTemporaire).toMatch(/^\d{6}$/);
    await session.get('/api/me').expect(401);

    const agent = await apprentiAgent(ctx.app, 'Truelle', res.body.pinTemporaire);
    const me = await agent.get('/api/me').expect(200);
    expect(me.body.doitChangerPin).toBe(true);
    await agent.post('/api/auth/pin').send({ currentPin: res.body.pinTemporaire, newPin: '527193' }).expect(204);
    expect((await agent.get('/api/me')).body.doitChangerPin).toBe(false);
  });

  it('enregistre l’accord des représentants légaux pour un moins de 15 ans', async () => {
    const equerre = await member('Equerre');
    const res = await formateur
      .post(`/api/classes/${demoClassId}/apprentis/${equerre.id}/accord-parental`)
      .send({ accord: true })
      .expect(200);
    expect(res.body.apprentis.find((a: { id: string }) => a.id === equerre.id).tuteurIaAutorise).toBe(true);
  });

  it('refuse l’accord parental pour un apprenti de 15 ans ou plus', async () => {
    const niveau = await member('Niveau');
    await formateur
      .post(`/api/classes/${demoClassId}/apprentis/${niveau.id}/accord-parental`)
      .send({ accord: false })
      .expect(400);
  });

  it('supprime un apprenti et toutes ses données', async () => {
    await request(ctx.app)
      .post('/api/auth/apprenti/inscription')
      .send({ code: DEMO.classCode, pseudo: 'A supprimer', pin: '305718', aPlusDe15Ans: true, accepteCgu: true, accepteTuteurIa: true })
      .expect(201);
    const target = await member('A supprimer');
    await formateur.delete(`/api/classes/${demoClassId}/apprentis/${target.id}`).expect(204);
    expect(await member('A supprimer')).toBeUndefined();
    await request(ctx.app)
      .post('/api/auth/apprenti/connexion')
      .send({ code: DEMO.classCode, pseudo: 'A supprimer', pin: '305718' })
      .expect(401);
  });
});

describe('suppression d’une classe', () => {
  it('le formateur ne peut pas supprimer son compte tant qu’il a des apprentis', async () => {
    const res = await formateur.delete('/api/me').send({ confirmation: 'SUPPRIMER' }).expect(409);
    expect(res.body.error).toMatch(/Supprimez d’abord vos classes/);
  });

  it('supprime la classe et les comptes de ses apprentis, puis le compte formateur', async () => {
    await formateur.delete(`/api/classes/${demoClassId}`).send({ confirmation: 'non' }).expect(400);
    await formateur.delete(`/api/classes/${demoClassId}`).send({ confirmation: 'SUPPRIMER' }).expect(204);
    await formateur.get(`/api/classes/${demoClassId}`).expect(404);
    await request(ctx.app).post('/api/auth/apprenti/classe').send({ code: DEMO.classCode }).expect(404);

    for (const cls of (await formateur.get('/api/classes')).body) {
      await formateur.delete(`/api/classes/${cls.id}`).send({ confirmation: 'SUPPRIMER' }).expect(204);
    }
    await formateur.delete('/api/me').send({ confirmation: 'SUPPRIMER' }).expect(204);
    await formateur.get('/api/me').expect(401);
  });
});
