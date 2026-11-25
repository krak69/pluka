import { describe, expect, it } from 'vitest';

import {
  generateNutrition,
  reviewCustomizations,
  type CustomizedMilestone,
  type NutritionInput,
  type NutritionMilestone,
  type NutritionProduct,
  type NutritionTimelinePoint,
} from '../src/index.js';

/**
 * Le Plan change : les prises modifiées par le coureur — NUTRITION_ENGINE
 * §61, §63 à §65, N25 à N28 ; décisions du 2026-11-23.
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

function point(
  id: string,
  kind: NutritionTimelinePoint['kind'],
  elapsedSeconds: number,
  distanceKm: number,
): NutritionTimelinePoint {
  return { id, name: id, kind, elapsedSeconds, stopSeconds: 0, distanceKm };
}

/** 30 km, deux ravitaillements aux tiers ; `hours` règle l'allure. */
function input(hours: number, points?: readonly NutritionTimelinePoint[]): NutritionInput {
  const total = hours * HOUR;
  const timeline = points ?? [
    point('depart', 'start', 0, 0),
    point('r1', 'aid', total / 3, 10),
    point('r2', 'aid', (2 * total) / 3, 20),
    point('arrivee', 'finish', total, 30),
  ];
  return {
    timeline: {
      finishElapsedSeconds: timeline.at(-1)?.elapsedSeconds ?? 0,
      points: timeline,
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
    products: [GEL],
  };
}

function firstIntake(milestones: readonly NutritionMilestone[]): NutritionMilestone {
  const intake = milestones.find((milestone) => milestone.kind === 'intake');
  if (intake === undefined) throw new Error('aucune prise');
  return intake;
}

/**
 * La première prise après le premier ravitaillement. Les prises se placent au
 * temps écoulé depuis le dernier point : avant `r1`, une allure plus lente ne
 * change que leur kilomètre ; après, elles suivent l'heure d'arrivée à `r1`.
 */
function intakeAfterR1(milestones: readonly NutritionMilestone[]): NutritionMilestone {
  const intake = milestones.find((milestone) => milestone.stableKey === 'intake:r1:1');
  if (intake === undefined) throw new Error('aucune prise après r1');
  return intake;
}

/** La prise telle que le coureur l'a validée, sur l'ancien Plan. */
function customized(milestone: NutritionMilestone): CustomizedMilestone {
  return {
    stableKey: milestone.stableKey,
    elapsedSeconds: milestone.elapsedSeconds,
    distanceKm: milestone.distanceKm,
  };
}

describe('une prise modifiée qui garde sa place', () => {
  it('N25 — son heure a bougé avec le Plan : le diff le dit, avant et après', () => {
    const before = intakeAfterR1(generateNutrition(input(3)).milestones);
    const after = generateNutrition(input(4)).milestones;

    const review = reviewCustomizations([customized(before)], after);

    const moved = intakeAfterR1(after);
    expect(moved.elapsedSeconds - before.elapsedSeconds).toBe(1200);
    expect(review.kept).toEqual([
      {
        stableKey: before.stableKey,
        before: { elapsedSeconds: before.elapsedSeconds, distanceKm: before.distanceKm },
        after: { elapsedSeconds: moved.elapsedSeconds, distanceKm: moved.distanceKm },
        shifted: true,
      },
    ]);
    expect(review.orphaned).toEqual([]);
    expect(review.warnings).toEqual([]);
  });

  it('une allure plus lente avant le premier ravito ne change que le kilomètre : rien à signaler', () => {
    const before = firstIntake(generateNutrition(input(3)).milestones);
    const after = generateNutrition(input(4)).milestones;

    const review = reviewCustomizations([customized(before)], after);

    expect(review.kept.map((kept) => [kept.shifted, kept.after.elapsedSeconds])).toEqual([
      [false, before.elapsedSeconds],
    ]);
    expect(review.kept[0]?.after.distanceKm).toBeLessThan(before.distanceKm);
  });

  it('N26 — reste à sa clé, avec ses produits : aucun déplacement silencieux', () => {
    const key = intakeAfterR1(generateNutrition(input(3)).milestones).stableKey;
    const after = generateNutrition({
      ...input(4),
      customItems: { [key]: [{ ...GEL, quantity: 2 }] },
    });

    expect(after.allocation?.items[key]).toEqual([
      { productId: 'gel', name: 'Gel 25', quantity: 2, carbsG: 50, sodiumMg: 100, caffeineMg: 0 },
    ]);
    expect(after.allocation?.customized).toEqual([key]);
  });

  it('à moins d’une minute près, l’heure lue ne change pas : rien à signaler', () => {
    const milestones = generateNutrition(input(3)).milestones;
    const intake = firstIntake(milestones);

    const review = reviewCustomizations(
      [{ ...customized(intake), elapsedSeconds: intake.elapsedSeconds - 59 }],
      milestones,
    );

    expect(review.kept.map((kept) => kept.shifted)).toEqual([false]);
  });

  it('un ravitaillement modifié se retrouve par son point officiel', () => {
    const milestones = generateNutrition(input(4)).milestones;

    const review = reviewCustomizations(
      [{ stableKey: 'aid:r1', elapsedSeconds: HOUR, distanceKm: 10 }],
      milestones,
    );

    expect(review.kept.map((kept) => [kept.stableKey, kept.after.elapsedSeconds])).toEqual([
      ['aid:r1', (4 * HOUR) / 3],
    ]);
  });
});

describe('une prise modifiée qui n’a plus de place', () => {
  it('N27 — la prise n’existe plus : PRODUCT_REASSIGNMENT_REQUIRED, et elle est gardée', () => {
    const milestones = generateNutrition(input(3)).milestones;
    const gone: CustomizedMilestone = {
      stableKey: 'intake:depart:9',
      elapsedSeconds: 2400,
      distanceKm: 6.7,
    };

    const review = reviewCustomizations([gone], milestones);

    expect(review.orphaned).toEqual([gone]);
    expect(review.kept).toEqual([]);
    expect(review.warnings).toEqual(['PRODUCT_REASSIGNMENT_REQUIRED']);
  });

  it('N28 — la course raccourcie : ses prises au-delà de la nouvelle arrivée sont à replacer', () => {
    const full = generateNutrition(input(3)).milestones;
    const lastLeg = full.filter(
      (milestone) =>
        milestone.stableKey.startsWith('intake:r2:') || milestone.stableKey === 'aid:r2',
    );
    expect(lastLeg.length).toBeGreaterThan(1);

    const shortened = generateNutrition(
      input(2, [
        point('depart', 'start', 0, 0),
        point('r1', 'aid', HOUR, 10),
        point('r2', 'finish', 2 * HOUR, 20),
      ]),
    ).milestones;
    const review = reviewCustomizations(lastLeg.map(customized), shortened);

    expect(review.orphaned.map((custom) => custom.stableKey)).toEqual(
      lastLeg.map((milestone) => milestone.stableKey),
    );
    expect(review.warnings).toEqual(['PRODUCT_REASSIGNMENT_REQUIRED']);
  });

  it('l’arrivée n’accueille jamais une prise modifiée', () => {
    const milestones = generateNutrition(input(3)).milestones;

    const review = reviewCustomizations(
      [{ stableKey: 'finish:arrivee', elapsedSeconds: 3 * HOUR, distanceKm: 30 }],
      milestones,
    );

    expect(review.orphaned.map((custom) => custom.stableKey)).toEqual(['finish:arrivee']);
  });
});

describe('déterminisme (§87)', () => {
  it('même entrée, même revue, dans l’ordre de la course', () => {
    const milestones = generateNutrition(input(4)).milestones;
    const customs: CustomizedMilestone[] = [
      { stableKey: 'intake:depart:9', elapsedSeconds: 5000, distanceKm: 12 },
      { stableKey: 'aid:r2', elapsedSeconds: 7200, distanceKm: 20 },
      { stableKey: 'aid:r1', elapsedSeconds: 3600, distanceKm: 10 },
      { stableKey: 'intake:r1:7', elapsedSeconds: 4000, distanceKm: 11 },
    ];

    const first = reviewCustomizations(customs, milestones);
    const second = reviewCustomizations([...customs].reverse(), milestones);

    expect(second).toEqual(first);
    expect(first.kept.map((kept) => kept.stableKey)).toEqual(['aid:r1', 'aid:r2']);
    expect(first.orphaned.map((custom) => custom.stableKey)).toEqual([
      'intake:r1:7',
      'intake:depart:9',
    ]);
  });
});
