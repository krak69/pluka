import type {
  PlanCalculationInput,
  PlanSegmentResult,
  PlanWaypointInput,
  PlanWaypointResult,
} from './contracts.js';
import { stopSeconds } from './solver.js';

/**
 * Construction de la timeline — docs/engines/PLAN_ENGINE.md §17.
 *
 * ```text
 * arrival_0     = 0
 * departure_0   = stop_0
 * arrival_(j+1) = departure_j + segment_duration_j
 * departure_(j+1) = arrival_(j+1) + stop_(j+1)
 * ```
 *
 * Tout est en **secondes écoulées depuis le départ effectif** (§5.1). C'est ce
 * qui rend triviaux les cas que les heures calendaires rendent pénibles : une
 * course qui passe minuit, un ultra de plus de 24 h, un changement de date.
 * Rien ne se remet à zéro, parce que rien ne compte en heures.
 *
 * Les dates calendaires sont dérivées à la fin (§5.3), jamais utilisées pour
 * calculer.
 */
export function buildTimeline(
  input: PlanCalculationInput,
  waypoints: readonly PlanWaypointInput[],
  segments: readonly PlanSegmentResult[],
): readonly PlanWaypointResult[] {
  const startMs = Date.parse(input.race.startAt);
  const lockedByWaypoint = new Map(
    input.anchors.map((anchor) => [anchor.waypointId, anchor.arrivalElapsedSeconds]),
  );

  const results: PlanWaypointResult[] = [];
  let arrival = 0;

  for (let index = 0; index < waypoints.length; index += 1) {
    const waypoint = waypoints[index] as PlanWaypointInput;

    if (index > 0) {
      const segment = segments[index - 1] as PlanSegmentResult;
      arrival = arrival + segment.plannedDurationSeconds;
    }

    const stop = stopSeconds(input, waypoint.id);
    const departure = arrival + stop;
    const locked = lockedByWaypoint.get(waypoint.id);

    results.push({
      raceWaypointId: waypoint.id,
      sortOrder: waypoint.sortOrder,
      plannedElapsedSeconds: arrival,
      plannedArrivalAt: toIso(startMs, arrival),
      stopDurationSeconds: stop,
      plannedDepartureElapsedSeconds: departure,
      plannedDepartureAt: toIso(startMs, departure),
      isLocked: locked !== undefined,
      lockedElapsedSeconds: locked ?? null,
    });

    arrival = departure;
  }

  return results;
}

/** §5.3 — `planned_arrival_at = startAt + planned_elapsed_seconds`. */
function toIso(startMs: number, elapsedSeconds: number): string {
  return new Date(startMs + elapsedSeconds * 1000).toISOString();
}
