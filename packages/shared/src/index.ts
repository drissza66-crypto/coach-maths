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
