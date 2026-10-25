import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO, apprentiAgent, formateurAgent, setup } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => ctx.close());

const [truelle, niveau, equerre] = DEMO.apprentis;

describe('formateur : lien magique', () => {
  it('envoie un lien et ouvre une session', async () => {
    const agent = await formateurAgent(ctx.app);
    const me = await agent.get('/api/me').expect(200);
    expect(me.body).toMatchObject({ role: 'formateur', email: DEMO.formateurEmail });
    expect(me.body.classes).toHaveLength(1);
    expect(ctx.mailer.sent.at(-1)?.to).toBe(DEMO.formateurEmail);
  });

  it('crée un compte formateur pour un domaine autorisé', async () => {
    const agent = await formateurAgent(ctx.app, 'nouveau@cfa.test');
    const me = await agent.get('/api/me').expect(200);
    expect(me.body).toMatchObject({ role: 'formateur', pseudo: 'nouveau', classes: [] });
  });

  it('ne révèle rien et n’envoie rien pour un domaine non autorisé', async () => {
    const before = ctx.mailer.sent.length;
    const res = await request(ctx.app).post('/api/auth/formateur/lien').send({ email: 'pirate@gmail.com' }).expect(200);
    expect(res.body.devLink).toBeUndefined();
    expect(res.body.message).toMatch(/Si cette adresse est autorisée/);
    expect(ctx.mailer.sent.length).toBe(before);
  });

  it('refuse un lien déjà utilisé', async () => {
    const res = await request(ctx.app).post('/api/auth/formateur/lien').send({ email: DEMO.formateurEmail });
    const token = new URL(res.body.devLink).hash.replace('#token=', '');
    await request(ctx.app).post('/api/auth/formateur/verifier').send({ token }).expect(200);
    const again = await request(ctx.app).post('/api/auth/formateur/verifier').send({ token }).expect(400);
    expect(again.body.error).toMatch(/plus valable/);
  });

  it('refuse un lien expiré', async () => {
    const short = await setup({ MAGIC_LINK_TTL_MINUTES: '0.0001' });
    const res = await request(short.app).post('/api/auth/formateur/lien').send({ email: DEMO.formateurEmail });
    const token = new URL(res.body.devLink).hash.replace('#token=', '');
    await new Promise((r) => setTimeout(r, 50));
    await request(short.app).post('/api/auth/formateur/verifier').send({ token }).expect(400);
    await short.close();
  });

  it('ne renvoie jamais le lien en production', async () => {
    const prod = await setup({ NODE_ENV: 'production', COOKIE_SECURE: 'true' });
    const res = await request(prod.app).post('/api/auth/formateur/lien').send({ email: DEMO.formateurEmail }).expect(200);
    expect(res.body.devLink).toBeUndefined();
    expect(prod.mailer.sent).toHaveLength(1);
    await prod.close();
  });
});

describe('apprenti : code classe + pseudo + PIN', () => {
  it('vérifie un code classe saisi avec tiret et minuscules', async () => {
    const res = await request(ctx.app).post('/api/auth/apprenti/classe').send({ code: 'dal-le7' }).expect(200);
    expect(res.body).toEqual({ nom: 'CAP Maçon 1 — Démo', metier: 'macon', niveau: 'CAP1' });
  });

  it('refuse un code classe inconnu', async () => {
    const res = await request(ctx.app).post('/api/auth/apprenti/classe').send({ code: 'ZZZZZZ' }).expect(404);
    expect(res.body.error).toMatch(/Code classe inconnu/);
  });

  it('se connecte sans tenir compte des accents ni de la casse du pseudo', async () => {
    const agent = await apprentiAgent(ctx.app, 'TRUELLE', truelle!.pin);
    const me = await agent.get('/api/me').expect(200);
    expect(me.body).toMatchObject({ role: 'apprenti', pseudo: 'Truelle', tuteurIaAutorise: true });
  });

  it('donne le même message pour un mauvais PIN et un pseudo inconnu', async () => {
    const a = await request(ctx.app)
      .post('/api/auth/apprenti/connexion')
      .send({ code: DEMO.classCode, pseudo: 'Niveau', pin: '111222' })
      .expect(401);
    const b = await request(ctx.app)
      .post('/api/auth/apprenti/connexion')
      .send({ code: DEMO.classCode, pseudo: 'Fantome', pin: '111222' })
      .expect(401);
    expect(a.body.error).toBe(b.body.error);
  });

  it('verrouille le compte après 5 erreurs, même avec le bon PIN ensuite', async () => {
    const login = (pin: string) =>
      request(ctx.app).post('/api/auth/apprenti/connexion').send({ code: DEMO.classCode, pseudo: 'Equerre', pin });
    for (let i = 0; i < 4; i++) await login('999888').expect(401);
    const locked = await login('999888').expect(429);
    expect(locked.body.error).toMatch(/Trop d’essais/);
    await login(equerre!.pin).expect(429);
  });

  it('inscrit un apprenti de 15 ans ou plus avec son accord pour le tuteur IA', async () => {
    const agent = request.agent(ctx.app);
    const res = await agent
      .post('/api/auth/apprenti/inscription')
      .send({ code: DEMO.classCode, pseudo: 'Fil à plomb', pin: '305718', aPlusDe15Ans: true, accepteCgu: true, accepteTuteurIa: true })
      .expect(201);
    expect(res.body).toMatchObject({ pseudo: 'Fil à plomb', niveau: 'CAP1', moinsDe15Ans: false, tuteurIaAutorise: true });
    await agent.get('/api/me').expect(200);
  });

  it('n’active pas le tuteur IA pour un moins de 15 ans, même s’il coche', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/apprenti/inscription')
      .send({ code: DEMO.classCode, pseudo: 'Taloche', pin: '305718', aPlusDe15Ans: false, accepteCgu: true, accepteTuteurIa: true })
      .expect(201);
    expect(res.body).toMatchObject({ moinsDe15Ans: true, tuteurIaAutorise: false });
  });

  it('refuse un pseudo déjà pris dans la classe (accents et casse ignorés)', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/apprenti/inscription')
      .send({ code: DEMO.classCode, pseudo: 'niveau', pin: '305718', aPlusDe15Ans: true, accepteCgu: true, accepteTuteurIa: false })
      .expect(409);
    expect(res.body.error).toMatch(/déjà pris/);
  });

  it('refuse un PIN trop simple et l’absence d’accord aux règles', async () => {
    const base = { code: DEMO.classCode, pseudo: 'Gâcheuse', aPlusDe15Ans: true, accepteTuteurIa: false };
    const weak = await request(ctx.app)
      .post('/api/auth/apprenti/inscription')
      .send({ ...base, pin: '123456', accepteCgu: true })
      .expect(400);
    expect(weak.body.error).toMatch(/trop facile/);
    await request(ctx.app)
      .post('/api/auth/apprenti/inscription')
      .send({ ...base, pin: '305718', accepteCgu: false })
      .expect(400);
  });

  it('change son PIN et déconnecte ses autres appareils', async () => {
    const phone = await apprentiAgent(ctx.app, 'Niveau', niveau!.pin);
    const laptop = await apprentiAgent(ctx.app, 'Niveau', niveau!.pin);
    await phone.post('/api/auth/pin').send({ currentPin: niveau!.pin, newPin: '864209' }).expect(204);
    await phone.get('/api/me').expect(200);
    await laptop.get('/api/me').expect(401);
    await apprentiAgent(ctx.app, 'Niveau', '864209');
  });
});

describe('sessions et sécurité', () => {
  it('déconnexion : la session ne marche plus', async () => {
    const agent = await apprentiAgent(ctx.app, 'Truelle', truelle!.pin);
    await agent.post('/api/auth/deconnexion').expect(204);
    await agent.get('/api/me').expect(401);
  });

  it('pose un cookie httpOnly SameSite=Lax', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/apprenti/connexion')
      .send({ code: DEMO.classCode, pseudo: 'Truelle', pin: truelle!.pin })
      .expect(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it('bloque une requête d’écriture venant d’un autre site', async () => {
    await request(ctx.app)
      .post('/api/auth/apprenti/connexion')
      .set('Origin', 'https://site-malveillant.example')
      .send({ code: DEMO.classCode, pseudo: 'Truelle', pin: truelle!.pin })
      .expect(403);
  });

  it('accepte le PC lui-même sous son nom .local ou une autre IP (pilote sur réseau local)', async () => {
    for (const host of ['cfa661pt0446.local:3001', '192.168.1.77:3001']) {
      await request(ctx.app)
        .post('/api/auth/apprenti/connexion')
        .set('Host', host)
        .set('Origin', `http://${host}`)
        .send({ code: DEMO.classCode, pseudo: 'Truelle', pin: truelle!.pin })
        .expect(200);
    }
  });

  it('refuse un nom de domaine qui pointerait vers le PC (DNS rebinding)', async () => {
    await request(ctx.app)
      .post('/api/auth/apprenti/connexion')
      .set('Host', 'piege.example:3001')
      .set('Origin', 'http://piege.example:3001')
      .send({ code: DEMO.classCode, pseudo: 'Truelle', pin: truelle!.pin })
      .expect(403);
  });

  it('refuse une origine locale qui ne correspond pas au serveur appelé', async () => {
    await request(ctx.app)
      .post('/api/auth/apprenti/connexion')
      .set('Host', '192.168.1.50:3001')
      .set('Origin', 'http://192.168.1.99:8080')
      .send({ code: DEMO.classCode, pseudo: 'Truelle', pin: truelle!.pin })
      .expect(403);
  });

  it('un apprenti n’accède pas aux routes formateur', async () => {
    const agent = await apprentiAgent(ctx.app, 'Truelle', truelle!.pin);
    await agent.get('/api/classes').expect(403);
  });
});
