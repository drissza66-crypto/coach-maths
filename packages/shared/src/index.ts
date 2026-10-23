import { z } from 'zod';

// ── Référentiels ─────────────────────────────────────────────────────────────

export const ROLES = ['apprenti', 'formateur', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const NIVEAUX = ['CAP1', 'CAP2'] as const;
export type Niveau = (typeof NIVEAUX)[number];
export const NIVEAU_LABELS: Record<Niveau, string> = {
  CAP1: 'CAP 1re année',
  CAP2: 'CAP 2e année',
};

export const METIERS = [
  'macon',
  'menuisier',
  'plombier',
  'electricien',
  'peintre',
  'carreleur',
  'couvreur',
  'autre',
] as const;
export type Metier = (typeof METIERS)[number];
export const METIER_LABELS: Record<Metier, string> = {
  macon: 'Maçon',
  menuisier: 'Menuisier',
  plombier: 'Plombier',
  electricien: 'Électricien',
  peintre: 'Peintre',
  carreleur: 'Carreleur',
  couvreur: 'Couvreur',
  autre: 'Autre métier',
};

export const CONSENT_TYPES = ['cgu', 'ia_tuteur', 'import_docs'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const CONSENT_GIVERS = ['apprenti', 'representant_legal', 'etablissement'] as const;
export type ConsentGiver = (typeof CONSENT_GIVERS)[number];

// ── Code classe ──────────────────────────────────────────────────────────────

/** Sans I, O, 0, 1 pour éviter les confusions à la lecture. */
export const CLASS_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CLASS_CODE_LENGTH = 6;

/** « abc-def » ou « ABC DEF » → « ABCDEF ». */
export function normalizeClassCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** « ABCDEF » → « ABC-DEF », plus facile à dicter. */
export function formatClassCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

// ── Pseudo et code PIN ───────────────────────────────────────────────────────

/** Clé de comparaison : « Élodie  B » et « elodie b » sont le même pseudo. */
export function pseudoKey(pseudo: string): string {
  return pseudo
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim();
}

export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]!);
  return steps.every((s) => s === 1) || steps.every((s) => s === -1);
}

export const pseudoSchema = z
  .string()
  .trim()
  .min(2, 'Ton pseudo doit avoir au moins 2 caractères.')
  .max(20, 'Ton pseudo doit avoir 20 caractères maximum.')
  .regex(/^[\p{L}\p{N} _-]+$/u, 'Utilise seulement des lettres, des chiffres, des espaces ou des tirets.');

export const pinSchema = z.string().regex(/^\d{6}$/, 'Le code doit avoir 6 chiffres.');

export const newPinSchema = pinSchema.refine((pin) => !isWeakPin(pin), {
  message: 'Ce code est trop facile à deviner. Choisis-en un autre.',
});

export const classCodeSchema = z
  .string()
  .transform(normalizeClassCode)
  .refine((code) => code.length === CLASS_CODE_LENGTH, {
    message: 'Le code classe a 6 caractères.',
  });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Adresse e-mail invalide.')
  .max(254);

// ── Requêtes ─────────────────────────────────────────────────────────────────

export const magicLinkRequestSchema = z.object({ email: emailSchema });

export const magicLinkVerifySchema = z.object({ token: z.string().min(20).max(200) });

export const classCheckSchema = z.object({ code: classCodeSchema });

export const apprentiRegisterSchema = z.object({
  code: classCodeSchema,
  pseudo: pseudoSchema,
  pin: newPinSchema,
  aPlusDe15Ans: z.boolean(),
  accepteCgu: z.literal(true, {
    errorMap: () => ({ message: 'Tu dois accepter les règles d’utilisation.' }),
  }),
  accepteTuteurIa: z.boolean(),
});

export const apprentiLoginSchema = z.object({
  code: classCodeSchema,
  pseudo: pseudoSchema,
  pin: pinSchema,
});

export const changePinSchema = z.object({
  currentPin: pinSchema,
  newPin: newPinSchema,
});

export const classCreateSchema = z.object({
  nom: z.string().trim().min(2, 'Le nom est trop court.').max(60, 'Le nom est trop long.'),
  metier: z.enum(METIERS),
  niveau: z.enum(NIVEAUX),
});

export const classUpdateSchema = classCreateSchema.partial().extend({
  archivee: z.boolean().optional(),
});

export const updateProfileSchema = z.object({
  pseudo: z.string().trim().min(2).max(40),
});

export const consentUpdateSchema = z.object({
  type: z.literal('ia_tuteur'),
  accord: z.boolean(),
});

export const deleteAccountSchema = z.object({
  confirmation: z.literal('SUPPRIMER', {
    errorMap: () => ({ message: 'Écris SUPPRIMER pour confirmer.' }),
  }),
});

export type MagicLinkRequest = z.input<typeof magicLinkRequestSchema>;
export type ApprentiRegister = z.input<typeof apprentiRegisterSchema>;
export type ApprentiLogin = z.input<typeof apprentiLoginSchema>;
export type ClassCreate = z.input<typeof classCreateSchema>;
export type ClassUpdate = z.input<typeof classUpdateSchema>;

// ── Réponses ─────────────────────────────────────────────────────────────────

export interface ClassSummary {
  id: string;
  nom: string;
  metier: Metier;
  niveau: Niveau;
  archivee: boolean;
}

export interface Me {
  id: string;
  role: Role;
  pseudo: string;
  email: string | null;
  niveau: Niveau | null;
  moinsDe15Ans: boolean | null;
  doitChangerPin: boolean;
  tuteurIaAutorise: boolean;
  classes: ClassSummary[];
}

export interface ClassCheckResult {
  nom: string;
  metier: Metier;
  niveau: Niveau;
}

export interface FormateurClass extends ClassSummary {
  code: string;
  nbApprentis: number;
  /** Apprentis venus sur l'application ces 7 derniers jours. */
  actifs7j: number;
  creeLe: string;
}

export interface ClassMember {
  id: string;
  pseudo: string;
  inscritLe: string;
  derniereVisite: string | null;
  moinsDe15Ans: boolean;
  tuteurIaAutorise: boolean;
  doitChangerPin: boolean;
  bloque: boolean;
}

export interface FormateurClassDetail extends FormateurClass {
  apprentis: ClassMember[];
}

// ── Tuteur ───────────────────────────────────────────────────────────────────

export const CHAPITRES = [
  'calcul',
  'proportionnalite',
  'pourcentages',
  'geometrie',
  'aires_volumes',
  'pythagore',
  'fonctions',
  'electricite',
  'autre',
] as const;
export type Chapitre = (typeof CHAPITRES)[number];
export const CHAPITRE_LABELS: Record<Chapitre, string> = {
  calcul: 'Calcul',
  proportionnalite: 'Proportionnalité',
  pourcentages: 'Pourcentages',
  geometrie: 'Géométrie',
  aires_volumes: 'Aires et volumes',
  pythagore: 'Pythagore',
  fonctions: 'Fonctions',
  electricite: 'Électricité',
  autre: 'Autre',
};

/** Parcours de l'apprenti bloqué : compréhension → indice 1 → indice 2 → validation → exercice similaire. */
export const ETAPES = ['comprehension', 'indice1', 'indice2', 'validation', 'similaire'] as const;
export type Etape = (typeof ETAPES)[number];
export const ETAPE_LABELS: Record<Etape, string> = {
  comprehension: 'Comprendre l’exercice',
  indice1: 'Indice 1',
  indice2: 'Indice 2',
  validation: 'Vérifier ma réponse',
  similaire: 'Exercice similaire',
};

export const MAX_MESSAGE_LENGTH = 2000;

export const startConversationSchema = z.object({
  enonce: z
    .string()
    .trim()
    .min(5, 'Écris ton exercice (au moins quelques mots).')
    .max(MAX_MESSAGE_LENGTH, 'Ton exercice est trop long. Garde la partie où tu bloques.'),
});

export const sendMessageSchema = z.object({
  contenu: z.string().trim().min(1, 'Écris ton message.').max(MAX_MESSAGE_LENGTH, 'Ton message est trop long.'),
  demandeIndice: z.boolean().optional(),
});

export interface TutorMessage {
  id: string;
  auteur: 'apprenti' | 'tuteur';
  contenu: string;
  envoyeLe: string;
}

export interface ConversationSummary {
  id: string;
  enonce: string;
  chapitre: Chapitre | null;
  etape: Etape;
  niveauIndice: number;
  resolue: boolean;
  misAJourLe: string;
}

export interface ConversationDetail extends ConversationSummary {
  notion: string | null;
  messages: TutorMessage[];
}

export interface Quota {
  utilises: number;
  limite: number;
  restants: number;
}

/** Événements SSE envoyés pendant la réponse du tuteur. */
export type TutorStreamEvent =
  | { type: 'debut'; conversation: ConversationSummary }
  | { type: 'texte'; texte: string }
  | {
      type: 'fin';
      message: TutorMessage;
      messageApprenti: TutorMessage;
      etape: Etape;
      niveauIndice: number;
      resolue: boolean;
      quota: Quota;
    }
  | { type: 'erreur'; message: string; reessayerDans?: number };

// ── Documents ────────────────────────────────────────────────────────────────

export const ACCEPTED_UPLOADS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;

export const documentUploadSchema = z.object({
  classId: z.string().uuid('Classe invalide.'),
  titre: z.string().trim().min(2, 'Donnez un titre au cours.').max(80, 'Titre trop long.'),
});

export interface CourseDocument {
  id: string;
  titre: string;
  nomFichier: string;
  mime: string;
  taille: number;
  nbPages: number;
  nbCaracteres: number;
  creeLe: string;
  /** Date de suppression automatique. */
  expireLe: string;
}

export interface CourseDocumentDetail extends CourseDocument {
  /** Début du texte extrait, pour vérifier la lecture. */
  apercu: string;
}

/** Texte lu sur la photo d'un énoncé (la photo n'est pas conservée). */
export interface PhotoReadResult {
  texte: string;
  quota: Quota;
}

// ── Fiches, quiz, flashcards ─────────────────────────────────────────────────

export const CONTENT_TYPES = ['fiche', 'quiz', 'flashcards'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];
export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  fiche: 'Fiche de révision',
  quiz: 'Quiz (QCM)',
  flashcards: 'Cartes mémoire',
};

const court = (max: number) => z.string().trim().min(1).max(max);

export const ficheSchema = z.object({
  titre: court(80),
  resume: court(400),
  points_cles: z.array(court(200)).min(2).max(6),
  formule: court(160).nullable(),
  exemple_btp: z.object({
    enonce: court(400),
    etapes: z.array(court(200)).min(1).max(6),
    resultat: court(120),
  }),
  erreurs_frequentes: z.array(court(200)).min(1).max(4),
  a_retenir: court(200),
});
export type Fiche = z.infer<typeof ficheSchema>;

export const quizQuestionSchema = z
  .object({
    enonce: court(400),
    choix: z.array(court(120)).length(4),
    bonne_reponse: z.number().int().min(0).max(3),
    explication: court(400),
  })
  .refine((q) => new Set(q.choix.map((c) => c.toLowerCase())).size === 4, {
    message: 'Les 4 choix doivent être différents.',
  });

export const quizSchema = z.object({
  titre: court(80),
  questions: z.array(quizQuestionSchema).min(1).max(15),
});
export type Quiz = z.infer<typeof quizSchema>;

export const flashcardsSchema = z.object({
  titre: court(80),
  cartes: z.array(z.object({ recto: court(200), verso: court(300) })).min(1).max(20),
});
export type Flashcards = z.infer<typeof flashcardsSchema>;

export const CONTENT_SCHEMAS = { fiche: ficheSchema, quiz: quizSchema, flashcards: flashcardsSchema } as const;
export type ContentBody = Fiche | Quiz | Flashcards;

export const generateContentSchema = z
  .object({
    classId: z.string().uuid(),
    type: z.enum(CONTENT_TYPES),
    documentId: z.string().uuid().optional(),
    chapitre: z.enum(CHAPITRES).optional(),
    notion: z.string().trim().max(80).optional(),
    consignes: z.string().trim().max(500).optional(),
    nombre: z.number().int().min(3).max(15).optional(),
  })
  .refine((v) => v.documentId || v.notion, { message: 'Choisissez un cours ou indiquez une notion.' });
export type GenerateContentInput = z.input<typeof generateContentSchema>;

export const updateContentSchema = z.object({
  titre: z.string().trim().min(2).max(80).optional(),
  body: z.unknown().optional(),
});

export const quizAttemptSchema = z.object({
  reponses: z.array(z.number().int().min(-1).max(3)).max(15),
  dureeSecondes: z.number().int().min(0).max(24 * 3600).optional(),
});

export interface ContentSummary {
  id: string;
  type: ContentType;
  titre: string;
  chapitre: Chapitre | null;
  notion: string | null;
  publie: boolean;
  nbElements: number;
  source: string | null;
  creeLe: string;
}

export interface ContentDetail extends ContentSummary {
  body: ContentBody;
}

/** Quiz tel que vu par l'apprenti : sans les bonnes réponses. */
export interface QuizForApprenti {
  titre: string;
  questions: { enonce: string; choix: string[] }[];
}

export interface RevisionItem {
  id: string;
  type: ContentType;
  titre: string;
  chapitre: Chapitre | null;
  nbElements: number;
  publieLe: string;
  /** Quiz : meilleur score de l'apprenti. */
  meilleurScore: { score: number; total: number } | null;
}

export interface RevisionDetail {
  id: string;
  type: ContentType;
  titre: string;
  chapitre: Chapitre | null;
  body: Fiche | Flashcards | QuizForApprenti;
}

export interface QuizCorrection {
  score: number;
  total: number;
  questions: { enonce: string; choix: string[]; reponse: number; bonne_reponse: number; correct: boolean; explication: string }[];
}

// ── Tableau de bord formateur ────────────────────────────────────────────────

export const PERIODES = [7, 30] as const;
export type Periode = (typeof PERIODES)[number];

export const MASTERY_STATUSES = ['acquis', 'en_cours', 'a_retravailler', 'peu_de_donnees'] as const;
export type MasteryStatus = (typeof MASTERY_STATUSES)[number];
export const MASTERY_LABELS: Record<MasteryStatus, string> = {
  acquis: 'Acquis',
  en_cours: 'En cours',
  a_retravailler: 'À retravailler',
  peu_de_donnees: 'Pas assez de données',
};

/**
 * Règle de maîtrise, la même partout (tableau de bord, suivi de l'apprenti) :
 * maîtrise = (bonnes réponses aux quiz + exercices trouvés avec le coach) / total,
 * un exercice trouvé après un indice comptant un peu moins (−0,2 par indice).
 * Moins de 3 éléments : pas assez de données pour conclure.
 */
export const MASTERY_RULE = { minElements: 3, acquis: 0.75, enCours: 0.5, penaliteIndice: 0.2 } as const;

export function masteryStatus(maitrise: number | null, elements: number): MasteryStatus {
  if (maitrise === null || elements < MASTERY_RULE.minElements) return 'peu_de_donnees';
  if (maitrise >= MASTERY_RULE.acquis) return 'acquis';
  if (maitrise >= MASTERY_RULE.enCours) return 'en_cours';
  return 'a_retravailler';
}

export interface ChapterStat {
  chapitre: Chapitre;
  exercices: number;
  resolus: number;
  indicesMoyens: number | null;
  reponsesQuiz: number;
  reussiteQuiz: number | null;
  maitrise: number | null;
  statut: MasteryStatus;
}

export interface ApprentiStat {
  id: string;
  pseudo: string;
  derniereVisite: string | null;
  exercices: number;
  resolus: number;
  quizPasses: number;
  moyenneQuiz: number | null;
  /** Demandes de réponse directe repérées (compteur, sans le texte). */
  demandesReponse: number;
  aRetravailler: Chapitre[];
}

export interface QuizStat {
  id: string;
  titre: string;
  chapitre: Chapitre | null;
  publie: boolean;
  participants: number;
  tentatives: number;
  moyenne: number | null;
}

export interface ClassDashboard {
  periodeJours: Periode;
  resume: {
    apprentis: number;
    actifs: number;
    exercices: number;
    exercicesResolus: number;
    quizPasses: number;
    moyenneQuiz: number | null;
  };
  chapitres: ChapterStat[];
  apprentis: ApprentiStat[];
  quiz: QuizStat[];
}

export interface QuizResults {
  id: string;
  titre: string;
  chapitre: Chapitre | null;
  participants: number;
  moyenne: number | null;
  questions: {
    index: number;
    enonce: string;
    bonneReponse: string;
    reponses: number;
    reussite: number | null;
    /** Mauvaise réponse la plus choisie : souvent l'erreur typique à retravailler. */
    erreurFrequente: { choix: string; fois: number } | null;
  }[];
  apprentis: { id: string; pseudo: string; meilleurScore: number; total: number; tentatives: number; derniereTentative: string }[];
}

// ── Suivi des progrès de l'apprenti ──────────────────────────────────────────

/** Battement d'activité : une minute comptée par minute passée sur l'application (page visible). */
export const ACTIVITY_PING_SECONDS = 60;

export interface ApprentiProgress {
  pseudo: string;
  /** Les 7 derniers jours. */
  semaine: {
    secondes: number;
    joursActifs: number;
    exercices: number;
    exercicesResolus: number;
    quiz: number;
    moyenneQuiz: number | null;
  };
  /** Temps passé par semaine (lundi → dimanche), de la plus ancienne à la plus récente. */
  semaines: { debut: string; secondes: number }[];
  /** Maîtrise par notion sur les 90 derniers jours (même règle que le tableau de bord). */
  chapitres: ChapterStat[];
  /** Questions de quiz ratées et pas encore réussies depuis : les erreurs à reprendre. */
  aRevoir: {
    enonce: string;
    bonneReponse: string;
    explication: string;
    chapitre: Chapitre | null;
    fois: number;
    derniere: string;
  }[];
}

export interface LLMStatus {
  fournisseur: string;
  modele: string;
  repli: { fournisseur: string; modele: string } | null;
  /** Fournisseur factice : réponses de démonstration, aucune donnée envoyée. */
  modeDemo: boolean;
  limiteQuotidienne: number;
}

export interface ApiError {
  error: string;
}
