import {
  CHAPITRES,
  MASTERY_RULE,
  masteryStatus,
  type ApprentiStat,
  type ChapterStat,
  type Chapitre,
  type ClassDashboard,
  type Periode,
  type QuizStat,
} from '@mathsuivi/shared';

/** Données brutes d'une classe sur la période (aucun contenu de conversation). */
export interface DashboardInput {
  /** Fenêtre en jours (7 ou 30 pour le tableau de bord, 90 pour le suivi d'un apprenti). */
  periode: number;
  now: Date;
  members: { id: string; pseudo: string; lastSeenAt: Date | null }[];
  conversations: { userId: string; chapitre: string | null; niveauIndice: number; resolu: boolean; updatedAt: Date }[];
  attempts: { userId: string; contentId: string; chapitre: string | null; score: number; total: number; createdAt?: Date }[];
  cheatCounts: { userId: string; n: number }[];
  quizContents: { id: string; titre: string; chapitre: string | null; publie: boolean }[];
}

/** Un exercice non résolu n'est compté comme raté qu'après une heure sans activité. */
const ONGOING_MS = 60 * 60 * 1000;

const asChapitre = (c: string | null): Chapitre => ((CHAPITRES as readonly string[]).includes(c ?? '') ? (c as Chapitre) : 'autre');
const ratio = (num: number, den: number) => (den > 0 ? num / den : null);
const round2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

interface Acc {
  exercices: number;
  resolus: number;
  indices: number;
  points: number;
  reponsesQuiz: number;
  bonnesQuiz: number;
}
const emptyAcc = (): Acc => ({ exercices: 0, resolus: 0, indices: 0, points: 0, reponsesQuiz: 0, bonnesQuiz: 0 });

function accumulate(input: DashboardInput, filter: (userId: string) => boolean) {
  const byChapitre = new Map<Chapitre, Acc>();
  const get = (c: Chapitre) => byChapitre.get(c) ?? byChapitre.set(c, emptyAcc()).get(c)!;

  for (const conv of input.conversations) {
    if (!filter(conv.userId)) continue;
    const ongoing = !conv.resolu && input.now.getTime() - conv.updatedAt.getTime() < ONGOING_MS;
    if (ongoing) continue;
    const acc = get(asChapitre(conv.chapitre));
    acc.exercices += 1;
    acc.indices += conv.niveauIndice;
    if (conv.resolu) {
      acc.resolus += 1;
      acc.points += Math.max(0, 1 - MASTERY_RULE.penaliteIndice * conv.niveauIndice);
    }
  }
  for (const a of input.attempts) {
    if (!filter(a.userId)) continue;
    const acc = get(asChapitre(a.chapitre));
    acc.reponsesQuiz += a.total;
    acc.bonnesQuiz += a.score;
  }
  return byChapitre;
}

function toChapterStat(chapitre: Chapitre, acc: Acc): ChapterStat {
  const elements = acc.exercices + acc.reponsesQuiz;
  const maitrise = ratio(acc.points + acc.bonnesQuiz, elements);
  return {
    chapitre,
    exercices: acc.exercices,
    resolus: acc.resolus,
    indicesMoyens: round2(ratio(acc.indices, acc.exercices)),
    reponsesQuiz: acc.reponsesQuiz,
    reussiteQuiz: round2(ratio(acc.bonnesQuiz, acc.reponsesQuiz)),
    maitrise: round2(maitrise),
    statut: masteryStatus(maitrise, elements),
  };
}

/** Maîtrise par chapitre, pour la classe entière ou un seul apprenti. */
export function chapterStats(input: DashboardInput, userId?: string): ChapterStat[] {
  const acc = accumulate(input, (id) => !userId || id === userId);
  return [...acc.entries()]
    .map(([c, a]) => toChapterStat(c, a))
    .sort((a, b) => (a.maitrise ?? 2) - (b.maitrise ?? 2) || a.chapitre.localeCompare(b.chapitre));
}

export function computeDashboard(input: DashboardInput): ClassDashboard {
  const since = input.now.getTime() - input.periode * 24 * 60 * 60 * 1000;
  const cheats = new Map(input.cheatCounts.map((c) => [c.userId, c.n]));

  const apprentis: ApprentiStat[] = input.members.map((m) => {
    const convs = input.conversations.filter((c) => c.userId === m.id);
    const attempts = input.attempts.filter((a) => a.userId === m.id);
    const scores = attempts.reduce((s, a) => s + a.score, 0);
    const totals = attempts.reduce((s, a) => s + a.total, 0);
    return {
      id: m.id,
      pseudo: m.pseudo,
      derniereVisite: m.lastSeenAt?.toISOString() ?? null,
      exercices: convs.length,
      resolus: convs.filter((c) => c.resolu).length,
      quizPasses: attempts.length,
      moyenneQuiz: round2(ratio(scores, totals)),
      demandesReponse: cheats.get(m.id) ?? 0,
      aRetravailler: chapterStats(input, m.id)
        .filter((c) => c.statut === 'a_retravailler')
        .map((c) => c.chapitre),
    };
  });

  const quiz: QuizStat[] = input.quizContents.map((q) => {
    const attempts = input.attempts.filter((a) => a.contentId === q.id);
    return {
      id: q.id,
      titre: q.titre,
      chapitre: q.chapitre ? asChapitre(q.chapitre) : null,
      publie: q.publie,
      participants: new Set(attempts.map((a) => a.userId)).size,
      tentatives: attempts.length,
      moyenne: round2(
        ratio(
          attempts.reduce((s, a) => s + a.score, 0),
          attempts.reduce((s, a) => s + a.total, 0),
        ),
      ),
    };
  });

  const totalScore = input.attempts.reduce((s, a) => s + a.score, 0);
  const totalQuestions = input.attempts.reduce((s, a) => s + a.total, 0);
  return {
    periodeJours: input.periode as Periode,
    resume: {
      apprentis: input.members.length,
      actifs: input.members.filter((m) => m.lastSeenAt && m.lastSeenAt.getTime() >= since).length,
      exercices: input.conversations.length,
      exercicesResolus: input.conversations.filter((c) => c.resolu).length,
      quizPasses: input.attempts.length,
      moyenneQuiz: round2(ratio(totalScore, totalQuestions)),
    },
    chapitres: chapterStats(input),
    apprentis,
    quiz,
  };
}
