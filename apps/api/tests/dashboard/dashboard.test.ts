import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { masteryStatus, type Quiz } from '@mathsuivi/shared';
import { conversations, messages, moderationEvents } from '../../src/db/schema.js';
import { computeDashboard, chapterStats, type DashboardInput } from '../../src/modules/dashboard/compute.js';
import { DEMO, apprentiAgent, formateurAgent, setup } from '../helpers.js';

const NOW = new Date('2026-10-23T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function input(over: Partial<DashboardInput> = {}): DashboardInput {
  return {
    periode: 7,
    now: NOW,
    members: [
      { id: 'a', pseudo: 'Alpha', lastSeenAt: daysAgo(1) },
      { id: 'b', pseudo: 'Beta', lastSeenAt: daysAgo(20) },
    ],
    conversations: [],
    attempts: [],
    cheatCounts: [],
    quizContents: [],
    ...over,
  };
}

const conv = (userId: string, chapitre: string, resolu: boolean, niveauIndice = 0, updatedAt = daysAgo(1)) => ({
  userId,
  chapitre,
  resolu,
  niveauIndice,
  updatedAt,
});

describe('règle de maîtrise (calcul pur)', () => {
  it('seuils : acquis ≥ 75 %, en cours ≥ 50 %, sinon à retravailler ; moins de 3 éléments → pas assez de données', () => {
    expect(masteryStatus(0.8, 5)).toBe('acquis');
    expect(masteryStatus(0.6, 5)).toBe('en_cours');
    expect(masteryStatus(0.3, 5)).toBe('a_retravailler');
    expect(masteryStatus(1, 2)).toBe('peu_de_donnees');
    expect(masteryStatus(null, 10)).toBe('peu_de_donnees');
  });

  it('un indice compte un peu moins qu’une réussite seule', () => {
    const sans = chapterStats(input({ conversations: [conv('a', 'pythagore', true, 0), conv('a', 'pythagore', true, 0), conv('a', 'pythagore', true, 0)] }));
    const avec = chapterStats(input({ conversations: [conv('a', 'pythagore', true, 2), conv('a', 'pythagore', true, 2), conv('a', 'pythagore', true, 2)] }));
    expect(sans[0]).toMatchObject({ maitrise: 1, statut: 'acquis', indicesMoyens: 0 });
    expect(avec[0]).toMatchObject({ maitrise: 0.6, statut: 'en_cours', indicesMoyens: 2 });
  });

  it('quiz et exercices se combinent ; un exercice en cours (moins d’une heure) n’est pas compté raté', () => {
    const stats = chapterStats(
      input({
        conversations: [conv('a', 'aires_volumes', false, 0, new Date(NOW.getTime() - 10 * 60 * 1000)), conv('a', 'aires_volumes', false)],
        attempts: [{ userId: 'a', contentId: 'q', chapitre: 'aires_volumes', score: 1, total: 4 }],
      }),
    );
    // 1 exercice raté (l'autre est en cours) + 1/4 au quiz → 1 / 5 = 0,2
    expect(stats[0]).toMatchObject({ chapitre: 'aires_volumes', exercices: 1, reponsesQuiz: 4, reussiteQuiz: 0.25, maitrise: 0.2, statut: 'a_retravailler' });
  });

  it('chapitres triés du plus fragile au plus solide, inconnus en « autre »', () => {
    const stats = chapterStats(
      input({
        attempts: [
          { userId: 'a', contentId: 'q1', chapitre: 'pythagore', score: 4, total: 4 },
          { userId: 'a', contentId: 'q2', chapitre: 'pourcentages', score: 1, total: 4 },
          { userId: 'a', contentId: 'q3', chapitre: 'n_importe_quoi', score: 2, total: 4 },
        ],
      }),
    );
    expect(stats.map((s) => s.chapitre)).toEqual(['pourcentages', 'autre', 'pythagore']);
  });

  it('résumé, apprentis à retravailler et statistiques des quiz', () => {
    const d = computeDashboard(
      input({
        conversations: [conv('a', 'pythagore', true), conv('b', 'pythagore', false), conv('b', 'pythagore', false), conv('b', 'pythagore', false)],
        attempts: [
          { userId: 'a', contentId: 'q1', chapitre: 'pythagore', score: 3, total: 4 },
          { userId: 'a', contentId: 'q1', chapitre: 'pythagore', score: 4, total: 4 },
        ],
        cheatCounts: [{ userId: 'b', n: 3 }],
        quizContents: [{ id: 'q1', titre: 'Pythagore', chapitre: 'pythagore', publie: true }],
      }),
    );
    expect(d.resume).toEqual({ apprentis: 2, actifs: 1, exercices: 4, exercicesResolus: 1, quizPasses: 2, moyenneQuiz: 0.88 });
    expect(d.apprentis.find((a) => a.id === 'b')).toMatchObject({ exercices: 3, resolus: 0, demandesReponse: 3, aRetravailler: ['pythagore'] });
    expect(d.apprentis.find((a) => a.id === 'a')!.aRetravailler).toEqual([]);
    expect(d.quiz[0]).toEqual({ id: 'q1', titre: 'Pythagore', chapitre: 'pythagore', publie: true, participants: 1, tentatives: 2, moyenne: 0.88 });
  });
});

describe('API du tableau de bord', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let formateur: request.Agent;
  let classId: string;
  let quizId: string;
  let quiz: Quiz;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await setup();
    formateur = await formateurAgent(ctx.app);
    classId = (await formateur.get('/api/classes')).body[0].id;
    const created = await formateur.post('/api/contenus/generer').send({ classId, type: 'quiz', notion: 'aires', nombre: 4 }).expect(201);
    quizId = created.body.id;
    quiz = created.body.body;
    await formateur.post(`/api/contenus/${quizId}/publication`).send({ publie: true }).expect(200);

    // Truelle : tout juste. Niveau : tout faux, en choisissant la même mauvaise réponse à la question 1.
    for (const [pseudo, pin, juste] of [
      ['Truelle', DEMO.apprentis[0]!.pin, true],
      ['Niveau', DEMO.apprentis[1]!.pin, false],
    ] as const) {
      const agent = await apprentiAgent(ctx.app, pseudo, pin);
      ids[pseudo] = (await agent.get('/api/me')).body.id;
      const reponses = quiz.questions.map((q) => (juste ? q.bonne_reponse : (q.bonne_reponse + 1) % 4));
      await agent.post(`/api/revisions/${quizId}/tentatives`).send({ reponses }).expect(201);
    }

    // Conversations avec un contenu « secret » : le formateur ne doit jamais le voir.
    const [c] = await ctx.deps.db
      .insert(conversations)
      .values({ userId: ids.Niveau!, enonce: 'Énoncé SECRET de Niveau', chapitre: 'pythagore', niveauIndice: 2, updatedAt: daysAgo(0) })
      .returning();
    await ctx.deps.db.insert(messages).values({ conversationId: c!.id, auteur: 'apprenti', contenu: 'Message SECRET' });
    // Conversation vide (ex. panne au premier message) : ne doit pas compter.
    await ctx.deps.db.insert(conversations).values({ userId: ids.Truelle!, enonce: 'vide', chapitre: 'calcul', updatedAt: daysAgo(2) });
    await ctx.deps.db.insert(moderationEvents).values({ userId: ids.Niveau!, conversationId: c!.id, categorie: 'triche' });
  });
  afterAll(() => ctx.close());

  it('indicateurs de la classe, sans aucun contenu de conversation', async () => {
    const res = await formateur.get(`/api/tableau-de-bord/classes/${classId}?periode=30`).expect(200);
    expect(res.body.periodeJours).toBe(30);
    expect(res.body.resume).toMatchObject({ apprentis: 3, actifs: 2, quizPasses: 2, moyenneQuiz: 0.5 });
    const niveau = res.body.apprentis.find((a: { pseudo: string }) => a.pseudo === 'Niveau');
    expect(niveau).toMatchObject({ quizPasses: 1, moyenneQuiz: 0, demandesReponse: 1, aRetravailler: ['aires_volumes'] });
    expect(res.body.quiz[0]).toMatchObject({ id: quizId, participants: 2, moyenne: 0.5 });
    expect(res.body.apprentis.find((a: { pseudo: string }) => a.pseudo === 'Truelle').exercices).toBe(0);
    expect(res.body.resume.exercices).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain('SECRET');
  });

  it('résultats d’un quiz : réussite par question et erreur la plus fréquente', async () => {
    const res = await formateur.get(`/api/tableau-de-bord/quiz/${quizId}`).expect(200);
    expect(res.body).toMatchObject({ participants: 2, moyenne: 0.5 });
    const q0 = res.body.questions[0];
    expect(q0).toMatchObject({ reponses: 2, reussite: 0.5, bonneReponse: quiz.questions[0]!.choix[quiz.questions[0]!.bonne_reponse] });
    expect(q0.erreurFrequente).toEqual({ choix: quiz.questions[0]!.choix[(quiz.questions[0]!.bonne_reponse + 1) % 4], fois: 1 });
    expect(res.body.apprentis.map((a: { pseudo: string }) => a.pseudo)).toEqual(['Niveau', 'Truelle']);
  });

  it('retirer une question après coup ne décale pas les statistiques des autres', async () => {
    await formateur
      .patch(`/api/contenus/${quizId}`)
      .send({ body: { ...quiz, questions: quiz.questions.slice(1) } })
      .expect(200);
    const res = await formateur.get(`/api/tableau-de-bord/quiz/${quizId}`).expect(200);
    expect(res.body.questions).toHaveLength(3);
    expect(res.body.questions[0].enonce).toBe(quiz.questions[1]!.enonce);
    expect(res.body.questions[0]).toMatchObject({ reponses: 2, reussite: 0.5 });
  });

  it('la liste des classes affiche les apprentis actifs cette semaine', async () => {
    const list = await formateur.get('/api/classes').expect(200);
    expect(list.body[0].actifs7j).toBe(2);
  });

  it('période invalide refusée, accès réservé au formateur de la classe', async () => {
    await formateur.get(`/api/tableau-de-bord/classes/${classId}?periode=15`).expect(400);
    const autre = await formateurAgent(ctx.app, 'autre@cfa.test');
    await autre.get(`/api/tableau-de-bord/classes/${classId}`).expect(404);
    await autre.get(`/api/tableau-de-bord/quiz/${quizId}`).expect(404);
    const apprenti = await apprentiAgent(ctx.app, 'Truelle', DEMO.apprentis[0]!.pin);
    await apprenti.get(`/api/tableau-de-bord/classes/${classId}`).expect(403);
  });
});
