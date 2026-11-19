import { describe, expect, it } from 'vitest';

import {
  generateNutrition,
  planPreparation,
  type NutritionInput,
  type NutritionProduct,
  type NutritionResult,
  type PreparationPlan,
} from '../src/index.js';

/**
 * « À préparer pour cette course » — NUTRITION_ENGINE §49 à §53, N22-N24,
 * N36, N37 ; décisions du 2026-11-19 : ce qui sert après un ravitaillement
 * vient de ce ravitaillement, la réserve part avec le coureur.
 */

const HOUR = 3600;

const GEL: NutritionProduct = {
  id: 'gel',
  name: 'Gel 25',
  category: 'gel',
  carbsG: 25,
  sodiumMg: 50,
  caffeineMg: 0,
  hydrationMl: 0,
};

const DRINK: NutritionProduct = {
  id: 'naak',
  name: 'Näak Ultra',
  category: 'drink',
  carbsG: 55,
  sodiumMg: 400,
  caffeineMg: 0,
  hydrationMl: 500,
};

function input(products: readonly NutritionProduct[] = [GEL, DRINK]): NutritionInput {
  return {
    timeline: {
      finishElapsedSeconds: 3 * HOUR,
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
          id: 'r1',
          name: 'Ravito 1',
          kind: 'aid',
          elapsedSeconds: HOUR,
          stopSeconds: 0,
          distanceKm: 10,
        },
        {
          id: 'r2',
          name: 'Ravito 2',
          kind: 'aid',
          elapsedSeconds: 2 * HOUR,
          stopSeconds: 0,
          distanceKm: 20,
        },
        {
          id: 'arrivee',
          name: 'Arrivée',
          kind: 'finish',
          elapsedSeconds: 3 * HOUR,
          stopSeconds: 0,
          distanceKm: 30,
        },
      ],
      terrain: [],
    },
    targets: {
      carbsGPerHour: 60,
      hydrationMlPerHour: 500,
      sodiumMgPerHour: 400,
      caffeineTotalMg: null,
      waterShare: 0.5,
    },
    placement: { mode: 'smart', density: 'auto', aidBuffer: false },
    containers: { flaskCount: 2, flaskCapacityMl: 500, bladderMl: null },
    products,
  };
}

/** Les gels placés par l'allocateur, prise par prise : la référence du compte. */
function gelsPlaced(result: NutritionResult): number {
  return Object.values(result.allocation?.items ?? {})
    .flat()
    .filter((item) => item.productId === 'gel')
    .reduce((sum, item) => sum + item.quantity, 0);
}

const product = (plan: PreparationPlan, id: string) =>
  plan.products.find((row) => row.productId === id);

describe('N36 — à préparer : la somme exacte des prises, réserve à part', () => {
  const result = generateNutrition(input());

  it('sans réserve, on prépare exactement ce que la stratégie prévoit', () => {
    const plan = planPreparation(result, { reservePercent: 0, sources: {} });
    const gel = product(plan, 'gel');
    expect(gelsPlaced(result)).toBeGreaterThan(0);
    expect(gel).toMatchObject({
      planned: gelsPlaced(result),
      reserve: 0,
      total: gelsPlaced(result),
    });
  });

  it('N23 — 10 % de réserve s’arrondit au gel entier supérieur', () => {
    const plan = planPreparation(result, { reservePercent: 10, sources: {} });
    const gel = product(plan, 'gel');
    expect(gel?.reserve).toBe(Math.ceil(gelsPlaced(result) * 0.1));
    expect(gel?.total).toBe(gelsPlaced(result) + (gel?.reserve ?? 0));
  });

  it('N24 — la réserve ne change rien à ce que la stratégie prévoit de consommer', () => {
    const before = result.allocation?.planned;
    planPreparation(result, { reservePercent: 20, sources: {} });
    expect(result.allocation?.planned).toEqual(before);
  });
});

describe('N37 — répartition : départ + sacs + Assistance + non affecté = total', () => {
  const result = generateNutrition(input());

  it('tient pour chaque produit, quelles que soient les sources', () => {
    const plan = planPreparation(result, {
      reservePercent: 10,
      sources: { r1: 'bag', r2: 'unassigned' },
    });
    for (const row of plan.products) {
      expect(row.start + row.bag + row.assistance + row.unassigned).toBeCloseTo(row.total);
    }
  });

  it('ce qui sert après un ravitaillement vient de lui ; la réserve part du départ', () => {
    const plan = planPreparation(result, {
      reservePercent: 10,
      sources: { r1: 'bag', r2: 'assistance' },
    });
    const at = (pointId: string) =>
      plan.points
        .find((point) => point.pointId === pointId)
        ?.items.filter((item) => item.productId === 'gel')
        .reduce((sum, item) => sum + item.quantity, 0) ?? 0;
    const gel = product(plan, 'gel');
    expect(plan.points.map((point) => `${point.pointId}:${point.source}`)).toEqual([
      'depart:start',
      'r1:bag',
      'r2:assistance',
    ]);
    expect(gel?.bag).toBe(at('r1'));
    expect(gel?.assistance).toBe(at('r2'));
    expect(gel?.start).toBe(at('depart') + (gel?.reserve ?? 0));
  });

  it('sans source donnée, tout part du départ', () => {
    const plan = planPreparation(result, { reservePercent: 0, sources: {} });
    for (const row of plan.products) {
      expect(row.start).toBe(row.total);
    }
  });
});

describe('boisson d’effort — des doses, là où la flasque se prépare', () => {
  it('les doses du départ vont dans les flasques ; celles d’un ravito suivent sa source', () => {
    const result = generateNutrition(input());
    const flasks = result.flasks;
    const plan = planPreparation(result, { reservePercent: 0, sources: { r2: 'bag' } });
    const drink = product(plan, 'naak');
    expect(drink?.unit).toBe('dose');
    expect(drink?.planned).toBe((flasks?.dosesAtStart ?? 0) + (flasks?.dosesToCarry ?? 0));
    expect(drink?.inFlasks).toBe(flasks?.dosesAtStart);
    // 250 ml par heure : la flasque tient jusqu'à Ravito 2, où elle se refait.
    expect(drink?.bag).toBe(1);
  });

  it('sans boisson choisie, aucune dose', () => {
    const plan = planPreparation(generateNutrition(input([GEL])), {
      reservePercent: 10,
      sources: {},
    });
    expect(plan.products.some((row) => row.unit === 'dose')).toBe(false);
  });
});

describe('déterminisme', () => {
  it('même entrée, même préparation', () => {
    const result = generateNutrition(input());
    const options = { reservePercent: 10, sources: { r1: 'assistance' as const } };
    expect(planPreparation(result, options)).toEqual(planPreparation(result, options));
  });
});
