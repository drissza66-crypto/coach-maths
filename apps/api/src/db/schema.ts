import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { CONSENT_GIVERS, CONSENT_TYPES, CONTENT_TYPES, ETAPES, METIERS, NIVEAUX, ROLES } from '@mathsuivi/shared';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const roleEnum = pgEnum('role', ROLES);
export const niveauEnum = pgEnum('niveau', NIVEAUX);
export const metierEnum = pgEnum('metier', METIERS);
export const consentTypeEnum = pgEnum('consent_type', CONSENT_TYPES);
export const consentGiverEnum = pgEnum('consent_giver', CONSENT_GIVERS);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  role: roleEnum('role').notNull(),
  /** Formateurs uniquement : les apprentis n'ont pas besoin d'e-mail. */
  email: text('email').unique(),
  pseudo: text('pseudo').notNull(),
  pinHash: text('pin_hash'),
  mustChangePin: boolean('must_change_pin').notNull().default(false),
  niveau: niveauEnum('niveau'),
  /** Plutôt que la date de naissance (minimisation des données). */
  moinsDe15: boolean('moins_de_15'),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: timestamptz('locked_until'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  lastSeenAt: timestamptz('last_seen_at'),
});

export const classes = pgTable(
  'classes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nom: text('nom').notNull(),
    metier: metierEnum('metier').notNull(),
    niveau: niveauEnum('niveau').notNull(),
    formateurId: uuid('formateur_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    code: text('code').notNull().unique(),
    archivedAt: timestamptz('archived_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('classes_formateur_idx').on(t.formateurId)],
);

export const classMembers = pgTable(
  'class_members',
  {
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Pseudo normalisé : unique dans une classe. */
    pseudoKey: text('pseudo_key').notNull(),
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.classId, t.userId] }),
    uniqueIndex('class_members_pseudo_idx').on(t.classId, t.pseudoKey),
    index('class_members_user_idx').on(t.userId),
  ],
);

export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: consentTypeEnum('type').notNull(),
    donnePar: consentGiverEnum('donne_par').notNull(),
    version: text('version').notNull(),
    grantedAt: timestamptz('granted_at').notNull().defaultNow(),
    revokedAt: timestamptz('revoked_at'),
  },
  (t) => [index('consents_user_idx').on(t.userId)],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('auth_sessions_user_idx').on(t.userId)],
);

export const magicLinks = pgTable('magic_links', {
  tokenHash: text('token_hash').primaryKey(),
  email: text('email').notNull(),
  expiresAt: timestamptz('expires_at').notNull(),
  usedAt: timestamptz('used_at'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

// ── IA : journal et limites ──────────────────────────────────────────────────

export const llmPurposeEnum = pgEnum('llm_purpose', ['chat', 'generate', 'vision', 'classify']);

/** Qui a répondu, combien de temps, combien de jetons. JAMAIS le contenu des échanges. */
export const llmCalls = pgTable(
  'llm_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    purpose: llmPurposeEnum('purpose').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    fallbackUsed: boolean('fallback_used').notNull().default(false),
    /** "ok" ou le type d'erreur (rate_limit, quota, timeout…). */
    status: text('status').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('llm_calls_created_idx').on(t.createdAt)],
);

/** Messages envoyés au tuteur par apprenti et par jour (heure de Paris). */
export const dailyUsage = pgTable(
  'daily_usage',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: text('day').notNull(),
    messages: integer('messages').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

// ── Tuteur ───────────────────────────────────────────────────────────────────

export const etapeEnum = pgEnum('etape_tuteur', ETAPES);
export const auteurEnum = pgEnum('auteur_message', ['apprenti', 'tuteur']);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    enonce: text('enonce').notNull(),
    chapitre: text('chapitre'),
    notion: text('notion'),
    /** Connue du serveur seulement : sert à vérifier l'apprenti et à bloquer les fuites. */
    reponseAttendue: text('reponse_attendue'),
    etape: etapeEnum('etape').notNull().default('comprehension'),
    niveauIndice: integer('niveau_indice').notNull().default(0),
    resoluLe: timestamptz('resolu_le'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    /** Dernière activité : la conversation est effacée CHAT_RETENTION_DAYS après. */
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('conversations_user_idx').on(t.userId, t.updatedAt)],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    auteur: auteurEnum('auteur').notNull(),
    contenu: text('contenu').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId, t.createdAt)],
);

/** Événements de modération : catégorie seulement, jamais le texte. */
export const moderationEvents = pgTable(
  'moderation_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
    categorie: text('categorie').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('moderation_events_user_idx').on(t.userId)],
);

// ── Documents de cours (RAG) ─────────────────────────────────────────────────

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

/**
 * Cours importés par le formateur pour une classe. Le fichier est chiffré sur disque
 * (storage_key) et supprimé avec la ligne à expires_at. Les photos d'énoncé des
 * apprentis ne sont jamais stockées : lues en mémoire, puis oubliées.
 */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    titre: text('titre').notNull(),
    nomFichier: text('nom_fichier').notNull(),
    mime: text('mime').notNull(),
    taille: integer('taille').notNull(),
    sha256: text('sha256').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    nbPages: integer('nb_pages').notNull(),
    nbCaracteres: integer('nb_caracteres').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
  },
  (t) => [index('documents_class_idx').on(t.classId), uniqueIndex('documents_class_sha_idx').on(t.classId, t.sha256)],
);

export const documentChunks = pgTable(
  'document_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    page: integer('page').notNull(),
    contenu: text('contenu').notNull(),
    /** Index plein texte en français, calculé par PostgreSQL. */
    tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector('french', "contenu")`),
  },
  (t) => [index('document_chunks_doc_idx').on(t.documentId), index('document_chunks_tsv_idx').using('gin', t.tsv)],
);

// ── Fiches, quiz, flashcards ─────────────────────────────────────────────────

export const contentTypeEnum = pgEnum('content_type', CONTENT_TYPES);

/** Contenus générés par l'IA, relus par le formateur, puis publiés pour la classe. */
export const contents = pgTable(
  'contents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    /** Le cours source peut expirer : le contenu généré reste. */
    sourceDocumentId: uuid('source_document_id').references(() => documents.id, { onDelete: 'set null' }),
    sourceTitre: text('source_titre'),
    type: contentTypeEnum('type').notNull(),
    chapitre: text('chapitre'),
    notion: text('notion'),
    titre: text('titre').notNull(),
    body: jsonb('body').notNull(),
    publishedAt: timestamptz('published_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('contents_class_idx').on(t.classId)],
);

export const quizAttempts = pgTable(
  'quiz_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contentId: uuid('content_id')
      .notNull()
      .references(() => contents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    total: integer('total').notNull(),
    /** Réponse choisie par question (-1 = sans réponse) et justesse. */
    reponses: jsonb('reponses').notNull(),
    dureeSecondes: integer('duree_secondes'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('quiz_attempts_user_idx').on(t.userId), index('quiz_attempts_content_idx').on(t.contentId)],
);

export type User = typeof users.$inferSelect;
export type ContentRow = typeof contents.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Class = typeof classes.$inferSelect;
