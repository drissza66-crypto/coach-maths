import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';

export interface CourseExtract {
  titre: string;
  page: number;
  contenu: string;
}

/** Mots utiles d'une question (lettres et chiffres, 3 caractères ou plus). */
export function searchTerms(query: string, max = 24): string[] {
  const words = query
    .toLowerCase()
    .match(/[\p{L}\p{N}]{3,}/gu);
  return [...new Set(words ?? [])].slice(0, max);
}

/**
 * RAG simple : recherche plein texte PostgreSQL (français, racinisation) dans les
 * cours de la classe. Un mot commun suffit (OU), les passages les plus pertinents d'abord.
 */
export async function searchCourses(db: Db, classId: string, query: string, limit = 3): Promise<CourseExtract[]> {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  // Les termes ne contiennent que des lettres et des chiffres : pas d'opérateur injectable.
  const tsquery = terms.join(' | ');
  const { rows } = (await db.execute(sql`
    select d.titre, c.page, c.contenu, ts_rank_cd(c.tsv, to_tsquery('french', ${tsquery})) as rang
    from document_chunks c
    join documents d on d.id = c.document_id
    where d.class_id = ${classId}
      and d.expires_at > now()
      and c.tsv @@ to_tsquery('french', ${tsquery})
    order by rang desc, c.idx
    limit ${limit}
  `)) as unknown as { rows: (CourseExtract & { rang: number })[] };
  // Un seul mot en commun (« rectangle » dans « triangle rectangle ») ne suffit pas :
  // on garde les passages au moins moitié aussi pertinents que le meilleur.
  const best = rows[0]?.rang ?? 0;
  return rows.filter((r) => r.rang >= best * 0.5).map(({ titre, page, contenu }) => ({ titre, page, contenu }));
}

/** Mise en forme pour le prompt du tuteur, dans une taille maîtrisée. */
export function formatExtracts(extracts: CourseExtract[], maxChars = 1800): string | undefined {
  if (!extracts.length) return undefined;
  let total = 0;
  const parts: string[] = [];
  for (const e of extracts) {
    const block = `[Cours « ${e.titre} », page ${e.page}]\n${e.contenu}`;
    if (total + block.length > maxChars) {
      if (!parts.length) parts.push(block.slice(0, maxChars));
      break;
    }
    parts.push(block);
    total += block.length;
  }
  return parts.join('\n\n');
}
