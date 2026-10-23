/**
 * Les modèles écrivent parfois du LaTeX ou du Markdown malgré la consigne
 * « Pas de LaTeX ». Ce nettoyage le transforme en texte lisible par un apprenti :
 * `\( 4,5 \text{ m} \times 3,2 \)` → `4,5 m × 3,2`, `**gras**` → `gras`, etc.
 * Idempotent : nettoyer un texte déjà propre ne le change pas.
 */

const SYMBOLS: Record<string, string> = {
  times: '×',
  cdot: '×',
  div: '÷',
  approx: '≈',
  simeq: '≈',
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  neq: '≠',
  ne: '≠',
  pi: 'π',
  pm: '±',
  rightarrow: '→',
  to: '→',
  Rightarrow: '⇒',
  degree: '°',
  circ: '°',
};

const SUPERSCRIPT: Record<string, string> = { '2': '²', '3': '³' };

/** Contenu de l'accolade ouvrante à `start` (accolades imbriquées comprises), et position après la fermante. */
function readGroup(s: string, start: number): { content: string; end: number } | null {
  let i = start;
  while (s[i] === ' ') i++;
  if (s[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}' && --depth === 0) return { content: s.slice(i + 1, j), end: j + 1 };
  }
  return null;
}

/**
 * \frac{a}{b} → a ÷ b, avec un vrai repérage des accolades : \frac{12}{1{,}44} doit donner
 * « 12 ÷ 1,44 », jamais « 121,44 » (deux nombres collés, donc un résultat faux à l'écran).
 */
function replaceFractions(s: string): string {
  const wrap = (x: string) => (/[\s+\-×÷]/.test(x.trim()) ? `(${x.trim()})` : x.trim());
  let out = '';
  let i = 0;
  const re = /\\[dt]?frac/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const num = readGroup(s, m.index + m[0].length);
    const den = num && readGroup(s, num.end);
    if (!num || !den) continue;
    out += s.slice(i, m.index) + `${wrap(replaceFractions(num.content))} ÷ ${wrap(replaceFractions(den.content))}`;
    i = den.end;
    re.lastIndex = den.end;
  }
  return out + s.slice(i);
}

function latexToText(math: string): string {
  // Virgule et point décimaux à la LaTeX : 1{,}44 → 1,44
  let s = math.replace(/\{([,.])\}/g, '$1');
  s = replaceFractions(s);
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)');
  s = s.replace(/\\(?:text|mathrm|mathbf|textbf|textit|operatorname|mbox)\s*\{([^{}]*)\}/g, '$1');
  s = s.replace(/\\(left|right|big|Big|bigg|Bigg)\b\s*/g, '');
  s = s.replace(/\\%/g, '%');
  s = s.replace(/\\[,;:! ]/g, ' ');
  s = s.replace(/\\([a-zA-Z]+)/g, (whole, name: string) => SYMBOLS[name] ?? '');
  // Puissances : m^2, m^{3}
  s = s.replace(/\^\{?([23])\}?/g, (_, d: string) => SUPERSCRIPT[d]!);
  s = s.replace(/[{}]/g, '');
  return s.replace(/[ \t]{2,}/g, ' ');
}

function tableToLines(block: string): string {
  return block
    .split('\n')
    .filter((line) => !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line))
    .map((line) =>
      line
        .replace(/^\s*\|/, '')
        .replace(/\|\s*$/, '')
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean)
        .join(' — '),
    )
    .join('\n');
}

export function plainText(input: string): string {
  let s = input;

  // Blocs de code ``` … ``` puis code en ligne `…`
  s = s.replace(/```[a-z]*\n?([\s\S]*?)```/gi, '$1');
  s = s.replace(/`([^`\n]+)`/g, '$1');

  // Formules LaTeX délimitées : \( … \), \[ … \], $$ … $$, $ … $
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_, m: string) => latexToText(m));
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_, m: string) => latexToText(m));
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, m: string) => latexToText(m));
  // $…$ seulement s'il contient une commande LaTeX : « 15 $ » ou un prix ne sont pas touchés
  s = s.replace(/\$([^$\n]*\\[a-zA-Z][^$\n]*)\$/g, (_, m: string) => latexToText(m));
  // Commandes LaTeX restées sans délimiteurs
  if (/\\(times|frac|text|div|cdot|approx|sqrt|left|right)\b/.test(s)) s = latexToText(s);

  // Tableaux Markdown : chaque ligne devient « cellule — cellule »
  s = s.replace(/(?:^[ \t]*\|.*\|[ \t]*(?:\n|$))+/gm, (block) => `${tableToLines(block.trimEnd())}\n`);

  // Titres, gras, italique
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
  s = s.replace(/(\d)\s*\*\s*(\d)/g, '$1 × $2');
  s = s.replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s).,;:!?]|$)/g, '$1$2');

  // Émojis chiffres 1️⃣ → « 1. »
  s = s.replace(/([0-9])️?⃣/g, '$1.');

  return s
    .replace(/(\S)[ \t]{2,}/g, '$1 ') // espaces doubles laissées par une formule retirée (pas en début de ligne)
    .replace(/(\S) +([.,])(?=\s|$)/g, '$1$2') // « m . » → « m. »
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Applique plainText à toutes les chaînes d'un objet (fiches, quiz, cartes générés). */
export function plainTextDeep<T>(value: T): T {
  if (typeof value === 'string') return plainText(value) as T;
  if (Array.isArray(value)) return value.map(plainTextDeep) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plainTextDeep(v)])) as T;
  }
  return value;
}
