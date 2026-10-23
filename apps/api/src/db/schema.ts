import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { CONSENT_GIVERS, CONSENT_TYPES, METIERS, NIVEAUX, ROLES } from '@mathsuivi/shared';

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

export type User = typeof users.$inferSelect;
export type Class = typeof classes.$inferSelect;
