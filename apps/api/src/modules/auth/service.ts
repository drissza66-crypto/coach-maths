import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import { pseudoKey, type ApprentiRegister } from '@mathsuivi/shared';
import type { AppDeps } from '../../deps.js';
import { authSessions, classMembers, classes, consents, magicLinks, users, type User } from '../../db/schema.js';
import { hashPin, randomToken, sha256, verifyPin } from '../../lib/crypto.js';
import { HttpError, badRequest, conflict, notFound } from '../../lib/http.js';

const LOGIN_FAILED = 'Pseudo ou code incorrect.';
// Hash factice : le temps de réponse est le même que le pseudo existe ou non.
const DUMMY_HASH = await hashPin('000000');

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

// ── Formateur : lien magique ─────────────────────────────────────────────────

export async function requestMagicLink({ db, env, mailer }: AppDeps, email: string) {
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const domain = email.split('@')[1] ?? '';
  const allowed = existing ? existing.role !== 'apprenti' : env.FORMATEUR_ALLOWED_DOMAINS.includes(domain);
  // Même réponse dans tous les cas, pour ne pas révéler quels e-mails existent.
  if (!allowed) return { devLink: undefined };

  const token = randomToken();
  await db.insert(magicLinks).values({
    tokenHash: sha256(token),
    email,
    expiresAt: new Date(Date.now() + env.MAGIC_LINK_TTL_MINUTES * 60 * 1000),
  });
  // Jeton dans le fragment (#) : il n'apparaît ni dans les logs serveur ni dans le Referer.
  const link = `${env.APP_URL}/formateur/verification#token=${token}`;
  await mailer.send({
    to: email,
    subject: 'Votre lien de connexion — Coach Maths',
    text:
      `Bonjour,\n\nCliquez sur ce lien pour vous connecter à Coach Maths :\n${link}\n\n` +
      `Il est valable ${env.MAGIC_LINK_TTL_MINUTES} minutes et ne sert qu'une fois.\n` +
      `Si vous n'avez rien demandé, ignorez ce message.`,
  });
  const devLink = env.MAIL_TRANSPORT === 'console' && env.NODE_ENV !== 'production' ? link : undefined;
  return { devLink };
}

export async function verifyMagicLink({ db }: AppDeps, token: string): Promise<User> {
  const now = new Date();
  // Mise à jour conditionnelle : un lien ne peut servir qu'une seule fois, même en cas de double clic.
  const [link] = await db
    .update(magicLinks)
    .set({ usedAt: now })
    .where(and(eq(magicLinks.tokenHash, sha256(token)), isNull(magicLinks.usedAt), gt(magicLinks.expiresAt, now)))
    .returning({ email: magicLinks.email });
  if (!link) throw badRequest('Ce lien n’est plus valable. Demandez un nouveau lien.');

  const [existing] = await db.select().from(users).where(eq(users.email, link.email)).limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(users)
    .values({ role: 'formateur', email: link.email, pseudo: link.email.split('@')[0]! })
    .returning();
  return created!;
}

// ── Apprenti : code classe + pseudo + PIN ────────────────────────────────────

export async function findOpenClass({ db }: AppDeps, code: string) {
  const [cls] = await db
    .select()
    .from(classes)
    .where(and(eq(classes.code, code), isNull(classes.archivedAt)))
    .limit(1);
  if (!cls) throw notFound('Code classe inconnu. Vérifie avec ton formateur.');
  return cls;
}

export async function registerApprenti(deps: AppDeps, input: ApprentiRegister & { code: string }): Promise<User> {
  const { db, env } = deps;
  const cls = await findOpenClass(deps, input.code);
  const key = pseudoKey(input.pseudo);
  const taken = 'Ce pseudo est déjà pris dans ta classe. Choisis-en un autre.';

  const [existing] = await db
    .select({ userId: classMembers.userId })
    .from(classMembers)
    .where(and(eq(classMembers.classId, cls.id), eq(classMembers.pseudoKey, key)))
    .limit(1);
  if (existing) throw conflict(taken);

  const pinHash = await hashPin(input.pin);
  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          role: 'apprenti',
          pseudo: input.pseudo.trim(),
          pinHash,
          niveau: cls.niveau,
          moinsDe15: !input.aPlusDe15Ans,
        })
        .returning();
      await tx.insert(classMembers).values({ classId: cls.id, userId: user!.id, pseudoKey: key });

      const version = env.CONSENT_VERSION;
      await tx.insert(consents).values({ userId: user!.id, type: 'cgu', donnePar: 'apprenti', version });
      // Moins de 15 ans : l'accord pour le tuteur IA doit venir des représentants légaux (saisi par le formateur).
      if (input.aPlusDe15Ans && input.accepteTuteurIa) {
        await tx.insert(consents).values({ userId: user!.id, type: 'ia_tuteur', donnePar: 'apprenti', version });
      }
      return user!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(taken);
    throw err;
  }
}

export async function loginApprenti(
  deps: AppDeps,
  input: { code: string; pseudo: string; pin: string },
): Promise<User> {
  const { db, env } = deps;
  const cls = await findOpenClass(deps, input.code);
  const [row] = await db
    .select({ user: users })
    .from(classMembers)
    .innerJoin(users, eq(users.id, classMembers.userId))
    .where(and(eq(classMembers.classId, cls.id), eq(classMembers.pseudoKey, pseudoKey(input.pseudo))))
    .limit(1);

  if (!row?.user.pinHash) {
    await verifyPin(input.pin, DUMMY_HASH);
    throw new HttpError(401, LOGIN_FAILED);
  }
  const user = row.user;
  const now = Date.now();
  if (user.lockedUntil && user.lockedUntil.getTime() > now) throw tooManyAttempts(user.lockedUntil);

  if (!(await verifyPin(input.pin, user.pinHash!))) {
    const failed = user.failedLogins + 1;
    if (failed >= env.LOGIN_MAX_ATTEMPTS) {
      const lockedUntil = new Date(now + env.LOGIN_LOCK_MINUTES * 60 * 1000);
      await db.update(users).set({ failedLogins: 0, lockedUntil }).where(eq(users.id, user.id));
      throw tooManyAttempts(lockedUntil);
    }
    await db.update(users).set({ failedLogins: failed }).where(eq(users.id, user.id));
    throw new HttpError(401, LOGIN_FAILED);
  }

  if (user.failedLogins > 0 || user.lockedUntil) {
    await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id));
  }
  return user;
}

function tooManyAttempts(until: Date) {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60000));
  return new HttpError(
    429,
    `Trop d’essais. Réessaie dans ${minutes} minute${minutes > 1 ? 's' : ''}, ou demande à ton formateur.`,
  );
}

export async function changePin(
  { db }: AppDeps,
  user: User,
  sessionId: string,
  input: { currentPin: string; newPin: string },
) {
  if (!user.pinHash || !(await verifyPin(input.currentPin, user.pinHash))) {
    throw badRequest('Ton code actuel est incorrect.');
  }
  if (input.currentPin === input.newPin) throw badRequest('Choisis un code différent de l’ancien.');
  await db
    .update(users)
    .set({ pinHash: await hashPin(input.newPin), mustChangePin: false })
    .where(eq(users.id, user.id));
  // Les autres appareils connectés sont déconnectés.
  await db.delete(authSessions).where(and(eq(authSessions.userId, user.id), ne(authSessions.id, sessionId)));
}
