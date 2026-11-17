import { describe, expect, it } from 'vitest';

import {
  generateNutrition,
  NUTRITION_ENGINE_V1,
  type NutritionInput,
  type NutritionTerrainSpan,
  type NutritionTimelinePoint,
} from '../src/index.js';

/**
 * Moteur Nutrition, tranche 1 — NUTRITION_ENGINE §11, §12, §35, §37, §87.
 *
 * Parcours de test : départ, ravito à 1 h 30 (arrêt 5 min), arrivée à 3 h 05.
 * Cibles : 60 g/h, 500 ml/h, 400 mg/h — les besoins se calculent à la main.
 */

const MIN = 60;
const HOUR = 3600;

function point(
  id: string,
  kind: NutritionTimelinePoint['kind'],
  elapsedSeconds: number,
  distanceKm: number,
  stopSeconds = 0,
): NutritionTimelinePoint {
  return { id, name: id, kind, elapsedSeconds, stopSeconds, distanceKm };
}

/** Terrain uniforme, découpé en tronçons d'une minute, à la pente donnée. */
function flatTerrain(finish: number, km: number, grade = 0): NutritionTerrainSpan[] {
  const spans: NutritionTerrainSpan[] = [];
  for (let t = 0; t < finish; t += MIN) {
    spans.push({
      startElapsedSeconds: t,
      endElapsedSeconds: Math.min(finish, t + MIN),
      startKm: (km * t) / finish,
      endKm: (km * Math.min(finish, t + MIN)) / finish,
      grade,
    });
  }
  return spans;
}

const POINTS = [
  point('depart', 'start', 0, 0),
  point('ravito', 'aid', 90 * MIN, 15, 5 * MIN),
  point('arrivee', 'finish', 185 * MIN, 30),
];

function input(overrides: Partial<NutritionInput> = {}): NutritionInput {
  return {
    timeline: {
      finishElapsedSeconds: 185 * MIN,
      points: POINTS,
      terrain: flatTerrain(185 * MIN, 30),
    },
    targets: {
      carbsGPerHour: 60,
      hydrationMlPerHour: 500,
      sodiumMgPerHour: 400,
      caffeineTotalMg: null,
      waterShare: 0.5,
    },
    placement: { mode: 'smart', density: 'auto', aidBuffer: false },
    ...overrides,
  };
}

describe('besoins — intégrés sur le temps (§11, §12)', () => {
  it('totalise les cibles du coureur sur la durée du Plan, sans les modifier', () => {
    const result = generateNutrition(input());

    expect(result.totals.carbsG).toBeCloseTo(185, 6);
    expect(result.totals.hydrationMl).toBeCloseTo((500 * 185) / 60, 6);
    expect(result.totals.sodiumMg).toBeCloseTo((400 * 185) / 60, 6);
    expect(result.totals.caffeineMg).toBeNull();
  });

  it('découpe en sections d’un ravito au suivant, qui totalisent la course', () => {
    const { sections, totals } = generateNutrition(input());

    expect(sections.map((section) => [section.fromName, section.toName])).toEqual([
      ['depart', 'ravito'],
      ['ravito', 'arrivee'],
    ]);
    expect(sections[0]?.needs.carbsG).toBeCloseTo(90, 6);
    // L'arrêt au ravito compte dans la section qui en repart.
    expect(sections[1]?.needs.carbsG).toBeCloseTo(95, 6);
    expect(sections.reduce((sum, section) => sum + section.needs.carbsG, 0)).toBeCloseTo(
      totals.carbsG,
      6,
    );
  });

  it('répartit l’hydratation entre eau et boisson selon le choix du coureur', () => {
    const [first] = generateNutrition(
      input({ targets: { ...input().targets, waterShare: 0.25 } }),
    ).sections;

    expect(first?.waterMl).toBeCloseTo(750 * 0.25, 6);
    expect(first?.drinkMl).toBeCloseTo(750 * 0.75, 6);
  });
});

describe('prises Smart (§35)', () => {
  it('place autant de prises que le temps et le besoin l’exigent', () => {
    // 90 min, 60 g/h : 90 g à 40 g la prise → 2 prises ; 45 min d'écart → 1. On garde 2.
    const intakes = generateNutrition(input()).milestones.filter(
      (milestone) => milestone.kind === 'intake',
    );

    expect(intakes.filter((milestone) => milestone.elapsedSeconds < 90 * MIN)).toHaveLength(2);
  });

  it('suit la densité choisie', () => {
    // 4 h sans ravitaillement, 60 g/h : fréquent (30 min / 30 g) → 7, auto (45 / 40) → 5,
    // espacé (60 / 50) → 4.
    const longLeg = {
      finishElapsedSeconds: 240 * MIN,
      points: [point('depart', 'start', 0, 0), point('arrivee', 'finish', 240 * MIN, 40)],
      terrain: flatTerrain(240 * MIN, 40),
    };
    const count = (density: 'frequent' | 'auto' | 'sparse') =>
      generateNutrition(
        input({ timeline: longLeg, placement: { mode: 'smart', density, aidBuffer: false } }),
      ).milestones.filter((milestone) => milestone.kind === 'intake').length;

    expect([count('frequent'), count('auto'), count('sparse')]).toEqual([7, 5, 4]);
  });

  it('sans glucides, se règle sur le temps seul : la cible n’est jamais inventée', () => {
    const result = generateNutrition(input({ targets: { ...input().targets, carbsGPerHour: 0 } }));

    expect(result.totals.carbsG).toBe(0);
    // 90 min / 45 min → une prise par section.
    expect(result.milestones.filter((milestone) => milestone.kind === 'intake')).toHaveLength(2);
  });

  it('glisse une prise de la descente raide vers la montée toute proche', () => {
    // Descente raide partout, sauf une montée de 4 min autour de 40 min.
    const terrain = flatTerrain(185 * MIN, 30, -0.15).map((span) =>
      span.startElapsedSeconds >= 38 * MIN && span.startElapsedSeconds < 42 * MIN
        ? { ...span, grade: 0.08 }
        : span,
    );
    const [first] = generateNutrition(
      input({
        timeline: { ...input().timeline, terrain },
        targets: { ...input().targets, carbsGPerHour: 0 },
      }),
    ).milestones;

    // Idéal à 45 min (milieu de section) ; la montée est dans la fenêtre de 10 min.
    expect(first?.kind).toBe('intake');
    expect(first?.reason).toBe('climb');
    expect(first?.elapsedSeconds).toBeGreaterThanOrEqual(38 * MIN);
    expect(first?.elapsedSeconds).toBeLessThan(43 * MIN);
  });

  it('ne place pas de prise juste avant un ravitaillement quand le coureur le demande', () => {
    const last = (aidBuffer: boolean) =>
      generateNutrition(input({ placement: { mode: 'smart', density: 'auto', aidBuffer } }))
        .milestones.filter(
          (milestone) => milestone.kind === 'intake' && milestone.elapsedSeconds < 90 * MIN,
        )
        .at(-1)?.elapsedSeconds ?? 0;

    expect(90 * MIN - last(true)).toBeGreaterThan(90 * MIN - last(false));
    expect(90 * MIN - last(true)).toBeGreaterThanOrEqual(NUTRITION_ENGINE_V1.aidMergeWindowSeconds);
  });

  it('une section trop courte n’a pas de prise : le ravitaillement suffit (§37)', () => {
    const result = generateNutrition(
      input({
        timeline: {
          finishElapsedSeconds: 50 * MIN,
          points: [
            point('depart', 'start', 0, 0),
            point('ravito', 'aid', 25 * MIN, 4),
            point('arrivee', 'finish', 50 * MIN, 8),
          ],
          terrain: flatTerrain(50 * MIN, 8),
        },
      }),
    );

    expect(result.milestones.map((milestone) => milestone.kind)).toEqual(['aid', 'finish']);
  });

  it('respecte l’écart minimal entre deux prises', () => {
    const times = generateNutrition(
      input({ placement: { mode: 'smart', density: 'frequent', aidBuffer: true } }),
    ).milestones.map((milestone) => milestone.elapsedSeconds);

    for (let index = 1; index < times.length; index += 1) {
      expect((times[index] ?? 0) - (times[index - 1] ?? 0)).toBeGreaterThan(0);
    }
    const intakes = generateNutrition(
      input({ placement: { mode: 'smart', density: 'frequent', aidBuffer: true } }),
    ).milestones.filter((milestone) => milestone.kind === 'intake');
    for (let index = 1; index < intakes.length; index += 1) {
      expect(
        (intakes[index]?.elapsedSeconds ?? 0) - (intakes[index - 1]?.elapsedSeconds ?? 0),
      ).toBeGreaterThanOrEqual(NUTRITION_ENGINE_V1.minGapSeconds);
    }
  });

  it('dit le besoin depuis la prise précédente, qui totalise la course', () => {
    const { milestones, totals } = generateNutrition(input());

    expect(
      milestones.reduce((sum, milestone) => sum + milestone.needSincePrevious.carbsG, 0),
    ).toBeCloseTo(totals.carbsG, 6);
  });

  it('situe chaque prise sur le parcours', () => {
    const intake = generateNutrition(input()).milestones.find(
      (milestone) => milestone.kind === 'intake',
    );

    // Terrain linéaire de 30 km en 185 min.
    expect(intake?.distanceKm).toBeCloseTo((30 * (intake?.elapsedSeconds ?? 0)) / (185 * MIN), 6);
  });
});

describe('déterminisme (§87)', () => {
  it('même entrée, même résultat et même empreinte ; clés stables', () => {
    const first = generateNutrition(input());
    const second = generateNutrition(input());

    expect(second).toEqual(first);
    expect(first.inputHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(new Set(first.milestones.map((milestone) => milestone.stableKey)).size).toBe(
      first.milestones.length,
    );
    expect(first.milestones.at(-1)?.stableKey).toBe('finish:arrivee');
  });

  it('une cible différente change l’empreinte', () => {
    expect(generateNutrition(input()).inputHash).not.toBe(
      generateNutrition(input({ targets: { ...input().targets, carbsGPerHour: 70 } })).inputHash,
    );
  });

  it('fonctionne sans terrain : le temps seul place les prises', () => {
    const result = generateNutrition(input({ timeline: { ...input().timeline, terrain: [] } }));

    expect(
      result.milestones
        .filter((milestone) => milestone.kind === 'intake')
        .every((m) => m.reason === 'time'),
    ).toBe(true);
  });
});

describe('durée totale', () => {
  it('3 h 05 de course', () => {
    expect(185 * MIN).toBe(3 * HOUR + 5 * MIN);
  });
});

describe('rythme imposé (§36)', () => {
  it('place une prise toutes les N minutes, sans tenir compte du besoin', () => {
    // 4 h sans ravitaillement, une prise toutes les 30 min → 7 prises, même sans glucides.
    const result = generateNutrition(
      input({
        timeline: {
          finishElapsedSeconds: 240 * MIN,
          points: [point('depart', 'start', 0, 0), point('arrivee', 'finish', 240 * MIN, 40)],
          terrain: flatTerrain(240 * MIN, 40),
        },
        targets: { ...input().targets, carbsGPerHour: 0 },
        placement: {
          mode: 'interval',
          density: 'auto',
          aidBuffer: false,
          intervalSeconds: 30 * MIN,
        },
      }),
    );

    expect(result.milestones.filter((milestone) => milestone.kind === 'intake')).toHaveLength(7);
  });
});
