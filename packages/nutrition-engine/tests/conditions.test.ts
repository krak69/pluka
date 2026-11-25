import { describe, expect, it } from 'vitest';

import {
  generateNutrition,
  NUTRITION_ENGINE_V1,
  proposeConditionTargets,
  type NutritionConditionRange,
  type NutritionInput,
  type NutritionProduct,
  type NutritionResult,
} from '../src/index.js';

/**
 * Temps chaud, froid, nuit — NUTRITION_ENGINE §13 à §19, §24, §25, N01 à N08 ;
 * propositions PLUKA §14 bis (décisions du 2026-11-24).
 */

const HOUR = 3600;
const PROPOSALS = NUTRITION_ENGINE_V1.conditions;

const GEL: NutritionProduct = {
  id: 'gel',
  name: 'Gel 25',
  category: 'gel',
  carbsG: 25,
  sodiumMg: 50,
  caffeineMg: 0,
  hydrationMl: 0,
};

const CAFFEINE_GEL: NutritionProduct = {
  ...GEL,
  id: 'gel-caf',
  name: 'Gel caféiné',
  caffeineMg: 50,
};

/** 12 h, un ravito à 6 h ; cibles 60 g · 500 ml · 400 mg par heure. */
function input(patch: Partial<NutritionInput> = {}): NutritionInput {
  return {
    timeline: {
      finishElapsedSeconds: 12 * HOUR,
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
          name: 'Ravito',
          kind: 'aid',
          elapsedSeconds: 6 * HOUR,
          stopSeconds: 0,
          distanceKm: 40,
        },
        {
          id: 'arrivee',
          name: 'Arrivée',
          kind: 'finish',
          elapsedSeconds: 12 * HOUR,
          stopSeconds: 0,
          distanceKm: 80,
        },
      ],
      terrain: [],
    },
    targets: {
      carbsGPerHour: 60,
      hydrationMlPerHour: 500,
      sodiumMgPerHour: 400,
      caffeineTotalMg: null,
      waterShare: 1,
    },
    placement: { mode: 'smart', density: 'auto', aidBuffer: false },
    ...patch,
  };
}

const range = (
  kind: NutritionConditionRange['kind'],
  fromHours: number,
  toHours: number,
): NutritionConditionRange => ({
  kind,
  startElapsedSeconds: fromHours * HOUR,
  endElapsedSeconds: toHours * HOUR,
});

describe('propositions PLUKA (§14 bis)', () => {
  const base = { carbsGPerHour: 60, hydrationMlPerHour: 500, sodiumMgPerHour: 400 };

  it('chaud : plus d’eau, le sodium à la même concentration, les glucides inchangés', () => {
    expect(proposeConditionTargets('hot', base, PROPOSALS)).toEqual({
      carbsGPerHour: 60,
      hydrationMlPerHour: 625,
      sodiumMgPerHour: 500,
    });
  });

  it('chaud : l’eau ne dépasse pas 750 ml/h, sans jamais descendre sous la base', () => {
    expect(
      proposeConditionTargets('hot', { ...base, hydrationMlPerHour: 700 }, PROPOSALS)
        .hydrationMlPerHour,
    ).toBe(750);
    expect(
      proposeConditionTargets('hot', { ...base, hydrationMlPerHour: 800 }, PROPOSALS)
        .hydrationMlPerHour,
    ).toBe(800);
  });

  it('chaud : au moins 300 mg/h de sodium, jamais plus de 1000 mg par litre ni moins que la base', () => {
    // 100 mg/h à 500 ml/h : la même concentration donnerait 125 mg/h.
    expect(
      proposeConditionTargets('hot', { ...base, sodiumMgPerHour: 100 }, PROPOSALS).sodiumMgPerHour,
    ).toBe(300);
    // 1000 mg/L sur 500 ml/h plafonne à 500 mg/h, mais la base du coureur est de 800.
    expect(
      proposeConditionTargets(
        'hot',
        { carbsGPerHour: 60, hydrationMlPerHour: 400, sodiumMgPerHour: 800 },
        PROPOSALS,
      ).sodiumMgPerHour,
    ).toBe(800);
  });

  it('froid : un peu moins d’eau, le sodium à la même concentration, un peu plus de glucides', () => {
    expect(
      proposeConditionTargets('cold', { ...base, hydrationMlPerHour: 600 }, PROPOSALS),
    ).toEqual({ carbsGPerHour: 65, hydrationMlPerHour: 510, sodiumMgPerHour: 340 });
  });

  it('froid : l’eau ne passe pas sous 450 ml/h, ni au-dessus de la base', () => {
    expect(proposeConditionTargets('cold', base, PROPOSALS).hydrationMlPerHour).toBe(450);
    expect(
      proposeConditionTargets('cold', { ...base, hydrationMlPerHour: 400 }, PROPOSALS)
        .hydrationMlPerHour,
    ).toBe(400);
  });

  it('une valeur fixée par le coureur l’emporte, les autres suivent la proposition', () => {
    const result = generateNutrition(
      input({
        conditions: {
          hot: { carbsGPerHour: 70, hydrationMlPerHour: null, sodiumMgPerHour: null },
          ranges: [],
        },
      }),
    );

    expect(result.conditions.hot.targets).toEqual({
      carbsGPerHour: 70,
      hydrationMlPerHour: 625,
      sodiumMgPerHour: 500,
    });
    expect(result.conditions.hot.custom).toEqual({ carbs: true, hydration: false, sodium: false });
  });
});

describe('besoins avec des plages (§11, §14, §18)', () => {
  it('N01 — sans condition, la cible est constante', () => {
    const result = generateNutrition(input());

    expect(result.totals).toMatchObject({ carbsG: 720, hydrationMl: 6000, sodiumMg: 4800 });
    expect(result.conditions.warnings).toEqual([]);
  });

  it('N02 — une plage chaude : seules ses dimensions changent, et seulement sur sa durée', () => {
    // 04:10 → 10:40 : 6 h 30 de chaud sur 12 h.
    const result = generateNutrition(
      input({ conditions: { ranges: [range('hot', 4 + 10 / 60, 10 + 40 / 60)] } }),
    );

    expect(result.totals.carbsG).toBeCloseTo(720, 9);
    expect(result.totals.hydrationMl).toBeCloseTo(500 * 5.5 + 625 * 6.5, 9);
    expect(result.totals.sodiumMg).toBeCloseTo(400 * 5.5 + 500 * 6.5, 9);
  });

  it('N03 — une plage au milieu d’une section : le besoin se partage au prorata exact', () => {
    const result = generateNutrition(input({ conditions: { ranges: [range('hot', 2, 4)] } }));
    const [first] = result.sections;

    expect(first?.needs.hydrationMl).toBeCloseTo(500 * 4 + 625 * 2, 9);
    expect(first?.startElapsedSeconds).toBe(0);
    expect(first?.endElapsedSeconds).toBe(6 * HOUR);
  });

  it('N04 — nuit et froid : le froid agit sur ses cibles, la nuit sur aucune', () => {
    const cold = generateNutrition(input({ conditions: { ranges: [range('cold', 0, 3)] } }));
    const both = generateNutrition(
      input({ conditions: { ranges: [range('cold', 0, 3), range('night', 0, 5)] } }),
    );

    expect(both.totals).toEqual(cold.totals);
    expect(cold.totals.carbsG).toBeCloseTo(60 * 9 + 65 * 3, 9);
  });

  it('N05 — chaud et froid en même temps : signalé, et la base s’applique sur le chevauchement', () => {
    const result = generateNutrition(
      input({ conditions: { ranges: [range('hot', 1, 3), range('cold', 2, 4)] } }),
    );

    expect(result.conditions.warnings).toContain('hot_cold_overlap');
    expect(result.totals.hydrationMl).toBeCloseTo(500 * 10 + 625 * 1 + 450 * 1, 9);
  });

  it('§19 — une plage qui déborde est ramenée à la course ; une plage hors course est ignorée', () => {
    const result = generateNutrition(
      input({ conditions: { ranges: [range('hot', 11, 14), range('cold', 13, 15)] } }),
    );

    expect(result.conditions.warnings).toEqual(['range_outside', 'range_truncated']);
    expect(result.conditions.ranges).toEqual([range('hot', 11, 12)]);
    expect(result.totals.hydrationMl).toBeCloseTo(500 * 11 + 625, 9);
  });

  it('plus de besoin, plus de prises : le chaud ne change pas les glucides, le froid si', () => {
    const plain = generateNutrition(input({ products: [GEL] }));
    const cold = generateNutrition(
      input({ products: [GEL], conditions: { ranges: [range('cold', 0, 12)] } }),
    );
    const intakes = (result: NutritionResult) =>
      result.milestones.filter((milestone) => milestone.kind === 'intake').length;

    expect(intakes(cold)).toBeGreaterThan(intakes(plain));
  });

  it('les flasques suivent l’hydratation de la plage', () => {
    const containers = { flaskCount: 2, flaskCapacityMl: 500, bladderMl: null };
    const plain = generateNutrition(input({ containers }));
    const hot = generateNutrition(
      input({ containers, conditions: { ranges: [range('hot', 0, 6)] } }),
    );

    // Départ → ravito : 6 h, dont 6 h de chaud à 625 ml/h au lieu de 500.
    expect(plain.flasks?.stops[0]?.waterNeedMl).toBeCloseTo(3000, 9);
    expect(hot.flasks?.stops[0]?.waterNeedMl).toBeCloseTo(3750, 9);
    expect(hot.flasks?.stops[1]?.waterNeedMl).toBeCloseTo(3000, 9);
  });
});

/** Les prises qui portent de la caféine, par heure de passage. */
function caffeineHours(result: NutritionResult): number[] {
  return result.milestones
    .filter((milestone) =>
      (result.allocation?.items[milestone.stableKey] ?? []).some((item) => item.caffeineMg > 0),
    )
    .map((milestone) => milestone.elapsedSeconds / HOUR);
}

describe('caféine (§24, §25, N06 à N08)', () => {
  const caffeinated = (patch: Partial<NutritionInput> = {}) =>
    input({
      products: [GEL, CAFFEINE_GEL],
      targets: { ...input().targets, caffeineTotalMg: 200 },
      ...patch,
    });

  it('N06 — sur les plages Nuit seulement, sans dépasser le total', () => {
    const result = generateNutrition(
      caffeinated({ caffeineSpread: 'night', conditions: { ranges: [range('night', 8, 12)] } }),
    );

    expect(caffeineHours(result).length).toBeGreaterThan(0);
    expect(caffeineHours(result).every((hour) => hour >= 8)).toBe(true);
    expect(result.allocation?.planned.caffeineMg).toBeLessThanOrEqual(200);
  });

  it('deuxième partie : rien avant la mi-course', () => {
    const result = generateNutrition(caffeinated({ caffeineSpread: 'late' }));

    expect(caffeineHours(result).length).toBeGreaterThan(0);
    expect(caffeineHours(result).every((hour) => hour >= 6)).toBe(true);
  });

  it('période nocturne sans plage Nuit : la deuxième partie, et c’est signalé', () => {
    const night = generateNutrition(caffeinated({ caffeineSpread: 'night' }));
    const late = generateNutrition(caffeinated({ caffeineSpread: 'late' }));

    expect(night.conditions.warnings).toContain('caffeine_night_without_range');
    expect(caffeineHours(night)).toEqual(caffeineHours(late));
  });

  it('manuel : PLUKA ne place aucune caféine, le coureur la pose lui-même', () => {
    const result = generateNutrition(caffeinated({ caffeineSpread: 'manual' }));

    expect(caffeineHours(result)).toEqual([]);
    expect(result.allocation?.planned.caffeineMg).toBe(0);
  });

  it('N07 — sans objectif de caféine, aucune caféine placée', () => {
    const result = generateNutrition(
      input({ products: [GEL, CAFFEINE_GEL], caffeineSpread: 'night' }),
    );

    expect(caffeineHours(result)).toEqual([]);
  });

  it('N08 — une plage Nuit en répartition automatique ne change rien', () => {
    const plain = generateNutrition(caffeinated());
    const withNight = generateNutrition(
      caffeinated({ conditions: { ranges: [range('night', 8, 12)] } }),
    );

    expect(withNight.allocation).toEqual(plain.allocation);
    expect(withNight.totals).toEqual(plain.totals);
  });
});

describe('déterminisme (§87)', () => {
  it('même entrée, même résultat ; une plage de plus change l’empreinte', () => {
    const conditions = { ranges: [range('hot', 2, 5), range('night', 8, 12)] };
    const first = generateNutrition(input({ conditions }));
    const second = generateNutrition(input({ conditions }));
    const other = generateNutrition(input({ conditions: { ranges: [range('hot', 2, 6)] } }));

    expect(second).toEqual(first);
    expect(other.inputHash).not.toBe(first.inputHash);
  });
});
