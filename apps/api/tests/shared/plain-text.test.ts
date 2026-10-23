import { describe, expect, it } from 'vitest';
import { plainText, plainTextDeep } from '@mathsuivi/shared';

describe('nettoyage du LaTeX et du Markdown (cas relevés par l’éval Groq)', () => {
  it('formule LaTeX en ligne', () => {
    expect(plainText('Pour une surface : \\( \\text{Aire} = 4,5 \\text{ m} \\times 3,2 \\text{ m} \\). Quel nombre ?')).toBe(
      'Pour une surface : Aire = 4,5 m × 3,2 m. Quel nombre ?',
    );
  });

  it('tableau Markdown', () => {
    const t = '| Volume (m³) | Ciment (kg) |\n|------------|------------|\n| 1 | 350 |\n| 2,4 | ? |\nQuelle opération ?';
    expect(plainText(t)).toBe('Volume (m³) — Ciment (kg)\n1 — 350\n2,4 — ?\nQuelle opération ?');
  });

  it('code entre accents graves et gras', () => {
    expect(plainText('**Rappel** : `volume = longueur × largeur × profondeur`')).toBe(
      'Rappel : volume = longueur × largeur × profondeur',
    );
  });

  it('émojis chiffres', () => {
    expect(plainText('1️⃣ **Première multiplication**\n2️⃣ Deuxième')).toBe('1. Première multiplication\n2. Deuxième');
  });

  it('fractions, racines, puissances et symboles', () => {
    expect(plainText('$$\\frac{0,9}{6} \\times 100$$')).toBe('0,9 ÷ 6 × 100');
    expect(plainText('\\( \\frac{a + b}{2} \\)')).toBe('(a + b) ÷ 2');
    expect(plainText('\\(\\sqrt{3^2 + 4^2}\\)')).toBe('√(3² + 4²)');
    expect(plainText('\\(12 \\text{ m}^2 \\approx 12,1\\)')).toBe('12 m² ≈ 12,1');
    expect(plainText('\\[ 15 \\% \\]')).toBe('15 %');
  });

  it('virgule décimale LaTeX dans une fraction : jamais deux nombres collés', () => {
    // Cas réel : « 121,44 » s'affichait au lieu de « 12 ÷ 1,44 ».
    expect(plainText('\\(\\frac{12}{1{,}44}\\) paquets')).toBe('12 ÷ 1,44 paquets');
    expect(plainText('\\(14{,}4 \\text{ m}^2\\)')).toBe('14,4 m²');
    expect(plainText('\\(\\frac{\\frac{1}{2}}{4}\\)')).toBe('(1 ÷ 2) ÷ 4');
  });

  it('titres et italique', () => {
    expect(plainText('## Indice 1\nUne *petite* piste')).toBe('Indice 1\nUne petite piste');
  });

  it('ne touche pas un texte déjà propre, ni les prix, ni les multiplications écrites avec ×', () => {
    const propre = 'Le devis fait 240 € (ou 240 $). Calcule 4,5 × 3,2 = ?\n- longueur\n- largeur';
    expect(plainText(propre)).toBe(propre);
    expect(plainText(plainText(propre))).toBe(propre);
  });

  it('multiplication écrite avec une étoile', () => {
    expect(plainText('Fais 45 * 32')).toBe('Fais 45 × 32');
  });

  it('s’applique en profondeur aux contenus générés', () => {
    const quiz = { titre: '**Quiz**', questions: [{ enonce: '\\( 5 \\times 2 \\)', choix: ['`10`'], n: 3 }] };
    expect(plainTextDeep(quiz)).toEqual({ titre: 'Quiz', questions: [{ enonce: '5 × 2', choix: ['10'], n: 3 }] });
  });
});
