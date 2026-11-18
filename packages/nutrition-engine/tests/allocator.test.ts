import { describe, expect, it } from 'vitest';

import {
  generateNutrition,
  type NutritionInput,
  type NutritionProduct,
  type NutritionTerrainSpan,
} from '../src/index.js';

/**
 * Allocateur produit V1 — NUTRITION_ENGINE §26 à §31, §39 à §46.
 * Parcours : 4 h, un ravitaillement à 2 h ; 60 g/h, 500 ml/h, 400 mg/h.
 */

const MIN = 60;

const GEL: NutritionProduct = {
  id: 'gel',
  name: 'Gel 25',
  category: 'gel',
  carbsG: 25,
  sodiumMg: 50,
  caffeineMg: 0,
  hydrationMl: 0,
};
const BAR: NutritionProduct = {
  id: 'bar',
  name: 'Barre 40',
  category: 'bar',
  carbsG: 40,
  sodiumMg: 100,
  caffeineMg: 0,
  hydrationMl: 0,
};
const CAF: NutritionProduct = {
  id: 'caf',
  name: 'Gel caféiné',
  category: 'gel',
  carbsG: 25,
  sodiumMg: 50,
  caffeineMg: 75,
  hydrationMl: 0,
};
const DRINK: NutritionProduct = {
  id: 'drink',
  name: 'Boisson 40 g/500 ml',
  category: 'drink',
  carbsG: 40,
  sodiumMg: 250,
  caffeineMg: 0,
  hydrationMl: 500,
};
const SALT: NutritionProduct = {
  id: 'salt',
  name: 'Capsule sel',
  category: 'capsule',
  carbsG: 0,
  sodiumMg: 250,
  caffeineMg: 0,
  hydrationMl: 0,
};

function terrain(finish: number, km: number): NutritionTerrainSpan[] {
  const spans: NutritionTerrainSpan[] = [];
  for (let t = 0; t < finish; t += MIN) {
    spans.push({
      startElapsedSeconds: t,
      endElapsedSeconds: t + MIN,
      startKm: (km * t) / finish,
      endKm: (km * (t + MIN)) / finish,
      grade: 0,
    });
  }
  return spans;
}

function input(
  products: readonly NutritionProduct[] | undefined,
  overrides: Partial<NutritionInput['targets']> = {},
): NutritionInput {
  return {
    timeline: {
      finishElapsedSeconds: 240 * MIN,
      points: [
        {
          id: 'depart',
          name: 'Départ',
          kind: 'start',
          elapsedSeconds: 0,
          stopSeconds: 0,
          distanceKm: 0,
        },
        {
          id: 'ravito',
          name: 'Ravito',
          kind: 'aid',
          elapsedSeconds: 120 * MIN,
          stopSeconds: 0,
          distanceKm: 20,
        },
        {
          id: 'arrivee',
          name: 'Arrivée',
          kind: 'finish',
          elapsedSeconds: 240 * MIN,
          stopSeconds: 0,
          distanceKm: 40,
        },
      ],
      terrain: terrain(240 * MIN, 40),
    },
    targets: {
      carbsGPerHour: 60,
      hydrationMlPerHour: 500,
      sodiumMgPerHour: 400,
      caffeineTotalMg: null,
      waterShare: 1,
      ...overrides,
    },
    placement: { mode: 'smart', density: 'auto', aidBuffer: false },
    ...(products === undefined ? {} : { products }),
  };
}

const allItems = (products: readonly NutritionProduct[], overrides = {}) => {
  const allocation = generateNutrition(input(products, overrides)).allocation;
  return { allocation, items: Object.values(allocation?.items ?? {}).flat() };
};

describe('allocateur — produits choisis par le coureur (§27, §40)', () => {
  it('sans produits fournis, ne répartit rien', () => {
    expect(generateNutrition(input(undefined)).allocation).toBeNull();
  });

  it('sans aucun produit choisi, le dit et ne couvre rien', () => {
    const { allocation } = allItems([]);
    expect(allocation?.warnings).toContain('no_products');
    expect(allocation?.totalCoverage.carbs).toBe(0);
  });

  it('couvre les glucides au plus juste avec les seuls produits choisis', () => {
    const { allocation, items } = allItems([GEL, BAR]);

    expect(items.every((item) => ['gel', 'bar'].includes(item.productId))).toBe(true);
    // 240 g de besoin : la couverture reste raisonnable, ni très en dessous ni très au-dessus.
    expect(allocation?.totalCoverage.carbs).toBeGreaterThan(0.85);
    expect(allocation?.totalCoverage.carbs).toBeLessThan(1.25);
  });

  it('ne place aucun produit caféiné sans objectif caféine (§24)', () => {
    const { items } = allItems([CAF, GEL]);
    expect(items.some((item) => item.productId === 'caf')).toBe(false);
  });

  it('étale la caféine sans jamais dépasser le total fixé (§25)', () => {
    const { allocation } = allItems([CAF, GEL], { caffeineTotalMg: 150 });
    expect(allocation?.planned.caffeineMg).toBeGreaterThan(0);
    expect(allocation?.planned.caffeineMg).toBeLessThanOrEqual(150);
  });

  it('signale un objectif caféine sans produit caféiné', () => {
    expect(allItems([GEL], { caffeineTotalMg: 100 }).allocation?.warnings).toContain(
      'no_caffeine_product',
    );
  });

  it('compte la boisson d’effort sur toutes ses dimensions (§28, §29)', () => {
    // Tout en boisson : 500 ml/h à 80 g/L → 40 g/h ; les gels complètent.
    const { allocation } = allItems([DRINK, GEL], { waterShare: 0 });
    expect(allocation?.drink?.id).toBe('drink');
    expect(allocation?.totalCoverage.carbs).toBeGreaterThan(0.85);
    // Le sodium de la boisson compte : 250 mg / 500 ml × 500 ml/h = 250 mg/h.
    expect(allocation?.planned.sodiumMg).toBeGreaterThanOrEqual(250 * 4);
  });

  it('signale une part de boisson sans boisson choisie', () => {
    expect(allItems([GEL], { waterShare: 0.5 }).allocation?.warnings).toContain('no_drink');
  });

  it('complète le sodium avec une capsule quand il en manque', () => {
    const { items } = allItems([GEL, SALT]);
    expect(items.some((item) => item.productId === 'salt')).toBe(true);
  });

  it('donne une couverture par section', () => {
    const { allocation } = allItems([GEL, BAR]);
    expect(allocation?.sectionCoverage).toHaveLength(2);
  });

  it('reste déterministe', () => {
    expect(generateNutrition(input([GEL, BAR, SALT]))).toEqual(
      generateNutrition(input([GEL, BAR, SALT])),
    );
  });
});

describe('boisson en poudre', () => {
  it('sans volume de dilution, le dit plutôt que de deviner sa concentration', () => {
    const powder = { ...DRINK, hydrationMl: 0 };
    expect(allItems([powder, GEL], { waterShare: 0.5 }).allocation?.warnings).toContain(
      'drink_without_volume',
    );
  });
});
