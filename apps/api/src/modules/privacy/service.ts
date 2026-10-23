import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { ConsentGiver, Me } from '@mathsuivi/shared';
import type { AppDeps } from '../../deps.js';
import type { Db } from '../../db/client.js';
import { classMembers, classes, consents, users, type User } from '../../db/schema.js';
import { forbidden } from '../../lib/http.js';
import { exportConversations } from '../tutor/service.js';
import { removeFilesWhere, toCourseDocument } from '../documents/service.js';
import { documents } from '../../db/schema.js';

/** Utilisateurs (parmi userIds) qui ont un accord actif pour le tuteur IA. */
export async function usersWithIaConsent(db: Db, userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const rows = await db
    .select({ userId: consents.userId })
    .from(consents)
    .where(and(inArray(consents.userId, userIds), eq(consents.type, 'ia_tuteur'), isNull(consents.revokedAt)));
  return new Set(rows.map((r) => r.userId));
}

export async function buildMe({ db }: AppDeps, user: User): Promise<Me> {
  const userClasses =
    user.role === 'apprenti'
      ? await db
          .select({ cls: classes })
          .from(classMembers)
          .innerJoin(classes, eq(classes.id, classMembers.classId))
          .where(eq(classMembers.userId, user.id))
          .then((rows) => rows.map((r) => r.cls))
      : await db.select().from(classes).where(eq(classes.formateurId, user.id));

  return {
    id: user.id,
    role: user.role,
    pseudo: user.pseudo,
    email: user.email,
    niveau: user.niveau,
    moinsDe15Ans: user.moinsDe15,
    doitChangerPin: user.mustChangePin,
    tuteurIaAutorise: user.role !== 'apprenti' || (await usersWithIaConsent(db, [user.id])).has(user.id),
    classes: userClasses.map((c) => ({
      id: c.id,
      nom: c.nom,
      metier: c.metier,
      niveau: c.niveau,
      archivee: c.archivedAt !== null,
    })),
  };
}

export async function setIaConsent(
  { db, env }: AppDeps,
  userId: string,
  accord: boolean,
  donnePar: ConsentGiver,
) {
  await db.transaction(async (tx) => {
    // Un seul accord actif à la fois : on clôt l'ancien avant d'en créer un nouveau.
    await tx
      .update(consents)
      .set({ revokedAt: new Date() })
      .where(and(eq(consents.userId, userId), eq(consents.type, 'ia_tuteur'), isNull(consents.revokedAt)));
    if (accord) {
      await tx.insert(consents).values({ userId, type: 'ia_tuteur', donnePar, version: env.CONSENT_VERSION });
    }
  });
}

export async function updateOwnIaConsent(deps: AppDeps, user: User, accord: boolean) {
  if (user.role !== 'apprenti') throw forbidden();
  // Moins de 15 ans : seuls les représentants légaux peuvent donner l'accord (le retrait reste possible).
  if (accord && user.moinsDe15) {
    throw forbidden('Tu as moins de 15 ans : l’accord doit venir de tes parents. Parles-en à ton formateur.');
  }
  await setIaConsent(deps, user.id, accord, 'apprenti');
}

/** Droit d'accès : toutes les données liées au compte, sans les secrets. */
export async function exportUserData(deps: AppDeps, user: User) {
  const { db } = deps;
  const userConsents = await db.select().from(consents).where(eq(consents.userId, user.id));
  return {
    exporteLe: new Date().toISOString(),
    compte: {
      id: user.id,
      role: user.role,
      pseudo: user.pseudo,
      email: user.email,
      niveau: user.niveau,
      moinsDe15Ans: user.moinsDe15,
      creeLe: user.createdAt.toISOString(),
      derniereVisite: user.lastSeenAt?.toISOString() ?? null,
    },
    classes: (await buildMe(deps, user)).classes,
    consentements: userConsents.map((c) => ({
      type: c.type,
      donnePar: c.donnePar,
      version: c.version,
      donneLe: c.grantedAt.toISOString(),
      retireLe: c.revokedAt?.toISOString() ?? null,
    })),
    conversationsAvecLeTuteur: await exportConversations(deps, user.id),
    documentsImportes: (await db.select().from(documents).where(eq(documents.ownerId, user.id))).map(toCourseDocument),
  };
}

/**
 * Droit à l'effacement : la suppression du compte efface tout en cascade.
 * Les fichiers chiffrés ne sont pas en base : ils sont effacés d'abord.
 */
export async function deleteUser(deps: AppDeps, userId: string) {
  await removeFilesWhere(deps, { ownerId: userId });
  await deps.db.delete(users).where(eq(users.id, userId));
}
