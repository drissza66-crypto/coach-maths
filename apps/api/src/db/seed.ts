/**
 * Données de démonstration — ENTIÈREMENT FICTIVES.
 * Ne jamais y mettre de vrais noms d'apprentis.
 *
 *   Formateur : formateur@cfa-demo.test (connexion par lien magique)
 *   Classe    : « CAP Maçon 1 — Démo », code DAL-LE7
 *   Apprentis : Truelle (PIN 482916), Niveau (PIN 739251), Equerre (PIN 615842, moins de 15 ans)
 */
import { eq } from 'drizzle-orm';
import { pseudoKey } from '@mathsuivi/shared';
import { hashPin } from '../lib/crypto.js';
import type { Db } from './client.js';
import { classMembers, classes, consents, users } from './schema.js';

export const DEMO = {
  formateurEmail: 'formateur@cfa-demo.test',
  classCode: 'DALLE7',
  apprentis: [
    { pseudo: 'Truelle', pin: '482916', moinsDe15: false },
    { pseudo: 'Niveau', pin: '739251', moinsDe15: false },
    { pseudo: 'Equerre', pin: '615842', moinsDe15: true },
  ],
} as const;

export async function seed(db: Db, consentVersion: string) {
  const [already] = await db.select().from(users).where(eq(users.email, DEMO.formateurEmail)).limit(1);
  if (already) return false;

  await db.transaction(async (tx) => {
    const [formateur] = await tx
      .insert(users)
      .values({ role: 'formateur', email: DEMO.formateurEmail, pseudo: 'Formateur Démo' })
      .returning();
    const [cls] = await tx
      .insert(classes)
      .values({ nom: 'CAP Maçon 1 — Démo', metier: 'macon', niveau: 'CAP1', formateurId: formateur!.id, code: DEMO.classCode })
      .returning();

    for (const a of DEMO.apprentis) {
      const [user] = await tx
        .insert(users)
        .values({ role: 'apprenti', pseudo: a.pseudo, pinHash: await hashPin(a.pin), niveau: 'CAP1', moinsDe15: a.moinsDe15 })
        .returning();
      await tx.insert(classMembers).values({ classId: cls!.id, userId: user!.id, pseudoKey: pseudoKey(a.pseudo) });
      await tx.insert(consents).values({ userId: user!.id, type: 'cgu', donnePar: 'apprenti', version: consentVersion });
      if (!a.moinsDe15) {
        await tx.insert(consents).values({ userId: user!.id, type: 'ia_tuteur', donnePar: 'apprenti', version: consentVersion });
      }
    }
  });
  return true;
}
