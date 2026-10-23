import { and, count, desc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { ClassCreate, ClassMember, FormateurClass, FormateurClassDetail } from '@mathsuivi/shared';
import type { AppDeps } from '../../deps.js';
import { authSessions, classMembers, classes, users, type Class, type User } from '../../db/schema.js';
import { hashPin, randomClassCode, randomPin } from '../../lib/crypto.js';
import { badRequest, notFound } from '../../lib/http.js';
import { isUniqueViolation } from '../auth/service.js';
import { deleteUser, setIaConsent, usersWithIaConsent } from '../privacy/service.js';

const uuid = z.string().uuid();

function toFormateurClass(cls: Class, nbApprentis: number): FormateurClass {
  return {
    id: cls.id,
    nom: cls.nom,
    metier: cls.metier,
    niveau: cls.niveau,
    archivee: cls.archivedAt !== null,
    code: cls.code,
    nbApprentis,
    creeLe: cls.createdAt.toISOString(),
  };
}

/** Une classe du formateur connecté (ou n'importe laquelle pour un admin), sinon 404. */
export async function getOwnedClass({ db }: AppDeps, user: User, classId: string): Promise<Class> {
  if (!uuid.safeParse(classId).success) throw notFound('Classe introuvable.');
  const [cls] = await db
    .select()
    .from(classes)
    .where(user.role === 'admin' ? eq(classes.id, classId) : and(eq(classes.id, classId), eq(classes.formateurId, user.id)))
    .limit(1);
  if (!cls) throw notFound('Classe introuvable.');
  return cls;
}

async function getMember(deps: AppDeps, user: User, classId: string, apprentiId: string): Promise<User> {
  const cls = await getOwnedClass(deps, user, classId);
  if (!uuid.safeParse(apprentiId).success) throw notFound('Apprenti introuvable.');
  const [row] = await deps.db
    .select({ user: users })
    .from(classMembers)
    .innerJoin(users, eq(users.id, classMembers.userId))
    .where(and(eq(classMembers.classId, cls.id), eq(classMembers.userId, apprentiId)))
    .limit(1);
  if (!row) throw notFound('Apprenti introuvable.');
  return row.user;
}

/** Insère avec un nouveau code classe ; réessaie dans le cas (rare) d'une collision. */
async function withUniqueCode<T>(attempt: (code: string) => Promise<T>): Promise<T> {
  for (let i = 0; i < 5; i++) {
    try {
      return await attempt(randomClassCode());
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new Error('Impossible de générer un code classe unique.');
}

export async function listClasses({ db }: AppDeps, user: User): Promise<FormateurClass[]> {
  const rows = await db
    .select({ cls: classes, nb: count(classMembers.userId) })
    .from(classes)
    .leftJoin(classMembers, eq(classMembers.classId, classes.id))
    .where(eq(classes.formateurId, user.id))
    .groupBy(classes.id)
    .orderBy(desc(classes.createdAt));
  return rows.map((r) => toFormateurClass(r.cls, r.nb));
}

export async function createClass({ db }: AppDeps, user: User, input: ClassCreate): Promise<FormateurClass> {
  const cls = await withUniqueCode(async (code) => {
    const [row] = await db
      .insert(classes)
      .values({ ...input, nom: input.nom.trim(), formateurId: user.id, code })
      .returning();
    return row!;
  });
  return toFormateurClass(cls, 0);
}

export async function getClassDetail(deps: AppDeps, user: User, classId: string): Promise<FormateurClassDetail> {
  const cls = await getOwnedClass(deps, user, classId);
  const rows = await deps.db
    .select({ user: users, joinedAt: classMembers.joinedAt })
    .from(classMembers)
    .innerJoin(users, eq(users.id, classMembers.userId))
    .where(eq(classMembers.classId, cls.id))
    .orderBy(classMembers.pseudoKey);
  const iaOk = await usersWithIaConsent(
    deps.db,
    rows.map((r) => r.user.id),
  );
  const now = Date.now();
  const apprentis: ClassMember[] = rows.map(({ user: u, joinedAt }) => ({
    id: u.id,
    pseudo: u.pseudo,
    inscritLe: joinedAt.toISOString(),
    derniereVisite: u.lastSeenAt?.toISOString() ?? null,
    moinsDe15Ans: u.moinsDe15 === true,
    tuteurIaAutorise: iaOk.has(u.id),
    doitChangerPin: u.mustChangePin,
    bloque: !!u.lockedUntil && u.lockedUntil.getTime() > now,
  }));
  return { ...toFormateurClass(cls, apprentis.length), apprentis };
}

export async function updateClass(
  deps: AppDeps,
  user: User,
  classId: string,
  input: Partial<ClassCreate> & { archivee?: boolean },
) {
  const cls = await getOwnedClass(deps, user, classId);
  const { archivee, ...fields } = input;
  await deps.db
    .update(classes)
    .set({
      ...fields,
      ...(fields.nom && { nom: fields.nom.trim() }),
      ...(archivee !== undefined && { archivedAt: archivee ? (cls.archivedAt ?? new Date()) : null }),
    })
    .where(eq(classes.id, cls.id));
  return getClassDetail(deps, user, cls.id);
}

export async function regenerateCode(deps: AppDeps, user: User, classId: string) {
  const cls = await getOwnedClass(deps, user, classId);
  await withUniqueCode((code) => deps.db.update(classes).set({ code }).where(eq(classes.id, cls.id)));
  return getClassDetail(deps, user, cls.id);
}

/** Code provisoire à communiquer à l'apprenti, qui devra le changer à la connexion. */
export async function resetApprentiPin(deps: AppDeps, user: User, classId: string, apprentiId: string) {
  const apprenti = await getMember(deps, user, classId, apprentiId);
  const pinTemporaire = randomPin();
  await deps.db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ pinHash: await hashPin(pinTemporaire), mustChangePin: true, failedLogins: 0, lockedUntil: null })
      .where(eq(users.id, apprenti.id));
    await tx.delete(authSessions).where(eq(authSessions.userId, apprenti.id));
  });
  return { pinTemporaire };
}

/** Accord écrit des représentants légaux reçu par le CFA (apprentis de moins de 15 ans). */
export async function recordParentalConsent(
  deps: AppDeps,
  user: User,
  classId: string,
  apprentiId: string,
  accord: boolean,
) {
  const apprenti = await getMember(deps, user, classId, apprentiId);
  if (!apprenti.moinsDe15) {
    throw badRequest('Cet apprenti a 15 ans ou plus : il donne son accord lui-même.');
  }
  await setIaConsent(deps, apprenti.id, accord, 'representant_legal');
  return getClassDetail(deps, user, classId);
}

export async function deleteApprenti(deps: AppDeps, user: User, classId: string, apprentiId: string) {
  const apprenti = await getMember(deps, user, classId, apprentiId);
  await deleteUser(deps, apprenti.id);
}

/**
 * Supprime la classe et les comptes de ses apprentis (fin d'année, RGPD).
 * Un apprenti inscrit aussi dans une autre classe garde son compte.
 */
export async function deleteClass(deps: AppDeps, user: User, classId: string) {
  const cls = await getOwnedClass(deps, user, classId);
  await deps.db.transaction(async (tx) => {
    const members = await tx
      .select({ userId: classMembers.userId })
      .from(classMembers)
      .where(eq(classMembers.classId, cls.id));
    const ids = members.map((m) => m.userId);
    const elsewhere = ids.length
      ? await tx
          .selectDistinct({ userId: classMembers.userId })
          .from(classMembers)
          .where(and(inArray(classMembers.userId, ids), ne(classMembers.classId, cls.id)))
      : [];
    const keep = new Set(elsewhere.map((m) => m.userId));
    const toDelete = ids.filter((id) => !keep.has(id));
    if (toDelete.length) await tx.delete(users).where(and(inArray(users.id, toDelete), eq(users.role, 'apprenti')));
    await tx.delete(classes).where(eq(classes.id, cls.id));
  });
}

export async function countApprentisInClasses({ db }: AppDeps, formateurId: string) {
  const [row] = await db
    .select({ n: count(classMembers.userId) })
    .from(classMembers)
    .innerJoin(classes, eq(classes.id, classMembers.classId))
    .where(eq(classes.formateurId, formateurId));
  return row?.n ?? 0;
}
