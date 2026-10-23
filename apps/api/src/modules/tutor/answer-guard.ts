import { plainText } from '@mathsuivi/shared';
import { containsNumber, extractNumbers } from './numbers.js';

export const GUARD_REPLACEMENT =
  'Je te laisse trouver ce résultat toi-même : refais le calcul et dis-moi ce que tu obtiens.';

/**
 * Dernier rempart, indépendant du modèle : si le tuteur s'apprête à écrire le
 * résultat attendu alors que l'apprenti ne l'a pas encore trouvé, la phrase est
 * remplacée avant d'arriver à l'écran.
 *
 * Le flux est découpé en phrases (un nombre n'est jamais coupé en deux) :
 * on ne laisse passer que les phrases complètes et vérifiées.
 */
export class AnswerGuard {
  private buffer = '';
  private replaced = false;
  blocked = 0;
  private readonly targets: number[];

  /**
   * @param expected  résultat(s) attendu(s), connus du serveur seulement
   * @param allowed   nombres que l'apprenti a déjà vus ou écrits (énoncé, ses messages)
   */
  constructor(expected: string | null, allowed: string[]) {
    const known = allowed.flatMap((text) => extractNumbers(plainText(text)));
    this.targets = expected ? extractNumbers(expected).filter((n) => !containsNumber(known, n)) : [];
  }

  get active() {
    return this.targets.length > 0;
  }

  /** Reçoit un morceau du flux, renvoie le texte sûr à afficher maintenant. */
  push(chunk: string): string {
    if (!this.active) return chunk;
    this.buffer += chunk;
    // Fin de phrase : ponctuation suivie d'un blanc, ou retour à la ligne.
    // « 3.5 » ou « 3,5 » ne coupe pas (pas de blanc après le point).
    const boundary = /[.!?…:;](?=\s)|\n/g;
    let last = -1;
    for (const m of this.buffer.matchAll(boundary)) last = m.index! + m[0].length;
    if (last === -1) return '';
    const ready = this.buffer.slice(0, last);
    this.buffer = this.buffer.slice(last);
    return this.check(ready);
  }

  /** Fin du flux : vérifie et renvoie le reste. */
  flush(): string {
    const rest = this.buffer;
    this.buffer = '';
    return this.active ? this.check(rest) : rest;
  }

  private check(text: string): string {
    // Découpe fine pour ne remplacer que la phrase fautive.
    return text
      .split(/(?<=[.!?…:;]\s|\n)/)
      .map((sentence) => {
        // On vérifie le texte tel que l'apprenti le verra : « 14{,}4 » en LaTeX s'affiche « 14,4 ».
        if (!this.targets.some((t) => containsNumber(extractNumbers(plainText(sentence)), t))) return sentence;
        this.blocked++;
        if (this.replaced) return '';
        this.replaced = true;
        const leading = sentence.match(/^\s*/)?.[0] ?? '';
        const trailing = sentence.match(/\s*$/)?.[0] ?? '';
        return leading + GUARD_REPLACEMENT + trailing;
      })
      .join('');
  }
}
