import { sql } from 'drizzle-orm';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ficheSchema, flashcardsSchema, quizSchema, type Quiz } from '@mathsuivi/shared';
import { LLMError } from '../../src/llm/errors.js';
import type { LLMProvider, OutputSchema } from '../../src/llm/types.js';
import { demoContent } from '../../src/modules/contents/demo.js';
import { frenchSpacing, shuffleQuiz } from '../../src/modules/contents/service.js';
import { DEMO, apprentiAgent, formateurAgent, setup } from '../helpers.js';

const QUIZ: Quiz = {
  titre: 'Quiz pentes',
  questions: [
    {
      enonce: 'Une évacuation descend de 0,9 m sur 6 m. Quelle pente ?',
      choix: ['15 %', '1,5 %', '6,7 %', '0,15 %'],
      bonne_reponse: 0,
      explication: '0,9 ÷ 6 = 0,15, soit 15 %.',
    },
    {
      enonce: 'Pente de 2 % sur 5 m : quel dénivelé ?',
      choix: ['10 cm', '1 cm', '2,5 cm', '25 cm'],
      bonne_reponse: 0,
      explication: '5 m × 0,02 = 0,1 m = 10 cm.',
    },
  ],
};

/** Fournisseur qui renvoie un contenu fixé et garde le prompt reçu. */
class GeneratorProvider implements LLMProvider {
  readonly name = 'mistral' as const;
  readonly model = 'generateur';
  prompts: string[] = [];
  fail = false;
  output: unknown = QUIZ;
  async *chat() {
    yield { type: 'done' as const, provider: this.name, model: this.model };
  }
  async generate<T>(prompt: string, schema: OutputSchema<T>) {
    this.prompts.push(prompt);
    if (this.fail) throw new LLMError('invalid_output', this.name);
    return { data: schema.parse(this.output), provider: this.name, model: this.model };
  }
  async vision() {
    return { text: '', provider: this.name, model: this.model };
  }
}

async function coursPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText('Les pentes. Pente = denivele / longueur, en pourcentage. Methode du formateur Martin.', {
    x: 40,
    y: 700,
    size: 11,
    font,
  });
  return Buffer.from(await doc.save());
}

describe('schémas et contenu de démonstration', () => {
  it('le contenu de démonstration respecte les schémas', () => {
    expect(ficheSchema.safeParse(demoContent('fiche', 1)).success).toBe(true);
    expect(quizSchema.parse(demoContent('quiz', 8)).questions).toHaveLength(8);
    expect(flashcardsSchema.parse(demoContent('flashcards', 10)).cartes).toHaveLength(10);
  });

  it('refuse un QCM avec des choix en double ou une bonne réponse hors liste', () => {
    const q = QUIZ.questions[0]!;
    expect(quizSchema.safeParse({ titre: 'x', questions: [{ ...q, choix: ['1', '1', '2', '3'] }] }).success).toBe(false);
    expect(quizSchema.safeParse({ titre: 'x', questions: [{ ...q, bonne_reponse: 4 }] }).success).toBe(false);
    expect(quizSchema.safeParse({ titre: 'x', questions: [{ ...q, choix: ['1', '2', '3'] }] }).success).toBe(false);
  });

  it('typographie française : espace insécable avant ? et :', () => {
    expect(frenchSpacing({ a: 'C’est combien ?', b: ['Aire : L × l'] })).toEqual({ a: 'C’est combien ?', b: ['Aire : L × l'] });
  });

  it('le mélange des choix garde la bonne réponse', () => {
    for (let i = 0; i < 20; i++) {
      const shuffled = shuffleQuiz(QUIZ);
      shuffled.questions.forEach((q, n) => {
        expect(q.choix[q.bonne_reponse]).toBe(QUIZ.questions[n]!.choix[0]);
        expect([...q.choix].sort()).toEqual([...QUIZ.questions[n]!.choix].sort());
      });
    }
  });
});

describe('parcours formateur → apprenti', () => {
  const generator = new GeneratorProvider();
  let ctx: Awaited<ReturnType<typeof setup>>;
  let formateur: request.Agent;
  let truelle: request.Agent;
  let classId: string;
  let quizId: string;

  beforeAll(async () => {
    ctx = await setup({ GENERATION_DAILY_LIMIT: '6' }, generator);
    formateur = await formateurAgent(ctx.app);
    truelle = await apprentiAgent(ctx.app, 'Truelle', DEMO.apprentis[0]!.pin);
    classId = (await formateur.get('/api/classes')).body[0].id;
  });
  afterAll(() => ctx.close());
  beforeEach(() => {
    generator.prompts = [];
    generator.fail = false;
    generator.output = QUIZ;
  });

  it('génère un quiz depuis un cours importé : le cours est transmis au modèle', async () => {
    const doc = await formateur
      .post('/api/documents')
      .field('classId', classId)
      .field('titre', 'Les pentes')
      .attach('fichier', await coursPdf(), 'pentes.pdf')
      .expect(201);
    const res = await formateur
      .post('/api/contenus/generer')
      .send({ classId, type: 'quiz', documentId: doc.body.id, nombre: 3, consignes: 'Niveau facile' })
      .expect(201);
    quizId = res.body.id;
    expect(res.body).toMatchObject({ type: 'quiz', publie: false, nbElements: 2, source: 'Les pentes', notion: 'Les pentes' });
    const prompt = generator.prompts[0]!;
    expect(prompt).toContain('Methode du formateur Martin');
    expect(prompt).toContain('Niveau facile');
    expect(prompt).toContain('Exactement 3 questions');
    expect(prompt).toContain('Maçon');
  });

  it('un brouillon est invisible pour les apprentis', async () => {
    expect((await truelle.get('/api/revisions').expect(200)).body).toEqual([]);
    await truelle.get(`/api/revisions/${quizId}`).expect(404);
  });

  it('relecture : renommer, retirer une question, contenu invalide refusé', async () => {
    const detail = (await formateur.get(`/api/contenus/${quizId}`).expect(200)).body;
    const body = { ...detail.body, questions: detail.body.questions.slice(0, 2) };
    const res = await formateur.patch(`/api/contenus/${quizId}`).send({ titre: 'Quiz : les pentes', body }).expect(200);
    expect(res.body).toMatchObject({ titre: 'Quiz : les pentes', nbElements: 2 });
    expect(res.body.body.titre).toBe('Quiz : les pentes');
    await formateur
      .patch(`/api/contenus/${quizId}`)
      .send({ body: { ...body, questions: [{ enonce: 'x', choix: ['a'], bonne_reponse: 0, explication: 'x' }] } })
      .expect(400);
  });

  it('publié : l’apprenti voit le quiz SANS les bonnes réponses', async () => {
    await formateur.post(`/api/contenus/${quizId}/publication`).send({ publie: true }).expect(200);
    const list = (await truelle.get('/api/revisions').expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: quizId, type: 'quiz', meilleurScore: null });
    const quiz = (await truelle.get(`/api/revisions/${quizId}`).expect(200)).body;
    expect(quiz.body.questions).toHaveLength(2);
    expect(JSON.stringify(quiz)).not.toMatch(/bonne_reponse|explication/);
  });

  it('correction côté serveur : score, bonnes réponses et explications après envoi', async () => {
    const stored = (await formateur.get(`/api/contenus/${quizId}`)).body.body as Quiz;
    const juste = stored.questions[0]!.bonne_reponse;
    const faux = (stored.questions[1]!.bonne_reponse + 1) % 4;
    const res = await truelle.post(`/api/revisions/${quizId}/tentatives`).send({ reponses: [juste, faux], dureeSecondes: 42 }).expect(201);
    expect(res.body).toMatchObject({ score: 1, total: 2 });
    expect(res.body.questions[1]).toMatchObject({ correct: false, reponse: faux, bonne_reponse: stored.questions[1]!.bonne_reponse });
    expect(res.body.questions[1].explication).toContain('10 cm');
    const list = (await truelle.get('/api/revisions')).body;
    expect(list[0].meilleurScore).toEqual({ score: 1, total: 2 });
  });

  it('tentative incomplète ou sur un autre type refusée', async () => {
    await truelle.post(`/api/revisions/${quizId}/tentatives`).send({ reponses: [0] }).expect(400);
    const fiche = await formateur.post('/api/contenus/generer').send({ classId, type: 'fiche', notion: 'pentes' });
    // Le générateur renvoie un quiz : invalide pour une fiche → message clair, pas de plantage.
    expect(fiche.status).toBe(503);
  });

  it('génération ratée : message clair, essai non décompté', async () => {
    generator.fail = true;
    const res = await formateur.post('/api/contenus/generer').send({ classId, type: 'quiz', notion: 'pentes' }).expect(503);
    expect(res.body.error).toMatch(/La génération a échoué/);
  });

  it('limite de générations par jour', async () => {
    for (let i = 0; i < 5; i++) await formateur.post('/api/contenus/generer').send({ classId, type: 'quiz', notion: 'pentes' });
    const res = await formateur.post('/api/contenus/generer').send({ classId, type: 'quiz', notion: 'pentes' }).expect(429);
    expect(res.body.error).toMatch(/Limite de 6 générations/);
  });

  it('cloisonnement : autre formateur, autre classe, apprenti', async () => {
    const autre = await formateurAgent(ctx.app, 'autre@cfa.test');
    await autre.get(`/api/contenus/${quizId}`).expect(404);
    await autre.patch(`/api/contenus/${quizId}`).send({ titre: 'pirate' }).expect(404);
    await autre.post('/api/contenus/generer').send({ classId, type: 'quiz', notion: 'x' }).expect(404);
    await truelle.get(`/api/contenus/${quizId}`).expect(403);
    await formateur.post('/api/contenus/generer').send({ classId, type: 'quiz' }).expect(400);
  });

  it('dépublier : le quiz disparaît pour l’apprenti', async () => {
    await formateur.post(`/api/contenus/${quizId}/publication`).send({ publie: false }).expect(200);
    await truelle.get(`/api/revisions/${quizId}`).expect(404);
  });

  it('le cours source peut être supprimé : le contenu généré reste', async () => {
    const docs = (await formateur.get(`/api/documents?classId=${classId}`)).body;
    await formateur.delete(`/api/documents/${docs[0].id}`).expect(204);
    const detail = (await formateur.get(`/api/contenus/${quizId}`).expect(200)).body;
    expect(detail.source).toBe('Les pentes');
  });

  it('RGPD : résultats dans l’export, effacés avec le compte', async () => {
    const exp = (await truelle.get('/api/me/export')).body;
    expect(exp.resultatsDesQuiz[0]).toMatchObject({ score: 1, total: 2 });
    const { id } = (await truelle.get('/api/me')).body;
    await truelle.delete('/api/me').send({ confirmation: 'SUPPRIMER' }).expect(204);
    const { rows } = (await ctx.deps.db.execute(sql.raw(`select count(*)::int n from quiz_attempts where user_id = '${id}'`))) as unknown as {
      rows: { n: number }[];
    };
    expect(rows[0]!.n).toBe(0);
  });
});

describe('mode Mock, sans aucune clé', () => {
  it('génère les trois types avec un contenu de démonstration réaliste', async () => {
    const ctx = await setup();
    const formateur = await formateurAgent(ctx.app);
    const classId = (await formateur.get('/api/classes')).body[0].id;
    for (const [type, n] of [
      ['fiche', 4],
      ['quiz', 6],
      ['flashcards', 8],
    ] as const) {
      const res = await formateur.post('/api/contenus/generer').send({ classId, type, notion: 'aires' }).expect(201);
      expect(res.body.nbElements).toBe(n);
      expect(res.body.chapitre).toBe('aires_volumes');
    }
    await ctx.close();
  });
});
