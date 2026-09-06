import { describe, expect, it } from 'vitest';

import {
  calculatePlan,
  canonicalize,
  computeInputHash,
  distributeSeconds,
  PLAN_ENGINE_V1,
  type PlanCalculationInput,
  type PlanCalculationResult,
} from '../src/index.js';
import { FLAT_10K, planInput, type SegmentSpec } from './fixtures/course.js';

/**
 * P20 et tests de propriétés — docs/engines/PLAN_ENGINE.md §16, §55.
 *
 * §55 énumère six invariants qui doivent tenir « pour tout Plan valide ». Ils
 * sont vérifiés ici sur une batterie de scénarios plutôt que sur un cas :
 * une propriété qui ne tiendrait que sur le plat n'en serait pas une.
 */

const config = PLAN_ENGINE_V1;

describe('P20 — arrondi déterministe (§16.1)', () => {
  it('somme exactement au budget quand les durées exactes sont des tiers', () => {
    // 100 s pour trois segments de poids égal : 33,333… chacun.
    // floors 33 + 33 + 33 = 99 ; une seconde à placer ; restes égaux,
    // départagés par `sortOrder` croissant → le premier.
    const rounded = distributeSeconds(
      [
        { key: 'a', sortOrder: 0, exactSeconds: 100 / 3 },
        { key: 'b', sortOrder: 1, exactSeconds: 100 / 3 },
        { key: 'c', sortOrder: 2, exactSeconds: 100 / 3 },
      ],
      100,
    );

    expect(rounded.map((item) => item.seconds)).toEqual([34, 33, 33]);
    expect(rounded.reduce((sum, item) => sum + item.seconds, 0)).toBe(100);
  });

  it('sert d’abord le plus grand reste fractionnaire', () => {
    // 10,1 + 10,5 + 10,4 = 31 exactement.
    // floors 10 + 10 + 10 = 30 ; une seconde au plus grand reste, soit `b`.
    const rounded = distributeSeconds(
      [
        { key: 'a', sortOrder: 0, exactSeconds: 10.1 },
        { key: 'b', sortOrder: 1, exactSeconds: 10.5 },
        { key: 'c', sortOrder: 2, exactSeconds: 10.4 },
      ],
      31,
    );

    expect(rounded).toEqual([
      { key: 'a', sortOrder: 0, seconds: 10 },
      { key: 'b', sortOrder: 1, seconds: 11 },
      { key: 'c', sortOrder: 2, seconds: 10 },
    ]);
  });

  it('ne produit aucun finish à ±1 seconde selon l’exécution', () => {
    const specs: readonly SegmentSpec[] = [
      { distanceMeters: 3333, grade: 0.07 },
      { distanceMeters: 3333, grade: -0.13 },
      { distanceMeters: 3334, grade: 0.21 },
    ];

    for (const target of [3600, 7777, 12345, 48600]) {
      const result = calculatePlan(planInput({ specs, targetDurationSeconds: target }));

      expect(result.finishElapsedSeconds, `objectif ${target}`).toBe(target);
    }
  });

  it('reste stable sur des budgets successifs', () => {
    // Un slider d'objectif produit des dizaines de calculs ; aucun ne doit
    // rendre une somme fausse (§37, preview).
    for (let target = 3600; target <= 3660; target += 1) {
      const result = calculatePlan(planInput({ specs: FLAT_10K, targetDurationSeconds: target }));
      const total = result.planSegments.reduce(
        (sum, segment) => sum + segment.plannedDurationSeconds,
        0,
      );

      expect(total, `objectif ${target}`).toBe(target);
    }
  });
});

/** Jeu de scénarios sur lequel les propriétés de §55 sont vérifiées. */
const SCENARIOS: readonly (readonly [string, PlanCalculationInput])[] = [
  ['plat', planInput({ specs: FLAT_10K, targetDurationSeconds: 3600 })],
  [
    'relief varié',
    planInput({
      specs: [
        { distanceMeters: 4000, grade: 0.12, technicality: 'technical' },
        { distanceMeters: 3000, grade: -0.22 },
        { distanceMeters: 5000, grade: 0.03, technicality: 'smooth' },
        { distanceMeters: 2000, grade: -0.05, technicality: 'very_technical' },
      ],
      targetDurationSeconds: 20000,
    }),
  ],
  [
    'arrêts',
    planInput({
      specs: FLAT_10K,
      targetDurationSeconds: 5400,
      stops: [
        { waypointId: 'wp1', durationSeconds: 420, origin: 'default' },
        { waypointId: 'wp2', durationSeconds: 0, origin: 'default' },
      ],
    }),
  ],
  [
    'ancre intermédiaire',
    planInput({
      specs: [
        { distanceMeters: 5000, grade: 0.08 },
        { distanceMeters: 5000, grade: -0.08 },
        { distanceMeters: 5000, grade: 0 },
      ],
      targetDurationSeconds: 10800,
      anchors: [{ waypointId: 'wp2', arrivalElapsedSeconds: 7000 }],
    }),
  ],
  [
    'override et arrêt manuel',
    planInput({
      specs: [
        { distanceMeters: 5000, grade: 0.1 },
        { distanceMeters: 5000, grade: 0 },
        { distanceMeters: 5000, grade: -0.1 },
      ],
      targetDurationSeconds: 14400,
      segmentOverrides: [{ segmentId: 'seg1', durationSeconds: 3000 }],
      stops: [{ waypointId: 'wp1', durationSeconds: 600, origin: 'manual' }],
    }),
  ],
  [
    'dérive',
    planInput({
      specs: FLAT_10K,
      targetDurationSeconds: 3600,
      mode: 'preserve_manual_changes',
      segmentOverrides: [{ segmentId: 'seg0', durationSeconds: 2400 }],
    }),
  ],
  ['ultra multi-jour', planInput({ specs: FLAT_10K, targetDurationSeconds: 40 * 3600 })],
];

function forEachScenario(assertion: (result: PlanCalculationResult, name: string) => void): void {
  for (const [name, input] of SCENARIOS) {
    const result = calculatePlan(input);
    expect(result.status, `${name} : le scénario doit être calculable`).toBe('ok');
    assertion(result, name);
  }
}

describe('propriétés (§55)', () => {
  it('55.1 — les arrivées sont strictement croissantes', () => {
    forEachScenario((result, name) => {
      for (let index = 1; index < result.planWaypoints.length; index += 1) {
        const previous = result.planWaypoints[index - 1] as (typeof result.planWaypoints)[number];
        const current = result.planWaypoints[index] as (typeof result.planWaypoints)[number];

        expect(current.plannedElapsedSeconds, `${name}, waypoint ${index}`).toBeGreaterThan(
          previous.plannedElapsedSeconds,
        );
      }
    });
  });

  it('55.2 — aucun arrêt n’est négatif', () => {
    forEachScenario((result, name) => {
      for (const waypoint of result.planWaypoints) {
        expect(waypoint.stopDurationSeconds, name).toBeGreaterThanOrEqual(0);
        expect(waypoint.plannedDepartureElapsedSeconds, name).toBeGreaterThanOrEqual(
          waypoint.plannedElapsedSeconds,
        );
      }
    });
  });

  it('55.3 — aucune durée de segment n’est nulle ou négative', () => {
    forEachScenario((result, name) => {
      for (const segment of result.planSegments) {
        expect(segment.plannedDurationSeconds, `${name}, ${segment.raceSegmentId}`).toBeGreaterThan(
          0,
        );
      }
    });
  });

  it('55.4 — sous une ancre finale, tout somme au budget à la seconde', () => {
    for (const [name, input] of SCENARIOS) {
      if (input.mode !== 'rebalance_to_target') continue;

      const result = calculatePlan(input);
      const moving = result.planSegments.reduce(
        (sum, segment) => sum + segment.plannedDurationSeconds,
        0,
      );
      // Les arrêts du dernier waypoint sont consommés après l'arrivée : ils
      // n'entrent pas dans le budget de l'intervalle.
      const stops = result.planWaypoints
        .slice(0, -1)
        .reduce((sum, waypoint) => sum + waypoint.stopDurationSeconds, 0);

      expect(moving + stops, name).toBe(input.targetDurationSeconds);
    }
  });

  it('55.5 — une ancre ou un override n’est jamais modifié par le solveur', () => {
    for (const [name, input] of SCENARIOS) {
      const result = calculatePlan(input);

      for (const anchor of input.anchors) {
        const waypoint = result.planWaypoints.find(
          (entry) => entry.raceWaypointId === anchor.waypointId,
        );

        expect(waypoint?.plannedElapsedSeconds, `${name}, ancre ${anchor.waypointId}`).toBe(
          anchor.arrivalElapsedSeconds,
        );
      }

      for (const override of input.segmentOverrides) {
        const segment = result.planSegments.find(
          (entry) => entry.raceSegmentId === override.segmentId,
        );

        expect(segment?.plannedDurationSeconds, `${name}, override ${override.segmentId}`).toBe(
          override.durationSeconds,
        );
        expect(segment?.manualOverride).toBe(true);
      }

      for (const stop of input.stops) {
        const waypoint = result.planWaypoints.find(
          (entry) => entry.raceWaypointId === stop.waypointId,
        );

        expect(waypoint?.stopDurationSeconds, `${name}, arrêt ${stop.waypointId}`).toBe(
          stop.durationSeconds,
        );
      }
    }
  });

  it('55.6 — deux exécutions identiques rendent le même résultat', () => {
    for (const [name, input] of SCENARIOS) {
      expect(calculatePlan(input), name).toEqual(calculatePlan(input));
    }
  });
});

describe('hash d’entrée (§34)', () => {
  it('rend soixante-quatre caractères hexadécimaux', () => {
    const hash = computeInputHash(planInput({ specs: FLAT_10K, targetDurationSeconds: 3600 }));

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('est identique pour deux entrées logiquement identiques', () => {
    const left = planInput({ specs: FLAT_10K, targetDurationSeconds: 3600 });
    const right = planInput({ specs: FLAT_10K, targetDurationSeconds: 3600 });

    expect(computeInputHash(right)).toBe(computeInputHash(left));
  });

  it('ignore l’ordre non sémantique des contraintes', () => {
    const base = planInput({
      specs: FLAT_10K,
      targetDurationSeconds: 3600,
      stops: [
        { waypointId: 'wp1', durationSeconds: 300, origin: 'default' },
        { waypointId: 'wp2', durationSeconds: 60, origin: 'manual' },
      ],
    });
    const reordered = { ...base, stops: [...base.stops].reverse() };

    expect(computeInputHash(reordered)).toBe(computeInputHash(base));
  });

  it('change dès que l’objectif change', () => {
    const before = computeInputHash(planInput({ specs: FLAT_10K, targetDurationSeconds: 3600 }));
    const after = computeInputHash(planInput({ specs: FLAT_10K, targetDurationSeconds: 3601 }));

    expect(after).not.toBe(before);
  });

  it('change dès que la version moteur change', () => {
    const base = planInput({ specs: FLAT_10K, targetDurationSeconds: 3600 });
    const other = {
      ...base,
      engineConfig: { ...config, engineVersion: 'plan-v1.0.1' },
    };

    expect(computeInputHash(other)).not.toBe(computeInputHash(base));
  });

  it('normalise -0 en 0 pour ne pas produire deux hashes du même nombre', () => {
    expect(canonicalize({ value: -0 })).toBe(canonicalize({ value: 0 }));
  });

  it('trie les clés d’objet et conserve l’ordre des tableaux', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });
});

describe('pureté du moteur (§28, §35)', () => {
  it('ne dépend pas de l’horloge de la machine', () => {
    // Le seul instant utilisé est le `startAt` reçu en entrée. Décaler
    // l'horloge système ne change rien au résultat.
    const input = planInput({ specs: FLAT_10K, targetDurationSeconds: 3600 });
    const before = calculatePlan(input);

    const realNow = Date.now;
    Date.now = () => 0;
    try {
      expect(calculatePlan(input)).toEqual(before);
    } finally {
      Date.now = realNow;
    }
  });

  it('ne mute pas son entrée', () => {
    const input = planInput({
      specs: FLAT_10K,
      targetDurationSeconds: 3600,
      stops: [{ waypointId: 'wp1', durationSeconds: 300, origin: 'default' }],
      anchors: [{ waypointId: 'wp1', arrivalElapsedSeconds: 1800 }],
    });
    const snapshot = JSON.parse(JSON.stringify(input)) as unknown;

    calculatePlan(input);

    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
  });
});

describe('EXTREME_REBALANCE (§49)', () => {
  it('n’est pas émis tant que le seuil n’est pas calibré', () => {
    // « Aucun chiffre non validé ne doit être inventé. » `plan-v1.0.0` laisse
    // le seuil à `null`, donc le warning n'existe pas.
    expect(config.extremeRebalanceRatio).toBeNull();

    const result = calculatePlan(
      planInput({
        specs: FLAT_10K,
        targetDurationSeconds: 3600,
        segmentOverrides: [{ segmentId: 'seg0', durationSeconds: 3000 }],
      }),
    );

    expect(result.warnings.map((issue) => issue.code)).not.toContain('EXTREME_REBALANCE');
  });

  it('est émis dès qu’une configuration calibrée en fixe un', () => {
    const calibrated = { ...config, extremeRebalanceRatio: 0.5 };
    const result = calculatePlan(
      planInput({
        specs: FLAT_10K,
        targetDurationSeconds: 3600,
        segmentOverrides: [{ segmentId: 'seg0', durationSeconds: 3000 }],
        config: calibrated,
      }),
    );

    expect(result.warnings.map((issue) => issue.code)).toContain('EXTREME_REBALANCE');
  });
});

describe('préconditions (§7)', () => {
  const base = planInput({ specs: FLAT_10K, targetDurationSeconds: 3600 });

  it('refuse un parcours sans micro-segment', () => {
    const result = calculatePlan({
      ...base,
      course: { ...base.course, microSegments: [] },
    });

    expect(result.status).toBe('error');
    expect(result.conflicts.map((issue) => issue.code)).toContain('GPX_INVALID');
  });

  it('refuse un objectif nul ou négatif', () => {
    expect(calculatePlan({ ...base, targetDurationSeconds: 0 }).status).toBe('error');
    expect(calculatePlan({ ...base, targetDurationSeconds: -1 }).status).toBe('error');
  });

  it('refuse un arrêt négatif', () => {
    const result = calculatePlan({
      ...base,
      stops: [{ waypointId: 'wp1', durationSeconds: -60, origin: 'manual' }],
    });

    expect(result.status).toBe('error');
  });

  it('refuse une durée imposée nulle ou négative (§20)', () => {
    const result = calculatePlan({
      ...base,
      segmentOverrides: [{ segmentId: 'seg0', durationSeconds: 0 }],
    });

    expect(result.conflicts.map((issue) => issue.code)).toContain('FIXED_DURATION_CONFLICT');
  });

  it('refuse une chaîne de segments incohérente', () => {
    const result = calculatePlan({
      ...base,
      course: {
        ...base.course,
        raceSegments: [
          { id: 'seg0', sortOrder: 0, fromWaypointId: 'wp0', toWaypointId: 'wp2' },
          { id: 'seg1', sortOrder: 1, fromWaypointId: 'wp1', toWaypointId: 'wp2' },
        ],
      },
    });

    expect(result.status).toBe('error');
    expect(result.conflicts.map((issue) => issue.code)).toContain('GPX_INVALID');
  });

  it('ne rend jamais de timeline approximative en cas d’erreur (§7)', () => {
    const result = calculatePlan({ ...base, targetDurationSeconds: 0 });

    expect(result.planWaypoints).toEqual([]);
    expect(result.planSegments).toEqual([]);
    expect(result.finishElapsedSeconds).toBeNull();
  });
});
