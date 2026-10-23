import type { ContentType, Fiche, Flashcards, Quiz } from '@mathsuivi/shared';

/**
 * Contenu de démonstration pour le mode Mock (aucune clé d'API) :
 * réaliste, vérifié à la main, sur les aires et le carrelage.
 */
const FICHE: Fiche = {
  titre: 'Aire d’un rectangle',
  resume:
    'L’aire, c’est la surface à couvrir : carrelage, peinture, parquet. Pour un rectangle, on multiplie la longueur par la largeur. Le résultat est en mètres carrés (m²).',
  points_cles: [
    'Aire du rectangle = longueur × largeur.',
    'Les deux mesures doivent être dans la même unité (tout en m).',
    'Une aire s’écrit en m² : « mètres carrés ».',
    'Pour le carrelage, on ajoute 5 à 10 % pour les coupes.',
  ],
  formule: 'Aire (m²) = longueur (m) × largeur (m)',
  exemple_btp: {
    enonce: 'Un carreleur doit couvrir une pièce de 4,5 m sur 3,2 m. Quelle surface doit-il carreler ?',
    etapes: ['Je repère les mesures : longueur 4,5 m, largeur 3,2 m.', 'Je multiplie : 4,5 × 3,2 = 14,4.'],
    resultat: '14,4 m²',
  },
  erreurs_frequentes: [
    'Additionner au lieu de multiplier : 4,5 + 3,2 = 7,7 (c’est un demi-périmètre, pas une aire).',
    'Oublier l’unité, ou écrire m au lieu de m².',
    'Mélanger les unités : 450 cm × 3,2 m.',
  ],
  a_retenir: 'Une surface, c’est longueur × largeur, et ça s’écrit en m².',
};

const QUESTIONS: Quiz['questions'] = [
  {
    enonce: 'Une pièce mesure 4 m sur 3 m. Quelle est sa surface ?',
    choix: ['12 m²', '7 m²', '14 m²', '12 m'],
    bonne_reponse: 0,
    explication: 'On multiplie la longueur par la largeur : 4 × 3 = 12. Une surface s’écrit en m².',
  },
  {
    enonce: 'Un mur de 5 m de long et 2,5 m de haut doit être peint. Quelle surface faut-il peindre ?',
    choix: ['7,5 m²', '12,5 m²', '10 m²', '125 m²'],
    bonne_reponse: 1,
    explication: '5 × 2,5 = 12,5 m². Attention à la virgule : 125 m² serait dix fois trop.',
  },
  {
    enonce: '1 litre de peinture couvre 10 m². Combien de litres pour 12,5 m² ?',
    choix: ['12,5 L', '0,8 L', '1,25 L', '2,5 L'],
    bonne_reponse: 2,
    explication: 'On divise la surface par ce que couvre 1 litre : 12,5 ÷ 10 = 1,25 L.',
  },
  {
    enonce: 'Une pièce mesure 4,5 m sur 3,2 m. Quelle surface faut-il carreler ?',
    choix: ['7,7 m²', '15,4 m²', '144 m²', '14,4 m²'],
    bonne_reponse: 3,
    explication: '4,5 × 3,2 = 14,4 m². 7,7 m² vient d’une addition : il faut multiplier.',
  },
  {
    enonce: 'Les carreaux sont vendus par paquets de 1,44 m². Combien de paquets pour couvrir 12 m² ?',
    choix: ['9 paquets', '8 paquets', '10 paquets', '17 paquets'],
    bonne_reponse: 0,
    explication: '12 ÷ 1,44 ≈ 8,3. On ne peut pas acheter un bout de paquet : on arrondit au-dessus, 9 paquets.',
  },
  {
    enonce: '1 m², c’est combien de cm² ?',
    choix: ['100 cm²', '10 000 cm²', '1 000 cm²', '1 000 000 cm²'],
    bonne_reponse: 1,
    explication: '1 m = 100 cm, donc 1 m² = 100 cm × 100 cm = 10 000 cm².',
  },
  {
    enonce: 'On doit carreler 20 m² et on prévoit 10 % de chutes. Quelle surface commander ?',
    choix: ['20,1 m²', '30 m²', '22 m²', '21 m²'],
    bonne_reponse: 2,
    explication: '10 % de 20 m² = 2 m². On commande 20 + 2 = 22 m².',
  },
  {
    enonce: 'Une dalle de béton mesure 6 m sur 4 m, avec 0,1 m d’épaisseur. Quel volume de béton ?',
    choix: ['24 m³', '0,24 m³', '10,1 m³', '2,4 m³'],
    bonne_reponse: 3,
    explication: 'Volume = longueur × largeur × épaisseur : 6 × 4 × 0,1 = 2,4 m³.',
  },
];

const CARTES: Flashcards['cartes'] = [
  { recto: 'Comment calcule-t-on l’aire d’un rectangle ?', verso: 'Longueur × largeur. Le résultat est en m².' },
  { recto: '1 m², c’est combien de cm² ?', verso: '10 000 cm² (100 cm × 100 cm).' },
  { recto: 'Aire d’un carré de 3 m de côté ?', verso: '3 × 3 = 9 m².' },
  { recto: 'Comment calcule-t-on l’aire d’un triangle ?', verso: 'Base × hauteur ÷ 2.' },
  { recto: 'Une pièce de 5 m sur 4 m : quelle surface ?', verso: '5 × 4 = 20 m².' },
  { recto: 'Pourquoi commander plus de carrelage que la surface ?', verso: 'Pour les coupes et la casse : on prévoit 5 à 10 % de plus.' },
  { recto: '20 m² avec 10 % de chutes : combien commander ?', verso: '10 % de 20 = 2, donc 20 + 2 = 22 m².' },
  { recto: 'Comment calcule-t-on l’aire d’un disque ?', verso: 'π × rayon × rayon, avec π ≈ 3,14.' },
  { recto: 'Comment calcule-t-on le volume d’une dalle ?', verso: 'Longueur × largeur × épaisseur, en m³.' },
  { recto: 'Dalle de 5 m × 4 m, épaisse de 0,1 m : quel volume ?', verso: '5 × 4 × 0,1 = 2 m³.' },
];

export function demoContent(type: ContentType, nombre: number) {
  if (type === 'fiche') return structuredClone(FICHE);
  if (type === 'quiz') return { titre: 'Quiz : aires et surfaces', questions: structuredClone(QUESTIONS.slice(0, nombre)) };
  return { titre: 'Cartes : aires et volumes', cartes: structuredClone(CARTES.slice(0, nombre)) };
}
