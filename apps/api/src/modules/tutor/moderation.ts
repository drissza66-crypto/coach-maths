/**
 * Modération des messages de l'apprenti, avant tout envoi à l'IA :
 * - informations personnelles masquées (minimisation RGPD) ;
 * - mal-être ou danger : réponse humaine fixe, sans IA, avec les numéros d'aide ;
 * - langage inadapté : rappel bienveillant, sans IA.
 */

export type ModerationCategory = 'detresse' | 'langage';

export interface ModerationResult {
  /** Texte à conserver et à envoyer à l'IA (données personnelles masquées). */
  texte: string;
  masque: boolean;
  categorie: ModerationCategory | null;
  /** Réponse fixe à afficher à la place de l'IA. */
  reponse: string | null;
}

export const MASK = '[masqué]';

const PERSONAL = [
  /[\w.+-]+@[\w-]+\.[\w.-]+/g,
  /(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}/g,
  /\b\d{1,4}(?:\s?(?:bis|ter))?,?\s+(?:rue|avenue|av\.|boulevard|bd|chemin|all[ée]e|impasse|place|route|quai|cours)\s+[^\n,.;!?]{2,40}/gi,
];

const DETRESSE = [
  /\bsuicid/i,
  /\b(me|se) (tuer|suicider|foutre en l.air)\b/i,
  /\ben finir\b/i,
  /\b(envie|veux|vais) (de )?mourir\b/i,
  /\bme (faire du mal|scarifier|couper)\b/i,
  /\bscarif/i,
  /\b(on|il|elle|ils) me (frappe|bat|touche|harc[eè]le|menace)\b/i,
  /\bje suis (harcel[ée]|battu|frapp[ée])\b/i,
  /\bpersonne ne m.aime\b/i,
];

const LANGAGE = [
  /\b(connard|connasse|encul[ée]|pute|salope|batard|bâtard|nique|niquer|fdp|ntm|tg|ta gueule|pd|tapette|nègre|negro|bougnoule)\b/i,
];

export const REPONSE_DETRESSE =
  'Merci de m’en parler. Ce que tu vis est important, et tu n’es pas seul.\n' +
  'Parle-en dès que possible à ton formateur ou à un adulte de confiance.\n' +
  'Tu peux aussi appeler gratuitement, 24 h/24 :\n' +
  '• 3114 si tu as des idées noires ;\n' +
  '• 119 si tu es en danger ou maltraité ;\n' +
  '• 112 en cas d’urgence.\n' +
  'Les maths peuvent attendre. Prends soin de toi.';

export const REPONSE_LANGAGE =
  'Restons respectueux, s’il te plaît. Je suis là pour t’aider sur ton exercice : où est-ce que tu bloques ?';

export function moderateInput(raw: string): ModerationResult {
  let texte = raw;
  for (const pattern of PERSONAL) texte = texte.replace(pattern, MASK);
  const masque = texte !== raw;

  if (DETRESSE.some((r) => r.test(raw))) {
    return { texte, masque, categorie: 'detresse', reponse: REPONSE_DETRESSE };
  }
  if (LANGAGE.some((r) => r.test(raw))) {
    return { texte, masque, categorie: 'langage', reponse: REPONSE_LANGAGE };
  }
  return { texte, masque, categorie: null, reponse: null };
}
