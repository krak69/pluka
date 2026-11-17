import type { PlanCourseReference, RaceCutoffRecord, RaceWaypointRecord } from '@pluka/db';

/**
 * « Le parcours a changé » — PLAN_ENGINE §39.
 *
 * Un changement officiel ne réécrit jamais un Plan existant : le Plan garde le
 * parcours sur lequel il a été calculé (son empreinte, dans `input_snapshot`),
 * et l'écran compare cette empreinte au parcours d'aujourd'hui. Le coureur voit
 * ce qui a bougé et décide de mettre son Plan à jour (décision du 2026-11-17).
 */

/** L'empreinte d'un parcours : ses points dans l'ordre, ses barrières. */
export function courseReferenceOf(
  waypoints: readonly RaceWaypointRecord[],
  cutoffs: readonly RaceCutoffRecord[],
): PlanCourseReference {
  return {
    waypoints: [...waypoints]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((waypoint) => ({
        id: waypoint.id,
        name: waypoint.name,
        distanceKm: waypoint.distanceKm,
      })),
    cutoffs: cutoffs
      .map((cutoff) => ({
        waypointId: cutoff.raceWaypointId,
        at: new Date(cutoff.cutoffDatetime).toISOString(),
      }))
      .sort((left, right) =>
        (left.waypointId + left.at).localeCompare(right.waypointId + right.at),
      ),
  };
}

export interface PlanCourseChange {
  /** Les points apparus depuis le calcul du Plan, par leur nom. */
  readonly added: readonly string[];
  /**
   * Les points disparus. Un Plan antérieur à l'empreinte ne connaît pas leur
   * nom : ils sont alors comptés, pas nommés (`null`).
   */
  readonly removed: readonly (string | null)[];
  /** Les points dont le kilomètre a changé. */
  readonly moved: readonly {
    readonly name: string;
    readonly fromKm: number;
    readonly toKm: number;
  }[];
  readonly cutoffsChanged: boolean;
}

/** Un mètre près : un kilomètre réenregistré tel quel ne compte pas pour un écart. */
const KM_TOLERANCE = 0.001;

/**
 * Pure : ce qui sépare le parcours du Plan de celui d'aujourd'hui, ou `null`.
 *
 * Sans empreinte (un Plan calculé avant le 2026-11-17), seuls les points du
 * Plan se comparent : un ajout ou un retrait se voit, un kilomètre déplacé ou
 * une barrière, non.
 */
export function diffPlanCourse(
  plan: PlanCourseReference | null,
  planWaypointIds: readonly string[],
  current: PlanCourseReference,
): PlanCourseChange | null {
  const before: readonly { id: string; name: string | null; distanceKm: number | null }[] =
    plan?.waypoints ?? planWaypointIds.map((id) => ({ id, name: null, distanceKm: null }));
  const beforeById = new Map(before.map((waypoint) => [waypoint.id, waypoint]));
  const currentIds = new Set(current.waypoints.map((waypoint) => waypoint.id));

  const added = current.waypoints
    .filter((waypoint) => !beforeById.has(waypoint.id))
    .map((waypoint) => waypoint.name);
  const removed = before
    .filter((waypoint) => !currentIds.has(waypoint.id))
    .map((waypoint) => waypoint.name);
  const moved = current.waypoints.flatMap((waypoint) => {
    const previous = beforeById.get(waypoint.id);
    if (previous?.distanceKm === null || previous?.distanceKm === undefined) return [];
    return Math.abs(previous.distanceKm - waypoint.distanceKm) > KM_TOLERANCE
      ? [{ name: waypoint.name, fromKm: previous.distanceKm, toKm: waypoint.distanceKm }]
      : [];
  });
  const cutoffsChanged = plan !== null && cutoffKey(plan.cutoffs) !== cutoffKey(current.cutoffs);

  return added.length === 0 && removed.length === 0 && moved.length === 0 && !cutoffsChanged
    ? null
    : { added, removed, moved, cutoffsChanged };
}

function cutoffKey(cutoffs: PlanCourseReference['cutoffs']): string {
  return cutoffs
    .map((cutoff) => `${cutoff.waypointId}@${String(Date.parse(cutoff.at))}`)
    .sort()
    .join('|');
}
