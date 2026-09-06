import { describe, expect, it } from 'vitest';

import {
  calculatePlan,
  PLAN_ENGINE_V1,
  preprocessCourse,
  resampleTrack,
  snapWaypointsToTrack,
  type CourseTrackPoint,
  type CourseWaypointInput,
  type GeoTrackPoint,
  type PlanRaceSegmentInput,
} from '../src/index.js';
import { START_AT } from './fixtures/course.js';

/**
 * Prétraitement du parcours — docs/engines/PLAN_ENGINE.md §8.1, étapes 5 à 9,
 * et contrôles qualité §9.
 *
 * La trace de référence monte linéairement de 0 m à 100 m sur 1 000 m : la
 * pente vaut donc +10 % partout, le D+ 100 m et le D- zéro. Tout ce qui suit
 * est vérifiable de tête à partir de ces deux nombres.
 */

const config = PLAN_ENGINE_V1;

/** Un point tous les 10 m, altitude = distance / 10. */
function linearClimb(lengthMeters: number, gainMeters: number): readonly CourseTrackPoint[] {
  const points: CourseTrackPoint[] = [];

  for (let distance = 0; distance <= lengthMeters; distance += 10) {
    points.push({
      distanceMeters: distance,
      elevationMeters: (distance / lengthMeters) * gainMeters,
    });
  }

  return points;
}

function segments(waypointIds: readonly string[]): readonly PlanRaceSegmentInput[] {
  return waypointIds.slice(0, -1).map((id, index) => ({
    id: `seg${index}`,
    sortOrder: index,
    fromWaypointId: id,
    toWaypointId: waypointIds[index + 1] as string,
  }));
}

describe('ré-échantillonnage (§8.1, étape 5)', () => {
  it('produit un point tous les 25 m, plus l’arrivée', () => {
    const samples = resampleTrack(linearClimb(1000, 100), 25);

    // 0, 25, …, 975 → 40 points, plus le point final à 1000.
    expect(samples).toHaveLength(41);
    expect(samples[0]?.distanceMeters).toBe(0);
    expect(samples[1]?.distanceMeters).toBe(25);
    expect(samples[samples.length - 1]?.distanceMeters).toBe(1000);
  });

  it('interpole l’altitude entre deux points de la trace', () => {
    // À 25 m sur une montée de 100 m pour 1 000 m : 2,5 m.
    const samples = resampleTrack(linearClimb(1000, 100), 25);

    expect(samples[1]?.elevationMeters).toBeCloseTo(2.5, 6);
    expect(samples[samples.length - 1]?.elevationMeters).toBeCloseTo(100, 6);
  });

  it('refuse une trace sans altitude exploitable', () => {
    const flat: readonly CourseTrackPoint[] = [
      { distanceMeters: 0, elevationMeters: null },
      { distanceMeters: 100, elevationMeters: null },
    ];

    expect(() => resampleTrack(flat, 25)).toThrow(/GPX_INVALID/);
  });
});

describe('micro-segments (§8.1, étapes 6 à 8)', () => {
  const waypoints: readonly CourseWaypointInput[] = [
    { id: 'wp0', sortOrder: 0, alongDistanceMeters: 0 },
    { id: 'wp1', sortOrder: 1, alongDistanceMeters: 1000 },
  ];

  const result = preprocessCourse({
    points: linearClimb(1000, 100),
    waypoints,
    raceSegments: segments(['wp0', 'wp1']),
    config,
  });

  it('découpe en parts d’environ 100 m', () => {
    expect(result.microSegments).toHaveLength(10);
    for (const micro of result.microSegments) {
      expect(micro.distanceMeters).toBeCloseTo(100, 6);
    }
  });

  it('calcule pente, delta et relief par micro-segment', () => {
    const first = result.microSegments[0] as (typeof result.microSegments)[number];

    expect(first.rawGrade).toBeCloseTo(0.1, 6);
    expect(first.modelGrade).toBeCloseTo(0.1, 6);
    expect(first.elevationDeltaMeters).toBeCloseTo(10, 6);
    expect(first.elevationGainMeters).toBeCloseTo(10, 6);
    expect(first.elevationLossMeters).toBeCloseTo(0, 6);
  });

  it('donne une progression croissante, évaluée au milieu (§13)', () => {
    const progress = result.microSegments.map((micro) => micro.progress);

    expect(progress[0]).toBeCloseTo(0.05, 6);
    expect(progress[9]).toBeCloseTo(0.95, 6);
    expect(progress).toEqual([...progress].sort((left, right) => left - right));
  });

  it('totalise le relief de la trace sans le corriger (§9.1)', () => {
    expect(result.elevationGainMeters).toBeCloseTo(100, 4);
    expect(result.elevationLossMeters).toBeCloseTo(0, 4);
    expect(result.totalDistanceMeters).toBe(1000);
  });

  it('borne la pente du modèle sans toucher à la pente brute (§11.2)', () => {
    const steep = preprocessCourse({
      // 600 m de dénivelé sur 1 000 m : pente brute +60 %.
      points: linearClimb(1000, 600),
      waypoints,
      raceSegments: segments(['wp0', 'wp1']),
      config,
    });

    const micro = steep.microSegments[0] as (typeof steep.microSegments)[number];
    expect(micro.rawGrade).toBeCloseTo(0.6, 6);
    expect(micro.modelGrade).toBe(0.4);
  });
});

describe('coupure forcée aux waypoints (§8.1, étape 7)', () => {
  const result = preprocessCourse({
    points: linearClimb(1000, 100),
    waypoints: [
      { id: 'wp0', sortOrder: 0, alongDistanceMeters: 0 },
      { id: 'wp1', sortOrder: 1, alongDistanceMeters: 250 },
      { id: 'wp2', sortOrder: 2, alongDistanceMeters: 1000 },
    ],
    raceSegments: segments(['wp0', 'wp1', 'wp2']),
    config,
  });

  it('n’étale jamais un micro-segment sur deux segments de course', () => {
    // 250 m → 3 parts de 83,3 m ; 750 m → 8 parts de 93,75 m.
    const first = result.microSegments.filter((micro) => micro.raceSegmentId === 'seg0');
    const second = result.microSegments.filter((micro) => micro.raceSegmentId === 'seg1');

    expect(first).toHaveLength(3);
    expect(second).toHaveLength(8);
    expect(first.reduce((sum, micro) => sum + micro.distanceMeters, 0)).toBeCloseTo(250, 6);
    expect(second.reduce((sum, micro) => sum + micro.distanceMeters, 0)).toBeCloseTo(750, 6);
  });

  it('découpe chaque portion en parts régulières', () => {
    // « Environ 100 m » : trois parts de 83,3 m valent mieux que deux de 100 m
    // et un reliquat de 50 m, dont la pente moyenne ne serait pas comparable.
    for (const micro of result.microSegments.filter((entry) => entry.raceSegmentId === 'seg0')) {
      expect(micro.distanceMeters).toBeCloseTo(250 / 3, 6);
    }
  });

  it('numérote les micro-segments dans l’ordre du parcours', () => {
    const orders = result.microSegments.map((micro) => micro.sortOrder);

    expect(orders).toEqual([...orders].sort((left, right) => left - right));
    expect(orders[0]).toBe(0);
  });
});

describe('raccordement des waypoints (§8.1, étape 9 ; §9)', () => {
  it('refuse un waypoint à plus de 200 m de la trace', () => {
    expect(() =>
      preprocessCourse({
        points: linearClimb(1000, 100),
        waypoints: [
          { id: 'wp0', sortOrder: 0, alongDistanceMeters: 0 },
          { id: 'wp1', sortOrder: 1, alongDistanceMeters: 1000, offRouteMeters: 240 },
        ],
        raceSegments: segments(['wp0', 'wp1']),
        config,
      }),
    ).toThrow(/WAYPOINT_OFF_ROUTE/);
  });

  it('accepte un écart sous le seuil', () => {
    expect(() =>
      preprocessCourse({
        points: linearClimb(1000, 100),
        waypoints: [
          { id: 'wp0', sortOrder: 0, alongDistanceMeters: 0 },
          { id: 'wp1', sortOrder: 1, alongDistanceMeters: 1000, offRouteMeters: 150 },
        ],
        raceSegments: segments(['wp0', 'wp1']),
        config,
      }),
    ).not.toThrow();
  });

  it('refuse un segment qui ne couvre aucune distance', () => {
    expect(() =>
      preprocessCourse({
        points: linearClimb(1000, 100),
        waypoints: [
          { id: 'wp0', sortOrder: 0, alongDistanceMeters: 500 },
          { id: 'wp1', sortOrder: 1, alongDistanceMeters: 500 },
        ],
        raceSegments: segments(['wp0', 'wp1']),
        config,
      }),
    ).toThrow(/GPX_INVALID/);
  });
});

describe('P11 — divergence avec le référentiel officiel (§9, §9.1)', () => {
  const waypoints: readonly CourseWaypointInput[] = [
    { id: 'wp0', sortOrder: 0, alongDistanceMeters: 0 },
    { id: 'wp1', sortOrder: 1, alongDistanceMeters: 1000 },
  ];

  it('signale un D+ divergent de 20 % sans corriger la trace', () => {
    const result = preprocessCourse({
      points: linearClimb(1000, 100),
      waypoints,
      raceSegments: segments(['wp0', 'wp1']),
      // D+ officiel annoncé à 125 m contre 100 m mesurés : 20 % d'écart.
      official: { elevationGainMeters: 125 },
      config,
    });

    expect(result.warnings.map((issue) => issue.code)).toContain('GPX_GAIN_MISMATCH');
    // §9.1 : « il ne modifie pas artificiellement le D+ ».
    expect(result.elevationGainMeters).toBeCloseTo(100, 4);
  });

  it('se tait sous le seuil de 15 %', () => {
    const result = preprocessCourse({
      points: linearClimb(1000, 100),
      waypoints,
      raceSegments: segments(['wp0', 'wp1']),
      official: { elevationGainMeters: 110 },
      config,
    });

    expect(result.warnings).toEqual([]);
  });

  it('signale une distance divergente de plus de 10 % sans y toucher', () => {
    const result = preprocessCourse({
      points: linearClimb(1000, 100),
      waypoints,
      raceSegments: segments(['wp0', 'wp1']),
      official: { distanceMeters: 1200 },
      config,
    });

    expect(result.warnings.map((issue) => issue.code)).toContain('GPX_DISTANCE_MISMATCH');
    expect(result.totalDistanceMeters).toBe(1000);
  });
});

describe('du prétraitement au Plan', () => {
  it('alimente le moteur sans jamais reparser le GPX (§8, §15)', () => {
    // Le prétraitement tourne une fois ; le moteur consomme son résultat autant
    // de fois qu'il y a de recalculs.
    const course = preprocessCourse({
      points: linearClimb(2000, 200),
      waypoints: [
        { id: 'wp0', sortOrder: 0, alongDistanceMeters: 0 },
        { id: 'wp1', sortOrder: 1, alongDistanceMeters: 1000 },
        { id: 'wp2', sortOrder: 2, alongDistanceMeters: 2000 },
      ],
      raceSegments: segments(['wp0', 'wp1', 'wp2']),
      config,
    });

    const input = {
      race: { id: 'race-1', timezone: 'Europe/Paris', startAt: START_AT },
      course: {
        preprocessingVersion: course.preprocessingVersion,
        microSegments: course.microSegments,
        raceSegments: segments(['wp0', 'wp1', 'wp2']),
        waypoints: [
          { id: 'wp0', sortOrder: 0 },
          { id: 'wp1', sortOrder: 1 },
          { id: 'wp2', sortOrder: 2 },
        ],
        cutoffs: [],
      },
      targetDurationSeconds: 7200,
      stops: [],
      segmentOverrides: [],
      anchors: [],
      mode: 'rebalance_to_target' as const,
      engineConfig: config,
    };

    const first = calculatePlan(input);
    const second = calculatePlan(input);

    expect(first.status).toBe('ok');
    expect(first.finishElapsedSeconds).toBe(7200);
    expect(first.calculationMetadata.microSegmentCount).toBe(20);
    expect(second).toEqual(first);
  });

  it('porte sa propre version, distincte de celle du moteur (§8.1, étape 11)', () => {
    const course = preprocessCourse({
      points: linearClimb(1000, 100),
      waypoints: [
        { id: 'wp0', sortOrder: 0, alongDistanceMeters: 0 },
        { id: 'wp1', sortOrder: 1, alongDistanceMeters: 1000 },
      ],
      raceSegments: segments(['wp0', 'wp1']),
      config,
    });

    expect(course.preprocessingVersion).toBe(config.preprocessingVersion);
    expect(course.preprocessingVersion).not.toBe(config.engineVersion);
  });
});

describe('raccordement au GPX (§8.1, étape 9)', () => {
  /**
   * Trace le long du méridien 6°E : 0.0009° de latitude valent environ 100 m,
   * ce qui rend les écarts attendus calculables au crayon.
   */
  const track: readonly GeoTrackPoint[] = Array.from({ length: 21 }, (_, index) => ({
    latitude: 45 + index * 0.0009,
    longitude: 6,
    distanceMeters: index * 100,
  }));

  it('projette un waypoint sur le point de trace le plus proche', () => {
    const snapped = snapWaypointsToTrack(track, [
      { id: 'a', sortOrder: 0, latitude: 45, longitude: 6, declaredDistanceMeters: 0 },
      { id: 'b', sortOrder: 1, latitude: 45.009, longitude: 6, declaredDistanceMeters: 1000 },
    ]);

    expect(snapped[0]).toMatchObject({ alongDistanceMeters: 0 });
    expect(snapped[1]?.alongDistanceMeters).toBe(1000);
    expect(snapped[1]?.offRouteMeters).toBeLessThan(1);
  });

  it('mesure l’écart de raccordement, sans le corriger (§9)', () => {
    // Environ 0.0013° de longitude à 45° de latitude : à peu près 100 m à l'est.
    const snapped = snapWaypointsToTrack(track, [
      { id: 'a', sortOrder: 0, latitude: 45.009, longitude: 6.0013, declaredDistanceMeters: 1000 },
    ]);

    expect(snapped[0]?.offRouteMeters).toBeGreaterThan(80);
    expect(snapped[0]?.offRouteMeters).toBeLessThan(120);
    // L'abscisse reste celle de la trace : le waypoint n'a pas déplacé le GPX.
    expect(snapped[0]?.alongDistanceMeters).toBe(1000);
  });

  it('fait foi de l’abscisse mesurée plutôt que de la distance annoncée (§9.1)', () => {
    // L'organisation annonce 1 800 m ; la trace place le point à 1 000 m.
    const snapped = snapWaypointsToTrack(track, [
      { id: 'a', sortOrder: 0, latitude: 45.009, longitude: 6, declaredDistanceMeters: 1800 },
    ]);

    expect(snapped[0]?.alongDistanceMeters).toBe(1000);
  });

  it('retombe sur la distance déclarée quand la position manque', () => {
    // « On ne mesure pas ce qu'on n'a pas » : l'écart est nul, faute de mesure.
    const snapped = snapWaypointsToTrack(track, [
      { id: 'a', sortOrder: 0, latitude: null, longitude: null, declaredDistanceMeters: 1500 },
    ]);

    expect(snapped[0]).toMatchObject({ alongDistanceMeters: 1500, offRouteMeters: 0 });
  });

  it('refuse un waypoint qui n’a ni position ni distance', () => {
    expect(() =>
      snapWaypointsToTrack(track, [
        { id: 'a', sortOrder: 0, latitude: null, longitude: null, declaredDistanceMeters: null },
      ]),
    ).toThrow(/WAYPOINT_OFF_ROUTE/);
  });

  it('rend les waypoints dans l’ordre du parcours', () => {
    const snapped = snapWaypointsToTrack(track, [
      { id: 'b', sortOrder: 1, latitude: 45.009, longitude: 6, declaredDistanceMeters: 1000 },
      { id: 'a', sortOrder: 0, latitude: 45, longitude: 6, declaredDistanceMeters: 0 },
    ]);

    expect(snapped.map((waypoint) => waypoint.id)).toEqual(['a', 'b']);
  });

  it('alimente directement le prétraitement', () => {
    const snapped = snapWaypointsToTrack(track, [
      { id: 'a', sortOrder: 0, latitude: 45, longitude: 6, declaredDistanceMeters: 0 },
      { id: 'b', sortOrder: 1, latitude: 45.018, longitude: 6, declaredDistanceMeters: 2000 },
    ]);

    const course = preprocessCourse({
      points: track.map((point) => ({
        distanceMeters: point.distanceMeters,
        elevationMeters: 1000 + point.distanceMeters / 20,
      })),
      waypoints: snapped,
      raceSegments: segments(['a', 'b']),
      config,
    });

    expect(course.microSegments).toHaveLength(20);
    expect(course.totalDistanceMeters).toBe(2000);
  });
});
