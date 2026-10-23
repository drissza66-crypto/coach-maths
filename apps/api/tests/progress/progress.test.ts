import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Quiz } from '@mathsuivi/shared';
import { recordActivity, weekStart, weeklySeries } from '../../src/modules/progress/activity.js';
import { questionsToReview } from '../../src/modules/progress/service.js';
import { DEMO, apprentiAgent, formateurAgent, setup } from '../helpers.js';

const QUIZ: Quiz = {
  titre: 'Q',
  questions: [
    { enonce: 'Q1', choix: ['a', 'b', 'c', 'd'], bonne_reponse: 0, explication: 'Explication 1' },
    { enonce: 'Q2', choix: ['a', 'b', 'c', 'd'], bonne_reponse: 1, explication: 'Explication 2' },
    { enonce: 'Q3', choix: ['a', 'b', 'c', 'd'], bonne_reponse: 2, explication: 'Explication 3' },
  ],
};
const at = (iso: string) => new Date(iso);
const attempt = (date: string, answers: [string, boolean][], body: Quiz = QUIZ) => ({
  createdAt: at(date),
  chapitre: 'aires_volumes',
  body,
  reponses: answers.map(([enonce, correct]) => ({ enonce, reponse: correct ? 0 : 3, correct })),
});

describe('semaines', () => {
  it('lundi de la semaine', () => {
    expect(weekStart('2026-10-23')).toBe('2026-10-19'); // vendredi → lundi
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
    expect(weekStart('2026-10-25')).toBe('2026-10-19'); // dimanche
  });

  it('série des 6 dernières semaines, semaines vides comprises', () => {
    const series = weeklySeries(
      [
        { day: '2026-10-20', secondes: 600 },
        { day: '2026-10-22', secondes: 300 },
        { day: '2026-10-07', secondes: 120 },
        { day: '2026-01-01', secondes: 999 }, // hors fenêtre
      ],
      '2026-10-23',
    );
    expect(series.map((s) => s.debut)).toEqual(['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']);
    expect(series.map((s) => s.secondes)).toEqual([0, 0, 0, 120, 0, 900]);
  });
});

describe('questions à revoir', () => {
  it('garde les questions dont la dernière réponse est fausse, les plus ratées d’abord', () => {
    const list = questionsToReview([
      attempt('2026-10-01T10:00:00Z', [['Q1', false], ['Q2', false], ['Q3', false]]),
      attempt('2026-10-02T10:00:00Z', [['Q1', true], ['Q2', false], ['Q3', true]]),
      attempt('2026-10-03T10:00:00Z', [['Q3', false]]),
    ]);
    // Q1 réussie depuis : disparue. Q2 ratée 2 fois, Q3 ratée 2 fois mais plus récemment.
    expect(list.map((q) => q.enonce)).toEqual(['Q3', 'Q2']);
    expect(list[1]).toMatchObject({ fois: 2, bonneReponse: 'b', explication: 'Explication 2', chapitre: 'aires_volumes' });
  });

  it('ignore une question retirée du quiz et les anciennes tentatives sans énoncé', () => {
    const sansQ2 = { ...QUIZ, questions: QUIZ.questions.filter((q) => q.enonce !== 'Q2') };
    const list = questionsToReview([
      attempt('2026-10-01T10:00:00Z', [['Q2', false]], sansQ2),
      { createdAt: at('2026-10-02T10:00:00Z'), chapitre: null, body: QUIZ, reponses: [{ reponse: 3, correct: false }] },
    ]);
    expect(list).toEqual([]);
  });
});

describe('suivi des progrès (API)', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let truelle: request.Agent;
  let truelleId: string;
  let formateur: request.Agent;
  let classId: string;

  beforeAll(async () => {
    ctx = await setup();
    formateur = await formateurAgent(ctx.app);
    classId = (await formateur.get('/api/classes')).body[0].id;
    truelle = await apprentiAgent(ctx.app, 'Truelle', DEMO.apprentis[0]!.pin);
    truelleId = (await truelle.get('/api/me')).body.id;

    const quiz = await formateur.post('/api/contenus/generer').send({ classId, type: 'quiz', notion: 'aires', nombre: 3 }).expect(201);
    await formateur.post(`/api/contenus/${quiz.body.id}/publication`).send({ publie: true });
    const q = quiz.body.body as Quiz;
    // 1re question fausse, les autres justes.
    const reponses = q.questions.map((x, i) => (i === 0 ? (x.bonne_reponse + 1) % 4 : x.bonne_reponse));
    await truelle.post(`/api/revisions/${quiz.body.id}/tentatives`).send({ reponses }).expect(201);
  });
  afterAll(() => ctx.close());

  it('battement d’activité : une minute par minute, deux onglets ne comptent pas double', async () => {
    const t0 = new Date('2026-10-23T08:00:00Z');
    await recordActivity(ctx.deps.db, truelleId, t0);
    await recordActivity(ctx.deps.db, truelleId, new Date(t0.getTime() + 5_000)); // 2e onglet
    await recordActivity(ctx.deps.db, truelleId, new Date(t0.getTime() + 60_000));
    const { rows } = (await ctx.deps.db.execute(
      sql.raw(`select secondes from activity_days where user_id = '${truelleId}' and day = '2026-10-23'`),
    )) as unknown as { rows: { secondes: number }[] };
    expect(rows[0]!.secondes).toBe(120);
  });

  it('« Mes progrès » : semaine, notions et questions à revoir', async () => {
    await truelle.post('/api/activite').expect(204);
    const res = await truelle.get('/api/progres').expect(200);
    expect(res.body.pseudo).toBe('Truelle');
    expect(res.body.semaine).toMatchObject({ quiz: 1, moyenneQuiz: 0.67 });
    expect(res.body.semaine.joursActifs).toBeGreaterThanOrEqual(1);
    expect(res.body.semaine.secondes).toBeGreaterThanOrEqual(60);
    expect(res.body.semaines).toHaveLength(6);
    expect(res.body.chapitres[0]).toMatchObject({ chapitre: 'aires_volumes', reponsesQuiz: 3, statut: 'en_cours' });
    expect(res.body.aRevoir).toHaveLength(1);
    expect(res.body.aRevoir[0].explication.length).toBeGreaterThan(5);
  });

  it('le temps des formateurs n’est pas suivi', async () => {
    await formateur.post('/api/activite').expect(204);
    const { rows } = (await ctx.deps.db.execute(sql`select count(*)::int n from activity_days`)) as unknown as { rows: { n: number }[] };
    const apprentiRows = (await ctx.deps.db.execute(
      sql.raw(`select count(*)::int n from activity_days where user_id = '${truelleId}'`),
    )) as unknown as { rows: { n: number }[] };
    expect(rows[0]!.n).toBe(apprentiRows.rows[0]!.n);
    await formateur.get('/api/progres').expect(403);
  });

  it('le formateur voit la fiche de suivi d’un apprenti de sa classe', async () => {
    const res = await formateur.get(`/api/tableau-de-bord/classes/${classId}/apprentis/${truelleId}`).expect(200);
    expect(res.body).toMatchObject({ pseudo: 'Truelle' });
    expect(res.body.aRevoir).toHaveLength(1);
  });

  it('cloisonnement de la fiche de suivi', async () => {
    const autre = await formateurAgent(ctx.app, 'autre@cfa.test');
    await autre.get(`/api/tableau-de-bord/classes/${classId}/apprentis/${truelleId}`).expect(404);
    await formateur.get(`/api/tableau-de-bord/classes/${classId}/apprentis/pas-un-id`).expect(404);
    await formateur.get(`/api/tableau-de-bord/classes/${classId}/apprentis/00000000-0000-0000-0000-000000000000`).expect(404);
    await truelle.get(`/api/tableau-de-bord/classes/${classId}/apprentis/${truelleId}`).expect(403);
  });

  it('RGPD : temps passé dans l’export, effacé avec le compte', async () => {
    const exp = (await truelle.get('/api/me/export')).body;
    expect(exp.tempsPasseParJour.length).toBeGreaterThan(0);
    await truelle.delete('/api/me').send({ confirmation: 'SUPPRIMER' }).expect(204);
    const { rows } = (await ctx.deps.db.execute(
      sql.raw(`select count(*)::int n from activity_days where user_id = '${truelleId}'`),
    )) as unknown as { rows: { n: number }[] };
    expect(rows[0]!.n).toBe(0);
  });
});
