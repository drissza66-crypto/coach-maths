/**
 * Nombres écrits à la française ou à l'anglaise : 21,6 · 21.6 · 1 200 · 1 200,50 · 12 %.
 * Les milliers séparés par une espace doivent avoir des groupes de 3 chiffres.
 */
const NUMBER = /(?<![\d.,])\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?(?![\d])|\d+(?:[.,]\d+)?/g;

export function extractNumbers(text: string): number[] {
  return [...text.matchAll(NUMBER)]
    .map((m) => Number(m[0].replace(/[   ]/g, '').replace(',', '.')))
    .filter((n) => Number.isFinite(n));
}

export function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
}

export function containsNumber(haystack: number[], n: number): boolean {
  return haystack.some((h) => sameNumber(h, n));
}
