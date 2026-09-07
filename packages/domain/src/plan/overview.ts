import type { CutoffMarginStatus } from '@pluka/plan-engine';

import { notFoundError, parseCommand } from '../errors.js';
import { getActivePlanQuerySchema } from './commands.js';
import { loadPlanScope } from './snapshot.js';
import { authorizePlanRead, type PlanContext } from './use-cases.js';

/**
 * Modèle de lecture du Plan — docs/engines/PLAN_ENGINE.md §64.
 *
 * §64 énumère ce que le résultat doit permettre d'afficher : objectif, arrivée
 * actuelle, profil altimétrique, durée de chaque section, ETA de chaque
 * waypoint, temps écoulé, arrêt, état verrouillé, barrières, marges, point
 * ayant la marge la plus faible, warnings, et la différence éventuelle entre
 * objectif et Plan actuel.
 *
 * Tout est assemblé ici, côté serveur. §64 précise aussi ce que le moteur ne
 * produit pas — « textes marketing, couleurs, composants, décisions de
 * paywall » — et l'écran n'a pas davantage à recalculer : il reçoit des
 * nombres prêts à lire et les met en forme.
 *
 * Les allures suivent la même règle. Une allure est une division — durée sur
 * distance — mais la faire dans le navigateur mettrait un morceau de calcul
 * hors du serveur, là où §5 des entitlements et §45 du moteur veulent que tout
 * soit résolu avant d'arriver à l'écran.
 */

/** Un point du parcours, avec son horaire et son allure. */
export interface PlanPointView {
  readonly raceWaypointId: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly distanceKm: number;
  readonly altitudeM: number | null;
  /** Temps écoulé depuis le départ effectif (§5.1). */
  readonly plannedElapsedSeconds: number;
  /** Heure calendaire dérivée (§5.3). */
  readonly plannedArrivalAt: string;
  readonly stopDurationSeconds: number;
  readonly plannedDepartureElapsedSeconds: number;
  readonly plannedDepartureAt: string;
  readonly isLocked: boolean;
  readonly lockedElapsedSeconds: number | null;
  /**
   * Section menant à ce point, absente au départ.
   *
   * `paceSecondsPerKm` est nulle quand la section ne couvre aucune distance :
   * §54 du Design System interdit de « fabriquer de la précision ».
   */
  readonly incomingSegment: {
    readonly raceSegmentId: string;
    readonly distanceKm: number;
    readonly plannedDurationSeconds: number;
    readonly initialDurationSeconds: number;
    readonly manualOverride: boolean;
    readonly paceSecondsPerKm: number | null;
  } | null;
}

/** Un échantillon du profil altimétrique — Design System §47, §48. */
export interface PlanProfileSample {
  readonly distanceKm: number;
  readonly elevationMeters: number;
}

export interface PlanCutoffView {
  readonly raceCutoffId: string;
  readonly raceWaypointId: string;
  readonly waypointName: string;
  readonly marginSeconds: number;
  readonly status: CutoffMarginStatus;
}

export interface PlanOverview {
  readonly racePlanId: string;
  readonly version: number;
  readonly engineVersion: string;
  readonly startAt: string;
  /** Fuseau de la course : les heures affichées sont celles du terrain (§5.3). */
  readonly timezone: string;
  readonly targetDurationSeconds: number;
  readonly initialTargetDurationSeconds: number;
  readonly finishElapsedSeconds: number;
  /**
   * Écart entre l'arrivée du Plan et l'objectif — §27.
   *
   * « Le Plan peut donc avoir target_duration_seconds = 13h30 et
   * planned_finish = 13h42 tant que l'utilisateur n'a pas demandé un
   * rééquilibrage. » Positif, l'arrivée est plus tardive que l'objectif.
   */
  readonly driftSeconds: number;
  readonly points: readonly PlanPointView[];
  readonly profile: readonly PlanProfileSample[];
  /**
   * Le profil est-il ancré sur une altitude officielle ?
   *
   * Faux quand aucun waypoint ne porte d'altitude : la courbe garde sa forme,
   * mais ses valeurs sont relatives au départ. L'écran doit le dire plutôt que
   * d'afficher des mètres qui n'en sont pas (§54, point 8).
   */
  readonly profileIsAnchored: boolean;
  readonly cutoffs: readonly PlanCutoffView[];
  /** §64 : « point ayant la marge la plus faible ». */
  readonly tightestCutoff: PlanCutoffView | null;
}

/**
 * Assemble tout ce que l'écran du Plan affiche.
 *
 * La lecture est ouverte au Free : `plan.read` est une capability du socle
 * (04_ENTITLEMENTS §57), et §41 du moteur le confirme — « Free doit pouvoir
 * lire le premier Plan généré ».
 */
export async function getPlanOverview(context: PlanContext, input: unknown): Promise<PlanOverview> {
  const useCase = 'getPlanOverview';
  const query = parseCommand(getActivePlanQuerySchema, input, useCase);

  await authorizePlanRead(context, query.participantRaceId);

  const scope = await loadPlanScope(
    context.repositories,
    context.actor.userId,
    query.participantRaceId,
    useCase,
  );

  const plan = await context.repositories.racePlans.findActive(query.participantRaceId);
  if (plan === null) throw notFoundError(useCase, 'Plan');

  const geometryId = await context.repositories.planCourse.findCurrentCourseGeometryId(
    scope.race.id,
  );

  const [planWaypoints, planSegments, cutoffStatuses, courseWaypoints, courseSegments, micro] =
    await Promise.all([
      context.repositories.racePlans.listWaypoints(plan.id),
      context.repositories.racePlans.listSegments(plan.id),
      context.repositories.racePlans.listCutoffStatuses(plan.id),
      context.repositories.planCourse.listWaypoints(scope.race.id),
      context.repositories.planCourse.listSegments(scope.race.id),
      geometryId === null
        ? Promise.resolve([])
        : context.repositories.planCourse.listMicroSegments(geometryId),
    ]);

  const courseById = new Map(courseWaypoints.map((waypoint) => [waypoint.id, waypoint]));
  const segmentById = new Map(courseSegments.map((segment) => [segment.id, segment]));
  const planSegmentByTarget = new Map(
    planSegments.flatMap((segment) => {
      const course = segmentById.get(segment.raceSegmentId);
      return course === undefined ? [] : [[course.toWaypointId, segment] as const];
    }),
  );

  const startMs = Date.parse(scope.startAt);
  const distanceById = new Map(
    courseWaypoints.map((waypoint) => [waypoint.id, waypoint.distanceKm]),
  );

  const points: PlanPointView[] = [...planWaypoints]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((waypoint) => {
      const course = courseById.get(waypoint.raceWaypointId);
      const segment = planSegmentByTarget.get(waypoint.raceWaypointId);
      const departure = waypoint.plannedElapsedSeconds + waypoint.stopDurationSeconds;

      return {
        raceWaypointId: waypoint.raceWaypointId,
        name: course?.name ?? 'Point de passage',
        sortOrder: waypoint.sortOrder,
        distanceKm: course?.distanceKm ?? 0,
        altitudeM: course?.altitudeM ?? null,
        plannedElapsedSeconds: waypoint.plannedElapsedSeconds,
        plannedArrivalAt: new Date(startMs + waypoint.plannedElapsedSeconds * 1000).toISOString(),
        stopDurationSeconds: waypoint.stopDurationSeconds,
        plannedDepartureElapsedSeconds: departure,
        plannedDepartureAt: new Date(startMs + departure * 1000).toISOString(),
        isLocked: waypoint.isLocked,
        lockedElapsedSeconds: waypoint.lockedElapsedSeconds,
        incomingSegment:
          segment === undefined ? null : toSegmentView(segment, segmentById, distanceById),
      };
    });

  const cutoffs: PlanCutoffView[] = cutoffStatuses.map((status) => ({
    raceCutoffId: status.raceCutoffId,
    raceWaypointId: status.raceWaypointId,
    waypointName: courseById.get(status.raceWaypointId)?.name ?? 'Barrière',
    marginSeconds: status.marginSeconds,
    status: status.status,
  }));

  const finishElapsedSeconds = points[points.length - 1]?.plannedElapsedSeconds ?? 0;

  return {
    racePlanId: plan.id,
    version: plan.version,
    engineVersion: plan.engineVersion,
    startAt: scope.startAt,
    timezone: scope.race.timezone,
    targetDurationSeconds: plan.targetDurationSeconds,
    initialTargetDurationSeconds: plan.initialTargetDurationSeconds,
    finishElapsedSeconds,
    driftSeconds: finishElapsedSeconds - plan.targetDurationSeconds,
    points,
    ...buildProfile(micro, courseWaypoints),
    cutoffs,
    // Trié par marge croissante par le repository : le premier est le plus
    // serré (§64).
    tightestCutoff: cutoffs[0] ?? null,
  };
}

function toSegmentView(
  segment: {
    raceSegmentId: string;
    plannedDurationSeconds: number;
    initialDurationSeconds: number;
    manualOverride: boolean;
  },
  segmentById: ReadonlyMap<string, { fromWaypointId: string; toWaypointId: string }>,
  distanceById: ReadonlyMap<string, number>,
): NonNullable<PlanPointView['incomingSegment']> {
  const course = segmentById.get(segment.raceSegmentId);
  const from = course === undefined ? undefined : distanceById.get(course.fromWaypointId);
  const to = course === undefined ? undefined : distanceById.get(course.toWaypointId);
  const distanceKm = from === undefined || to === undefined ? 0 : Math.max(0, to - from);

  return {
    raceSegmentId: segment.raceSegmentId,
    distanceKm,
    plannedDurationSeconds: segment.plannedDurationSeconds,
    initialDurationSeconds: segment.initialDurationSeconds,
    manualOverride: segment.manualOverride,
    // Une allure sur une distance nulle serait une division par zéro déguisée
    // en information.
    paceSecondsPerKm:
      distanceKm > 0 ? Math.round(segment.plannedDurationSeconds / distanceKm) : null,
  };
}

/**
 * Profil altimétrique — Design System §47, §48.
 *
 * Construit par accumulation des deltas des micro-segments, ancré sur
 * l'altitude officielle du départ quand elle existe. Sans elle, la courbe
 * garde exactement la même forme mais ses valeurs sont relatives : c'est ce
 * que `profileIsAnchored` dit à l'écran, plutôt que d'afficher des mètres
 * inventés (§54, « ne pas fabriquer de précision »).
 */
function buildProfile(
  micro: readonly {
    readonly sortOrder: number;
    readonly distanceMeters: number;
    readonly elevationDeltaMeters: number;
  }[],
  waypoints: readonly { readonly sortOrder: number; readonly altitudeM: number | null }[],
): { profile: readonly PlanProfileSample[]; profileIsAnchored: boolean } {
  if (micro.length === 0) return { profile: [], profileIsAnchored: false };

  const start = [...waypoints].sort((left, right) => left.sortOrder - right.sortOrder)[0];
  const anchor = start?.altitudeM ?? null;

  const samples: PlanProfileSample[] = [{ distanceKm: 0, elevationMeters: anchor ?? 0 }];

  let distanceMeters = 0;
  let elevation = anchor ?? 0;

  for (const segment of [...micro].sort((left, right) => left.sortOrder - right.sortOrder)) {
    distanceMeters += segment.distanceMeters;
    elevation += segment.elevationDeltaMeters;

    samples.push({
      distanceKm: Number((distanceMeters / 1000).toFixed(3)),
      elevationMeters: Number(elevation.toFixed(1)),
    });
  }

  return { profile: samples, profileIsAnchored: anchor !== null };
}
