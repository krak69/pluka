import {
  PLAN_ENGINE_V1,
  type PlanAnchorInput,
  type PlanCalculationInput,
  type PlanCutoffInput,
  type PlanEngineConfig,
  type PlanMicroSegment,
  type PlanMode,
  type PlanRaceSegmentInput,
  type PlanSegmentOverrideInput,
  type PlanStopInput,
  type PlanWaypointInput,
  type TechnicalityLevel,
} from '../../src/index.js';

/**
 * Fixtures synthétiques — docs/engines/PLAN_ENGINE.md §53.
 *
 * « Le package `plan-engine` doit disposer de fixtures synthétiques
 * indépendantes de toute course réelle. »
 *
 * Elles sont construites pour être **calculables à la main** : un micro-segment
 * par segment de course, des pentes prises sur les points d'ancrage de la
 * courbe de §11, des distances rondes. Les durées attendues des tests sont donc
 * des nombres qu'on peut vérifier au crayon, pas des captures d'une exécution
 * précédente.
 */

export interface SegmentSpec {
  readonly distanceMeters: number;
  /** Pente en ratio — `0.10` pour +10 %. */
  readonly grade: number;
  readonly technicality?: TechnicalityLevel | null;
}

export const START_AT = '2026-06-20T04:00:00.000Z';

/**
 * Progression au milieu d'un segment, comme le prétraitement la calcule.
 *
 * Avec un micro-segment par segment, `progress` vaut le milieu du segment
 * rapporté à la distance totale — ce qui rend `fatigue_factor` calculable de
 * tête : `1 + 0.10 × p²`.
 */
export function midpointProgress(specs: readonly SegmentSpec[], index: number): number {
  const total = specs.reduce((sum, spec) => sum + spec.distanceMeters, 0);
  const before = specs.slice(0, index).reduce((sum, spec) => sum + spec.distanceMeters, 0);
  const spec = specs[index] as SegmentSpec;

  return (before + spec.distanceMeters / 2) / total;
}

export interface CourseFixture {
  readonly waypoints: readonly PlanWaypointInput[];
  readonly raceSegments: readonly PlanRaceSegmentInput[];
  readonly microSegments: readonly PlanMicroSegment[];
}

/** Un waypoint par frontière de segment, un micro-segment par segment. */
export function buildCourse(specs: readonly SegmentSpec[]): CourseFixture {
  const waypoints: PlanWaypointInput[] = specs.map((_, index) => ({
    id: `wp${index}`,
    sortOrder: index,
  }));
  waypoints.push({ id: `wp${specs.length}`, sortOrder: specs.length });

  const raceSegments: PlanRaceSegmentInput[] = specs.map((_, index) => ({
    id: `seg${index}`,
    sortOrder: index,
    fromWaypointId: `wp${index}`,
    toWaypointId: `wp${index + 1}`,
  }));

  const microSegments: PlanMicroSegment[] = specs.map((spec, index) => {
    const elevationDelta = spec.distanceMeters * spec.grade;
    const clamped = Math.max(-0.4, Math.min(0.4, spec.grade));

    return {
      id: `micro${index}`,
      raceSegmentId: `seg${index}`,
      sortOrder: index,
      distanceMeters: spec.distanceMeters,
      elevationDeltaMeters: elevationDelta,
      elevationGainMeters: elevationDelta > 0 ? elevationDelta : 0,
      elevationLossMeters: elevationDelta < 0 ? -elevationDelta : 0,
      rawGrade: spec.grade,
      modelGrade: clamped,
      progress: midpointProgress(specs, index),
      technicality: spec.technicality ?? null,
    };
  });

  return { waypoints, raceSegments, microSegments };
}

export interface PlanInputOptions {
  readonly specs: readonly SegmentSpec[];
  readonly targetDurationSeconds: number;
  readonly mode?: PlanMode;
  readonly stops?: readonly PlanStopInput[];
  readonly segmentOverrides?: readonly PlanSegmentOverrideInput[];
  readonly anchors?: readonly PlanAnchorInput[];
  readonly cutoffs?: readonly PlanCutoffInput[];
  readonly startAt?: string;
  readonly config?: PlanEngineConfig;
}

export function planInput(options: PlanInputOptions): PlanCalculationInput {
  const course = buildCourse(options.specs);
  const config = options.config ?? PLAN_ENGINE_V1;

  return {
    race: { id: 'race-1', timezone: 'Europe/Paris', startAt: options.startAt ?? START_AT },
    course: {
      preprocessingVersion: config.preprocessingVersion,
      microSegments: course.microSegments,
      raceSegments: course.raceSegments,
      waypoints: course.waypoints,
      cutoffs: options.cutoffs ?? [],
    },
    targetDurationSeconds: options.targetDurationSeconds,
    stops: options.stops ?? [],
    segmentOverrides: options.segmentOverrides ?? [],
    anchors: options.anchors ?? [],
    mode: options.mode ?? 'rebalance_to_target',
    engineConfig: config,
  };
}

/** 10 km plat en deux segments égaux — le cas P01. */
export const FLAT_10K: readonly SegmentSpec[] = [
  { distanceMeters: 5000, grade: 0 },
  { distanceMeters: 5000, grade: 0 },
];

export function durationOf(
  result: { planSegments: readonly { raceSegmentId: string; plannedDurationSeconds: number }[] },
  segmentId: string,
): number {
  const segment = result.planSegments.find((entry) => entry.raceSegmentId === segmentId);
  if (segment === undefined) throw new Error(`segment absent du résultat : ${segmentId}`);

  return segment.plannedDurationSeconds;
}

export function elapsedAt(
  result: { planWaypoints: readonly { raceWaypointId: string; plannedElapsedSeconds: number }[] },
  waypointId: string,
): number {
  const waypoint = result.planWaypoints.find((entry) => entry.raceWaypointId === waypointId);
  if (waypoint === undefined) throw new Error(`waypoint absent du résultat : ${waypointId}`);

  return waypoint.plannedElapsedSeconds;
}
