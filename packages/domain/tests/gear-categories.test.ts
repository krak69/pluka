import { describe, expect, it } from 'vitest';

import { cleanTags, guessGearCategory } from '../src/index.js';

/**
 * Catégorie devinée par mots-clés — décisions produit du 2026-11-13. Les
 * intitulés viennent du prototype et des règlements de trail.
 */

describe('guessGearCategory', () => {
  it.each([
    ['Veste imperméable à capuche', 'clothing'],
    ['Lunettes catégorie 3', 'clothing'],
    ['Seconde couche chaude manches longues', 'clothing'],
    ['Lampe frontale + piles de rechange', 'lighting'],
    ['Couverture de survie 1,40 m × 2 m', 'safety'],
    ['Sifflet', 'safety'],
    ['Réserve d’eau 1 litre minimum', 'hydration'],
    ['Gobelet personnel 15 cl', 'hydration'],
    ['Gel anti-frottement', 'care'],
    ['Crème solaire', 'care'],
    ['Pastilles de sel', 'nutrition'],
    ['Réserve alimentaire personnelle', 'nutrition'],
    ['Batterie externe + câble', 'electronics'],
    ['Montre GPS chargée', 'electronics'],
    ['Bâtons pliants', 'carrying'],
    ['Petit sac déchets', 'carrying'],
    ['Porte-bonheur', 'other'],
  ] as const)('« %s » → %s', (label, category) => {
    expect(guessGearCategory(label)).toBe(category);
  });

  it('ne reconnaît pas un mot-clé au milieu d’un autre mot', () => {
    // « chapeau » contient « eau », mais n'est pas de l'hydratation.
    expect(guessGearCategory('Chapeau')).toBe('other');
  });

  it('est déterministe', () => {
    expect(guessGearCategory('Frontale')).toBe(guessGearCategory('frontale'));
  });
});

describe('cleanTags', () => {
  it('normalise, dédoublonne et borne', () => {
    expect(cleanTags([' Hiver ', '#nuit', 'hiver', '', 'Ultra  Trail'])).toEqual([
      'hiver',
      'nuit',
      'ultra trail',
    ]);
    expect(cleanTags(Array.from({ length: 12 }, (_, i) => `t${String(i)}`))).toHaveLength(10);
  });
});
