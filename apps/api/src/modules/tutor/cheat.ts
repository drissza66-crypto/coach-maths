/**
 * Repère les demandes de triche et les tentatives de contourner les règles.
 * Rien n'est bloqué : le tuteur reçoit une consigne pour ramener l'apprenti
 * vers la démarche, et un compteur (sans texte) est enregistré.
 */
const TRICHE = [
  /\b(donne|dis|[ée]cris|envoie|file)[- ]?(moi|nous)?\s+(juste\s+|seulement\s+|direct(ement)?\s+)?(la|le|les)\s+(r[ée]ponses?|r[ée]sultats?|solutions?|corrig[ée]s?)\b/i,
  /\b(c.?est|ca fait|ça fait|ça donne|ca donne)\s+(quoi|combien)\b/i,
  /\bquel(le)? est (la|le) (r[ée]ponse|r[ée]sultat|solution)\b/i,
  /\bfais[- ](le|les|l.exo|l.exercice|mon exo|mon exercice|mes exercices|mon devoir)\b/i,
  /(?:^|\s)(à|a) ma place\b/i,
  /\bjuste (la|le) (r[ée]ponse|r[ée]sultat)\b/i,
  // « le corrigé » (pas « corrige mon calcul », qui est une demande de vérification).
  /\b(le|un|du|les) corrig[ée]s?(?!\p{L})/iu,
  /\bpas le temps\b.*\b(r[ée]ponse|r[ée]sultat)\b/i,
];

const INJECTION = [
  /\b(ignore|oublie|annule)\w*\s+(tes|les|toutes? (tes|les))\s+(r[èe]gles|instructions|consignes)\b/i,
  /\b(nouvelles?|autres?)\s+(r[èe]gles|instructions|consignes)\b/i,
  /\bmode (d[ée]veloppeur|admin|professeur|prof|correcteur|dev)\b/i,
  /\b(fais|fait) comme si\b/i,
  /\b(tu es|t.es|tu deviens) (maintenant |d[ée]sormais )?(un |une )?(prof|professeur|correcteur|calculatrice|solveur)\b/i,
  /\b(mon|le) (formateur|prof|professeur) (a dit|dit|t.autorise|est d.accord|veut) (que )?(tu|de)\b/i,
  /\bsystem prompt|prompt syst[èe]me|jailbreak\b/i,
];

export interface CheatSignal {
  triche: boolean;
  injection: boolean;
}

export function detectCheat(text: string): CheatSignal {
  return {
    triche: TRICHE.some((r) => r.test(text)),
    injection: INJECTION.some((r) => r.test(text)),
  };
}
