import { describe, expect, it } from 'vitest';

import { calculatePlan, PLAN_ENGINE_V1 } from '../src/index.js';
import {
  durationOf,
  elapsedAt,
  FLAT_10K,
  planInput,
  START_AT,
  type SegmentSpec,
} from './fixtures/course.js';

/**
 * Tests fondamentaux P01 à P22 — docs/engines/PLAN_ENGINE.md §53, §54.
 *
 * LES NOMBRES SONT CALCULÉS À LA MAIN
 *
 * Le socle est P01, et tout le reste s'y adosse. Sur 10 km plats en deux
 * segments de 5 000 m, avec un objectif de 3 600 s et aucun arrêt :
 *
 * ```text
 * progress(seg0) = 2500 / 10000 = 0.25   fatigue = 1 + 0.10 × 0.0625 = 1.00625
 * progress(seg1) = 7500 / 10000 = 0.75   fatigue = 1 + 0.10 × 0.5625 = 1.05625
 *
 * w0 = 5000 × 1.00 × 1.00 × 1.00625 = 5031.25
 * w1 = 5000 × 1.00 × 1.00 × 1.05625 = 5281.25
 * Σw = 10312.5
 *
 * secondes/poids = 3600 / 10312.5 = 0.3490909…
 * d0 = 5031.25 × 0.3490909… = 1756.3636…
 * d1 = 5281.25 × 0.3490909… = 1843.6363…
 *
 * arrondi (§16.1) : floor 1756 + 1843 = 3599, une seconde à placer,
 * plus grand reste = d1  →  d0 = 1756, d1 = 1844
 * ```
 */

const config = PLAN_ENGINE_V1;

/** Durées de référence de P01, réutilisées par les scénarios d'édition. */
const FLAT_D0 = 1756;
const FLAT_D1 = 1844;

describe('P01 — plat', () => {
  const result = calculatePlan(planInput({ specs: FLAT_10K, targetDurationSeconds: 3600 }));

  it('rend des durées quasi égales', () => {
    expect(durationOf(result, 'seg0')).toBe(FLAT_D0);
    expect(durationOf(result, 'seg1')).toBe(FLAT_D1);
    expect(Math.abs(FLAT_D1 - FLAT_D0)).toBeLessThan(0.06 * 3600);
  });

  it('termine exactement sur l’objectif', () => {
    expect(result.finishElapsedSeconds).toBe(3600);
    expect(result.targetDurationSeconds).toBe(3600);
  });

  it('ne produit aucun warning', () => {
    expect(result.warnings).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.status).toBe('ok');
  });

  it('déplace un peu de temps vers la seconde moitié sans rallonger l’objectif', () => {
    // §67, critère 9. La fatigue ne crée pas de temps : elle en déplace.
    expect(durationOf(result, 'seg1')).toBeGreaterThan(durationOf(result, 'seg0'));
    expect(durationOf(result, 'seg0') + durationOf(result, 'seg1')).toBe(3600);
  });
});

describe('P02 — montée', () => {
  // 5 km plat + 5 km à +10 % (facteur 1.60).
  //   w0 = 5000 × 1.00 × 1.00625 = 5031.25
  //   w1 = 5000 × 1.60 × 1.05625 = 8450
  // La montée reçoit 8450 / 5031.25 = 1.679… fois plus de temps que le plat.
  const specs: readonly SegmentSpec[] = [
    { distanceMeters: 5000, grade: 0 },
    { distanceMeters: 5000, grade: 0.1 },
  ];
  const result = calculatePlan(planInput({ specs, targetDurationSeconds: 3600 }));

  it('donne à la montée une part nettement supérieure', () => {
    const flat = durationOf(result, 'seg0');
    const climb = durationOf(result, 'seg1');

    expect(climb / flat).toBeCloseTo(8450 / 5031.25, 2);
    expect(climb).toBeGreaterThan(flat);
  });

  it('sans dépasser l’objectif', () => {
    expect(result.finishElapsedSeconds).toBe(3600);
  });
});

describe('P03 — descente', () => {
  // Descente modérée -10 % (facteur 0.82) puis très raide -40 % (facteur 1.40).
  const specs: readonly SegmentSpec[] = [
    { distanceMeters: 5000, grade: -0.1 },
    { distanceMeters: 5000, grade: -0.4 },
  ];
  const result = calculatePlan(planInput({ specs, targetDurationSeconds: 3600 }));

  it('rend la descente modérée moins coûteuse que la très raide', () => {
    expect(durationOf(result, 'seg1')).toBeGreaterThan(durationOf(result, 'seg0'));
  });

  it('et la descente modérée moins coûteuse qu’un plat équivalent', () => {
    const flat = calculatePlan(planInput({ specs: FLAT_10K, targetDurationSeconds: 3600 }));
    const moderate = result.planSegments[0] as (typeof result.planSegments)[number];
    const reference = flat.planSegments[0] as (typeof flat.planSegments)[number];

    // Les poids sont relatifs : c'est leur rapport qui porte l'information.
    expect(moderate.relativeWeight).toBeLessThan(reference.relativeWeight);
  });
});

describe('P04 — arrêt et rééquilibrage', () => {
  // Un arrêt de 600 s au waypoint intermédiaire.
  //   budget mobile = 3600 - 600 = 3000
  //   d0 = 5031.25 / 10312.5 × 3000 = 1463.6363…   reste .6363
  //   d1 = 5281.25 / 10312.5 × 3000 = 1536.3636…   reste .3636
  //   floor 1463 + 1536 = 2999, une seconde au plus grand reste → d0
  const result = calculatePlan(
    planInput({
      specs: FLAT_10K,
      targetDurationSeconds: 3600,
      stops: [{ waypointId: 'wp1', durationSeconds: 600, origin: 'default' }],
    }),
  );

  it('réduit le budget mobile de la durée de l’arrêt', () => {
    expect(durationOf(result, 'seg0')).toBe(1464);
    expect(durationOf(result, 'seg1')).toBe(1536);
    expect(result.calculationMetadata.stopBudgetSeconds).toBe(600);
  });

  it('termine quand même sur l’objectif en rebalance_to_target', () => {
    expect(result.finishElapsedSeconds).toBe(3600);
  });

  it('consomme l’arrêt avant le segment suivant (§17)', () => {
    expect(elapsedAt(result, 'wp1')).toBe(1464);
    const waypoint = result.planWaypoints[1] as (typeof result.planWaypoints)[number];
    expect(waypoint.plannedDepartureElapsedSeconds).toBe(2064);
  });
});

describe('P05 — override +10 min en mode dérive', () => {
  const result = calculatePlan(
    planInput({
      specs: FLAT_10K,
      targetDurationSeconds: 3600,
      mode: 'preserve_manual_changes',
      segmentOverrides: [{ segmentId: 'seg0', durationSeconds: FLAT_D0 + 600 }],
    }),
  );

  it('laisse l’arrivée dériver d’environ dix minutes', () => {
    expect(result.finishElapsedSeconds).toBe(3600 + 600);
  });

  it('conserve le segment flexible à sa durée de référence', () => {
    expect(durationOf(result, 'seg1')).toBe(FLAT_D1);
  });

  it('n’a pas modifié l’objectif (§27)', () => {
    // « target_duration_seconds = 13h30 / planned_finish = 13h42 » reste un
    // état légitime tant que l'utilisateur n'a pas demandé de rééquilibrage.
    expect(result.targetDurationSeconds).toBe(3600);
  });
});

describe('P06 — override +10 min en mode rééquilibrage', () => {
  const overridden = FLAT_D0 + 600;
  const result = calculatePlan(
    planInput({
      specs: FLAT_10K,
      targetDurationSeconds: 3600,
      mode: 'rebalance_to_target',
      segmentOverrides: [{ segmentId: 'seg0', durationSeconds: overridden }],
    }),
  );

  it('garde l’arrivée sur l’objectif', () => {
    expect(result.finishElapsedSeconds).toBe(3600);
  });

  it('ne touche pas au segment manuel (§22.2, §24)', () => {
    expect(durationOf(result, 'seg0')).toBe(overridden);
    expect((result.planSegments[0] as (typeof result.planSegments)[number]).manualOverride).toBe(
      true,
    );
  });

  it('fait absorber le delta par le segment flexible', () => {
    expect(durationOf(result, 'seg1')).toBe(3600 - overridden);
  });
});

describe('P07 — une ancre découpe le solveur', () => {
  // Quatre waypoints, trois segments plats de 5 km. Ancre à 3 600 s sur wp2.
  const specs: readonly SegmentSpec[] = [
    { distanceMeters: 5000, grade: 0 },
    { distanceMeters: 5000, grade: 0 },
    { distanceMeters: 5000, grade: 0 },
  ];
  const result = calculatePlan(
    planInput({
      specs,
      targetDurationSeconds: 7200,
      anchors: [{ waypointId: 'wp2', arrivalElapsedSeconds: 3600 }],
    }),
  );

  it('résout les intervalles avant et après indépendamment', () => {
    expect(result.calculationMetadata.solvedIntervals).toBe(2);
    expect(elapsedAt(result, 'wp2')).toBe(3600);
    expect(result.finishElapsedSeconds).toBe(7200);
  });

  it('respecte exactement l’ancre (§55.5)', () => {
    expect(durationOf(result, 'seg0') + durationOf(result, 'seg1')).toBe(3600);
    expect(durationOf(result, 'seg2')).toBe(3600);
  });

  it('marque le waypoint comme verrouillé', () => {
    const waypoint = result.planWaypoints[2] as (typeof result.planWaypoints)[number];
    expect(waypoint.isLocked).toBe(true);
    expect(waypoint.lockedElapsedSeconds).toBe(3600);
  });
});

describe('P08 — ancres incompatibles', () => {
  const specs: readonly SegmentSpec[] = [
    { distanceMeters: 5000, grade: 0 },
    { distanceMeters: 5000, grade: 0 },
    { distanceMeters: 5000, grade: 0 },
  ];

  it('refuse deux ancres dont l’ordre du temps contredit celui du parcours', () => {
    const result = calculatePlan(
      planInput({
        specs,
        targetDurationSeconds: 7200,
        anchors: [
          { waypointId: 'wp1', arrivalElapsedSeconds: 3600 },
          { waypointId: 'wp2', arrivalElapsedSeconds: 2000 },
        ],
      }),
    );

    expect(result.status).toBe('error');
    expect(result.conflicts.map((issue) => issue.code)).toContain('ANCHOR_ORDER_CONFLICT');
  });

  it('refuse une durée imposée qui dépasse le budget de son intervalle', () => {
    const result = calculatePlan(
      planInput({
        specs,
        targetDurationSeconds: 7200,
        anchors: [{ waypointId: 'wp1', arrivalElapsedSeconds: 600 }],
        segmentOverrides: [{ segmentId: 'seg0', durationSeconds: 1200 }],
      }),
    );

    expect(result.conflicts.map((issue) => issue.code)).toContain('FIXED_DURATION_CONFLICT');
  });

  it('ne résout jamais un conflit en supprimant une contrainte (§24)', () => {
    const result = calculatePlan(
      planInput({
        specs,
        targetDurationSeconds: 7200,
        anchors: [{ waypointId: 'wp1', arrivalElapsedSeconds: 600 }],
        segmentOverrides: [{ segmentId: 'seg0', durationSeconds: 1200 }],
      }),
    );

    // La contrainte est toujours là, et nommée.
    expect(durationOf(result, 'seg0')).toBe(1200);
    expect(result.status).toBe('error');
  });
});

describe('P09 — barrière', () => {
  // Passage de référence 15:54, barrière 16:31 → marge 37 min = 2220 s.
  // 1800 <= 2220 < 3600 → `watch`.
  const result = calculatePlan(
    planInput({
      specs: FLAT_10K,
      targetDurationSeconds: 3600,
      cutoffs: [
        {
          id: 'cut-1',
          waypointId: 'wp1',
          // wp1 est atteint à 1756 s ; barrière posée 2220 s plus tard.
          cutoffElapsedSeconds: FLAT_D0 + 2220,
          basis: 'arrival',
        },
      ],
    }),
  );

  it('calcule la marge et son statut', () => {
    const status = result.cutoffStatuses[0] as (typeof result.cutoffStatuses)[number];

    expect(status.marginSeconds).toBe(2220);
    expect(status.status).toBe('watch');
  });

  it('n’émet pas de warning pour une marge à surveiller', () => {
    // §49 : seuls `CUTOFF_CRITICAL` et `CUTOFF_MISSED` sont des warnings.
    expect(result.warnings).toEqual([]);
  });
});

describe('P10 — passage de minuit', () => {
  // Départ à 22:00 UTC, objectif 4 h → arrivée à 02:00 le lendemain.
  const result = calculatePlan(
    planInput({
      specs: FLAT_10K,
      targetDurationSeconds: 4 * 3600,
      startAt: '2026-06-20T22:00:00.000Z',
    }),
  );

  it('garde des elapsed monotones', () => {
    const elapsed = result.planWaypoints.map((waypoint) => waypoint.plannedElapsedSeconds);

    expect(elapsed).toEqual([...elapsed].sort((left, right) => left - right));
    expect(elapsed[elapsed.length - 1]).toBe(14400);
  });

  it('produit des dates calendaires correctes de l’autre côté de minuit', () => {
    const finish = result.planWaypoints[
      result.planWaypoints.length - 1
    ] as (typeof result.planWaypoints)[number];

    expect(finish.plannedArrivalAt).toBe('2026-06-21T02:00:00.000Z');
  });

  it('ne remet rien à zéro à 00:00', () => {
    for (let index = 1; index < result.planWaypoints.length; index += 1) {
      const previous = result.planWaypoints[index - 1] as (typeof result.planWaypoints)[number];
      const current = result.planWaypoints[index] as (typeof result.planWaypoints)[number];

      expect(current.plannedElapsedSeconds).toBeGreaterThan(previous.plannedElapsedSeconds);
    }
  });

  it('supporte un ultra de plus de vingt-quatre heures', () => {
    const long = calculatePlan(
      planInput({
        specs: FLAT_10K,
        targetDurationSeconds: 30 * 3600,
        startAt: '2026-06-20T22:00:00.000Z',
      }),
    );

    expect(long.finishElapsedSeconds).toBe(108000);
    const finish = long.planWaypoints[
      long.planWaypoints.length - 1
    ] as (typeof long.planWaypoints)[number];
    expect(finish.plannedArrivalAt).toBe('2026-06-22T04:00:00.000Z');
  });
});

describe('P14 — déterminisme', () => {
  it('rend deux fois exactement le même résultat', () => {
    const input = planInput({
      specs: FLAT_10K,
      targetDurationSeconds: 3600,
      stops: [{ waypointId: 'wp1', durationSeconds: 300, origin: 'default' }],
    });

    expect(calculatePlan(input)).toEqual(calculatePlan(input));
  });

  it('ne dépend pas de l’ordre d’arrivée des collections (§35)', () => {
    const ordered = planInput({ specs: FLAT_10K, targetDurationSeconds: 3600 });
    const shuffled = {
      ...ordered,
      course: {
        ...ordered.course,
        waypoints: [...ordered.course.waypoints].reverse(),
        raceSegments: [...ordered.course.raceSegments].reverse(),
        microSegments: [...ordered.course.microSegments].reverse(),
      },
    };

    const left = calculatePlan(ordered);
    const right = calculatePlan(shuffled);

    expect(right.planSegments).toEqual(left.planSegments);
    expect(right.calculationMetadata.inputHash).toBe(left.calculationMetadata.inputHash);
  });
});

describe('P16 — arrêt ajouté avant une ancre', () => {
  const specs: readonly SegmentSpec[] = [
    { distanceMeters: 5000, grade: 0 },
    { distanceMeters: 5000, grade: 0 },
    { distanceMeters: 5000, grade: 0 },
  ];

  it('laisse l’ancre exacte, le delta étant absorbé par les segments flexibles', () => {
    const result = calculatePlan(
      planInput({
        specs,
        targetDurationSeconds: 7200,
        anchors: [{ waypointId: 'wp2', arrivalElapsedSeconds: 3600 }],
        stops: [{ waypointId: 'wp1', durationSeconds: 480, origin: 'manual' }],
      }),
    );

    expect(elapsedAt(result, 'wp2')).toBe(3600);
    expect(durationOf(result, 'seg0') + durationOf(result, 'seg1')).toBe(3600 - 480);
    expect(result.conflicts).toEqual([]);
  });

  it('produit un conflit si le budget de l’intervalle devient négatif', () => {
    const result = calculatePlan(
      planInput({
        specs,
        targetDurationSeconds: 7200,
        anchors: [{ waypointId: 'wp2', arrivalElapsedSeconds: 600 }],
        stops: [{ waypointId: 'wp1', durationSeconds: 1200, origin: 'manual' }],
      }),
    );

    expect(result.conflicts.map((issue) => issue.code)).toContain('FIXED_DURATION_CONFLICT');
  });
});

describe('P17 — override protégé par un changement d’objectif', () => {
  const overridden = 2000;
  const before = calculatePlan(
    planInput({
      specs: FLAT_10K,
      targetDurationSeconds: 3600,
      segmentOverrides: [{ segmentId: 'seg0', durationSeconds: overridden }],
    }),
  );
  const after = calculatePlan(
    planInput({
      specs: FLAT_10K,
      targetDurationSeconds: 5400,
      segmentOverrides: [{ segmentId: 'seg0', durationSeconds: overridden }],
    }),
  );

  it('laisse l’override strictement identique', () => {
    expect(durationOf(before, 'seg0')).toBe(overridden);
    expect(durationOf(after, 'seg0')).toBe(overridden);
  });

  it('ne recalcule que la portion flexible', () => {
    expect(durationOf(before, 'seg1')).toBe(3600 - overridden);
    expect(durationOf(after, 'seg1')).toBe(5400 - overridden);
  });
});

describe('P18 — déverrouillage', () => {
  const specs: readonly SegmentSpec[] = [
    { distanceMeters: 5000, grade: 0 },
    { distanceMeters: 5000, grade: 0 },
    { distanceMeters: 5000, grade: 0 },
  ];

  it('rend le waypoint flexible au recalcul suivant', () => {
    const locked = calculatePlan(
      planInput({
        specs,
        targetDurationSeconds: 7200,
        anchors: [{ waypointId: 'wp2', arrivalElapsedSeconds: 3600 }],
      }),
    );
    const unlocked = calculatePlan(planInput({ specs, targetDurationSeconds: 7200 }));

    expect(elapsedAt(locked, 'wp2')).toBe(3600);
    expect((unlocked.planWaypoints[2] as (typeof unlocked.planWaypoints)[number]).isLocked).toBe(
      false,
    );
    // Sans ancre, wp2 revient à sa position dérivée du relief, pas à 3600.
    expect(elapsedAt(unlocked, 'wp2')).not.toBe(3600);
    expect(unlocked.calculationMetadata.solvedIntervals).toBe(1);
  });
});

describe('P19 — barrière basée sur le départ du ravito', () => {
  const result = calculatePlan(
    planInput({
      specs: FLAT_10K,
      targetDurationSeconds: 3600,
      stops: [{ waypointId: 'wp1', durationSeconds: 600, origin: 'default' }],
      cutoffs: [
        { id: 'cut-1', waypointId: 'wp1', cutoffElapsedSeconds: 2500, basis: 'departure' },
        { id: 'cut-2', waypointId: 'wp1', cutoffElapsedSeconds: 2500, basis: 'arrival' },
      ],
    }),
  );

  it('compare la barrière « departure » à arrivée + arrêt', () => {
    // Arrivée wp1 = 1464, arrêt 600 → départ 2064. Marge = 2500 - 2064 = 436.
    const departure = result.cutoffStatuses.find((status) => status.basis === 'departure');
    expect(departure?.plannedReferenceElapsedSeconds).toBe(2064);
    expect(departure?.marginSeconds).toBe(436);
  });

  it('et la barrière « arrival » à l’arrivée seule', () => {
    // Marge = 2500 - 1464 = 1036. La différence entre les deux bases vaut
    // exactement l'arrêt : la confondre offrirait dix minutes fictives.
    const arrival = result.cutoffStatuses.find((status) => status.basis === 'arrival');
    expect(arrival?.plannedReferenceElapsedSeconds).toBe(1464);
    expect(arrival?.marginSeconds).toBe(1036);
  });

  it('signale la marge critique sans diagnostiquer un abandon (§26.1)', () => {
    // 436 s < 1800 s → critique.
    const departure = result.cutoffStatuses.find((status) => status.basis === 'departure');
    expect(departure?.status).toBe('critical');
    expect(result.warnings.map((issue) => issue.code)).toContain('CUTOFF_CRITICAL');
    expect(result.status).toBe('ok');
  });

  it('rend un warning, jamais une erreur, sur une barrière dépassée', () => {
    const missed = calculatePlan(
      planInput({
        specs: FLAT_10K,
        targetDurationSeconds: 3600,
        cutoffs: [{ id: 'cut-1', waypointId: 'wp1', cutoffElapsedSeconds: 1000, basis: 'arrival' }],
      }),
    );

    expect((missed.cutoffStatuses[0] as (typeof missed.cutoffStatuses)[number]).status).toBe(
      'beyond',
    );
    expect(missed.warnings.map((issue) => issue.code)).toContain('CUTOFF_MISSED');
    expect(missed.status).toBe('ok');
    expect(missed.finishElapsedSeconds).toBe(3600);
  });
});

describe('P21 — changement d’objectif', () => {
  it('passe de 13h30 à 14h30 en gardant l’arrivée sur la cible', () => {
    const before = calculatePlan(
      planInput({ specs: FLAT_10K, targetDurationSeconds: 13.5 * 3600 }),
    );
    const after = calculatePlan(planInput({ specs: FLAT_10K, targetDurationSeconds: 14.5 * 3600 }));

    expect(before.finishElapsedSeconds).toBe(48600);
    expect(after.finishElapsedSeconds).toBe(52200);
    expect(after.targetDurationSeconds).toBe(52200);
  });

  it('recalcule les marges de barrière', () => {
    const cutoffs = [
      {
        id: 'cut-1',
        waypointId: 'wp1' as const,
        cutoffElapsedSeconds: 25000,
        basis: 'arrival' as const,
      },
    ];

    const before = calculatePlan(
      planInput({ specs: FLAT_10K, targetDurationSeconds: 13.5 * 3600, cutoffs }),
    );
    const after = calculatePlan(
      planInput({ specs: FLAT_10K, targetDurationSeconds: 14.5 * 3600, cutoffs }),
    );

    const marginBefore = (before.cutoffStatuses[0] as (typeof before.cutoffStatuses)[number])
      .marginSeconds;
    const marginAfter = (after.cutoffStatuses[0] as (typeof after.cutoffStatuses)[number])
      .marginSeconds;

    expect(marginAfter).toBeLessThan(marginBefore);
  });
});

describe('P22 — objectif mathématiquement agressif', () => {
  it('calcule sans inventer de diagnostic physiologique (§50)', () => {
    // 10 km en 20 minutes : sportivement improbable, mathématiquement calculable.
    const result = calculatePlan(planInput({ specs: FLAT_10K, targetDurationSeconds: 1200 }));

    expect(result.status).toBe('ok');
    expect(result.finishElapsedSeconds).toBe(1200);
    expect(result.warnings).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('PHYSIOLOG');
  });

  it('refuse en revanche un objectif entièrement absorbé par les arrêts (§15)', () => {
    const result = calculatePlan(
      planInput({
        specs: FLAT_10K,
        targetDurationSeconds: 600,
        stops: [{ waypointId: 'wp1', durationSeconds: 600, origin: 'manual' }],
      }),
    );

    expect(result.status).toBe('error');
    expect(result.conflicts.map((issue) => issue.code)).toContain('TARGET_TOO_SHORT');
    expect(result.finishElapsedSeconds).toBeNull();
  });
});

describe('métadonnées de calcul (§51)', () => {
  const result = calculatePlan(
    planInput({
      specs: FLAT_10K,
      targetDurationSeconds: 3600,
      stops: [{ waypointId: 'wp1', durationSeconds: 300, origin: 'default' }],
      segmentOverrides: [{ segmentId: 'seg0', durationSeconds: 1500 }],
    }),
  );

  it('expose les versions choisies serveur (§67, critère 22)', () => {
    expect(result.calculationMetadata.engineVersion).toBe('plan-v1.0.0');
    expect(result.calculationMetadata.preprocessingVersion).toBe(config.preprocessingVersion);
  });

  it('compte ce que §51 demande d’observer', () => {
    expect(result.calculationMetadata).toMatchObject({
      microSegmentCount: 2,
      raceSegmentCount: 2,
      waypointCount: 3,
      anchorCount: 0,
      overrideCount: 1,
      stopCount: 1,
      stopBudgetSeconds: 300,
      fixedSegmentBudgetSeconds: 1500,
      solvedIntervals: 1,
    });
    expect(result.calculationMetadata.totalWeight).toBeCloseTo(10312.5, 6);
  });

  it('ne fait entrer aucune donnée personnelle dans le diagnostic (§60)', () => {
    const serialized = JSON.stringify(result.calculationMetadata);

    expect(serialized).not.toContain('participant');
    expect(serialized).not.toContain('user');
  });
});

describe('portée du recalcul (§23)', () => {
  it('est nulle pour une génération initiale : rien n’a changé', () => {
    const result = calculatePlan(planInput({ specs: FLAT_10K, targetDurationSeconds: 3600 }));

    expect(result.changedRange).toBeNull();
  });

  it('couvre l’intervalle d’ancres contenant le segment modifié', () => {
    const specs: readonly SegmentSpec[] = [
      { distanceMeters: 5000, grade: 0 },
      { distanceMeters: 5000, grade: 0 },
      { distanceMeters: 5000, grade: 0 },
    ];

    const result = calculatePlan(
      planInput({
        specs,
        targetDurationSeconds: 7200,
        anchors: [{ waypointId: 'wp2', arrivalElapsedSeconds: 3600 }],
        segmentOverrides: [{ segmentId: 'seg0', durationSeconds: 1500 }],
      }),
    );

    expect(result.changedRange).toEqual({ fromWaypointId: 'wp0', toWaypointId: 'wp2' });
  });

  it('part du waypoint dont l’arrêt a été modifié', () => {
    const result = calculatePlan(
      planInput({
        specs: FLAT_10K,
        targetDurationSeconds: 3600,
        mode: 'preserve_manual_changes',
        stops: [{ waypointId: 'wp1', durationSeconds: 600, origin: 'manual' }],
      }),
    );

    expect(result.changedRange).toEqual({ fromWaypointId: 'wp1', toWaypointId: 'wp2' });
  });
});

describe('date de départ (§5.2, §5.3)', () => {
  it('dérive les dates calendaires du départ effectif reçu', () => {
    const result = calculatePlan(planInput({ specs: FLAT_10K, targetDurationSeconds: 3600 }));
    const start = result.planWaypoints[0] as (typeof result.planWaypoints)[number];

    expect(start.plannedArrivalAt).toBe(START_AT);
    expect(start.plannedElapsedSeconds).toBe(0);
  });
});
