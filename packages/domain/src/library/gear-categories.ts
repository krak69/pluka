/**
 * Catégories de « Mon matériel » — migration 0093 ; décisions produit du
 * 2026-11-13 : une liste fixe, et une catégorie devinée à l'ajout par
 * mots-clés (pas d'IA), que le coureur corrige.
 *
 * Fonction pure et déterministe : même intitulé, même catégorie.
 */

export const GEAR_CATEGORIES = [
  'clothing',
  'lighting',
  'safety',
  'hydration',
  'nutrition',
  'carrying',
  'electronics',
  'care',
  'other',
] as const;

export type GearCategory = (typeof GEAR_CATEGORIES)[number];

/**
 * Mots-clés par catégorie, sans accents ni majuscules. L'ordre compte : la
 * première catégorie qui reconnaît l'intitulé l'emporte — « couverture de
 * survie » est de la sécurité avant d'être un vêtement, « sac à eau » de
 * l'hydratation avant d'être du portage, « gel anti-frottement » un soin avant
 * d'être de la nutrition.
 */
const KEYWORDS: readonly (readonly [GearCategory, readonly string[]])[] = [
  [
    'safety',
    [
      'survie',
      'sifflet',
      'bande elastique',
      'bande adhesive',
      'secours',
      'pharmacie',
      'strap',
      'boussole',
      'carte ign',
    ],
  ],
  ['lighting', ['frontale', 'lampe', 'pile', 'eclairage', 'lumen', 'feu rouge', 'feu arriere']],
  [
    'hydration',
    ['flasque', 'gourde', 'poche a eau', 'bidon', 'gobelet', 'eau', 'filtre', 'softflask', 'tasse'],
  ],
  [
    'care',
    [
      'creme',
      'solaire',
      'anti-frottement',
      'antifrottement',
      'vaseline',
      'nok',
      'lingette',
      'mouchoir',
      'pansement',
      'compeed',
      'papier toilette',
      'brosse',
    ],
  ],
  [
    'nutrition',
    [
      'gel',
      'barre',
      'compote',
      'pate de fruit',
      'boisson',
      'sel',
      'pastille',
      'ravito',
      'alimentaire',
      'nourriture',
      'bonbon',
      'cafeine',
    ],
  ],
  [
    'electronics',
    ['telephone', 'portable', 'montre', 'gps', 'batterie', 'cable', 'chargeur', 'ecouteur'],
  ],
  [
    'carrying',
    ['sac', 'gilet', 'baton', 'ceinture', 'porte-dossard', 'porte dossard', 'poche', 'housse'],
  ],
  [
    'clothing',
    [
      'veste',
      'coupe-vent',
      'coupe vent',
      'gant',
      'bonnet',
      'buff',
      'tour de cou',
      'collant',
      'short',
      't-shirt',
      'tee-shirt',
      'maillot',
      'chaussette',
      'chaussure',
      'casquette',
      'visiere',
      'manchette',
      'pantalon',
      'polaire',
      'doudoune',
      'couche',
      'poncho',
      'guetre',
      'lunette',
      'cuissard',
      'brassiere',
      'sous-vetement',
      'gaine',
    ],
  ],
];

function normalize(label: string): string {
  return label
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

/** La catégorie devinée d'un intitulé, « other » (Divers) à défaut. */
export function guessGearCategory(label: string): GearCategory {
  const text = normalize(label);
  for (const [category, words] of KEYWORDS) {
    if (words.some((word) => new RegExp(`(^|[^a-z])${word}`, 'u').test(text))) {
      return category;
    }
  }
  return 'other';
}

/**
 * Un tag propre : minuscules, espaces réduits, 30 caractères au plus — la
 * forme que la base exige (0093). Vide si rien ne reste.
 */
export function cleanTag(raw: string): string {
  return raw.trim().replace(/^#/u, '').replace(/\s+/gu, ' ').toLocaleLowerCase('fr').slice(0, 30);
}

/** Des tags propres, sans vides ni doublons, 10 au plus. */
export function cleanTags(list: readonly string[]): string[] {
  return [...new Set(list.map(cleanTag).filter((tag) => tag !== ''))].slice(0, 10);
}
