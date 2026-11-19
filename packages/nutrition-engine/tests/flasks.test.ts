import { describe, expect, it } from 'vitest';

import {
  generateNutrition,
  planFlasks,
  type NutritionContainers,
  type NutritionInput,
  type NutritionProduct,
} from '../src/index.js';

/**
 * Gestion des flasques — NUTRITION_ENGINE §33, §34 ; décisions du 2026-11-19 :
 * la boisson se prépare en flasque pleine (« 500 ml + 1 dose »), et une flasque
 * qui suffit jusqu'au point suivant ne se touche pas.
 */

const HOUR = 3600;

const DRINK: NutritionProduct = {
  id: 'naak',
  name: 'Näak Ultra',
  category: 'drink',
  carbsG: 55,
  sodiumMg: 400,
  caffeineMg: 0,
  hydrationMl: 500,
};

const TWO_FLASKS: NutritionContainers = { flaskCount: 2, flaskCapacityMl: 500, bladderMl: null };

function input(
  options: {
    hours?: readonly number[];
    hydration?: number;
    waterShare?: number;
    products?: readonly NutritionProduct[];
  } = {},
): NutritionInput {
  const hours = options.hours ?? [1, 2, 3];
  const finish = hours[hours.length - 1] ?? 1;
  return {
    timeline: {
      finishElapsedSeconds: finish * HOUR,
      points: [
        {
          id: 'depart',
          name: 'Départ',
          kind: 'start',
          elapsedSeconds: 0,
          stopSeconds: 0,
          distanceKm: 0,
        },
        ...hours.slice(0, -1).map((hour, index) => ({
          id: `ravito-${String(index + 1)}`,
          name: `Ravito ${String(index + 1)}`,
          kind: 'aid' as const,
          elapsedSeconds: hour * HOUR,
          stopSeconds: 0,
          distanceKm: hour * 10,
        })),
        {
          id: 'arrivee',
          name: 'Arrivée',
          kind: 'finish',
          elapsedSeconds: finish * HOUR,
          stopSeconds: 0,
          distanceKm: finish * 10,
        },
      ],
      terrain: [],
    },
    targets: {
      carbsGPerHour: 60,
      hydrationMlPerHour: options.hydration ?? 500,
      sodiumMgPerHour: 400,
      caffeineTotalMg: null,
      waterShare: options.waterShare ?? 0.5,
    },
    placement: { mode: 'smart', density: 'auto', aidBuffer: false },
    products: options.products ?? [DRINK],
  };
}

const kinds = (plan: ReturnType<typeof planFlasks>, stop: number) =>
  plan.stops[stop]?.actions.map((action) => `${action.containerId}:${action.kind}`);

describe('boisson d’effort — flasque pleine, doses entières', () => {
  it('250 ml par section : une préparation au départ, on n’y touche pas au ravito', () => {
    const plan = planFlasks(input(), TWO_FLASKS);
    expect(plan.drink).toMatchObject({ prepVolumeMl: 500, prepDoses: 1 });
    expect(plan.containers.map((container) => `${container.id}:${container.role}`)).toEqual([
      'flask:1:water',
      'flask:2:drink',
    ]);
    expect(kinds(plan, 0)).toEqual(['flask:1:fill_water', 'flask:2:prepare_drink']);
    expect(plan.stops[1]?.actions[1]).toMatchObject({ kind: 'keep', remainingMl: 250 });
    // Au 2e ravito, la flasque est vide : on la refait, avec une dose emportée.
    expect(plan.stops[2]?.actions[1]).toMatchObject({ kind: 'prepare_drink', doses: 1 });
    expect(plan.dosesAtStart).toBe(1);
    expect(plan.dosesToCarry).toBe(1);
  });

  it('il manque d’un rien : on garde la flasque et on complète à l’eau', () => {
    // 260 ml de boisson par heure : 500 − 260 = 240 restants pour 260 à boire.
    const plan = planFlasks(input({ hydration: 520 }), TWO_FLASKS);
    expect(plan.stops[1]?.actions[1]).toMatchObject({ kind: 'keep' });
    expect(plan.stops[1]?.drinkTopUpWithWaterMl).toBeCloseTo(20);
  });

  it('il manque trop : on finit la flasque au ravito, puis on la refait', () => {
    // Une heure puis deux heures : 200 ml, puis 400 ml de boisson.
    const plan = planFlasks(input({ hours: [1, 3], hydration: 400 }), {
      flaskCount: 2,
      flaskCapacityMl: 500,
      bladderMl: null,
    });
    const action = plan.stops[1]?.actions[1];
    expect(action).toMatchObject({ kind: 'finish_then_prepare', remainingMl: 300, levelMl: 500 });
    expect(plan.stops[1]?.drinkHereMl).toBeCloseTo(300);
  });

  it('une flasque de 600 ml garde des doses entières : 500 ml + 1 dose', () => {
    const plan = planFlasks(input(), { flaskCount: 2, flaskCapacityMl: 600, bladderMl: null });
    expect(plan.drink).toMatchObject({ prepVolumeMl: 500, prepDoses: 1 });
  });

  it('sans boisson choisie, toute l’hydratation se compte en eau, et il le dit', () => {
    const plan = planFlasks(input({ products: [] }), TWO_FLASKS);
    expect(plan.drink).toBeNull();
    expect(plan.warnings).toContain('drink_counted_as_water');
    expect(plan.containers.every((container) => container.role === 'water')).toBe(true);
  });
});

describe('eau — au juste besoin, flasques d’abord', () => {
  it('complète l’eau à 50 ml près', () => {
    const plan = planFlasks(input({ hydration: 700, waterShare: 1 }), TWO_FLASKS);
    // 700 ml par heure : une flasque pleine, l'autre à 200 ml.
    expect(plan.stops[0]?.actions.map((action) => action.levelMl)).toEqual([500, 200]);
  });

  it('la poche prend le relais après les flasques', () => {
    const plan = planFlasks(input({ hours: [3], hydration: 600, waterShare: 1 }), {
      flaskCount: 2,
      flaskCapacityMl: 500,
      bladderMl: 1500,
    });
    expect(plan.stops[0]?.actions.map((action) => action.levelMl)).toEqual([500, 500, 800]);
  });
});

describe('capacité insuffisante — alerte et solution, cibles inchangées', () => {
  it('propose de boire avant de repartir, puis dit ce qui manque', () => {
    const plan = planFlasks(input({ hours: [1.5], hydration: 800, waterShare: 1 }), {
      flaskCount: 1,
      flaskCapacityMl: 500,
      bladderMl: null,
    });
    expect(plan.warnings).toContain('capacity_short');
    expect(plan.stops[0]?.drinkHereMl).toBeCloseTo(300);
    expect(plan.stops[0]?.shortfallMl).toBeCloseTo(400);
  });
});

describe('points de remplissage', () => {
  it('un ravito où le coureur ne remplit pas allonge le tronçon', () => {
    const plan = planFlasks(input({ hydration: 300, waterShare: 1 }), TWO_FLASKS, ['ravito-1']);
    expect(plan.stops.map((stop) => stop.name)).toEqual(['Départ', 'Ravito 2']);
    expect(plan.stops[0]?.untilName).toBe('Ravito 2');
    expect(plan.skippedPointIds).toEqual(['ravito-1']);
  });
});

describe('dans le moteur', () => {
  it('sans contenants, pas de plan de flasques ; avec, un plan déterministe', () => {
    expect(generateNutrition(input()).flasks).toBeNull();
    const withContainers = { ...input(), containers: TWO_FLASKS };
    expect(generateNutrition(withContainers).flasks).toEqual(
      generateNutrition(withContainers).flasks,
    );
    expect(generateNutrition(withContainers).flasks?.stops).toHaveLength(3);
  });
});
