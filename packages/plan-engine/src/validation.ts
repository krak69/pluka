import type { PlanCalculationInput } from './contracts.js';
import { PlanEngineError, planIssue } from './issues.js';

/**
 * Préconditions bloquantes — docs/engines/PLAN_ENGINE.md §7.
 *
 * Les douze points de §7, dans l'ordre où ils s'y trouvent. Chacun produit une
 * `ERROR` : « une violation structurante produit une ERROR, pas une
 * approximation silencieuse. »
 *
 * Les préconditions 1 à 3 — parcours prétraité, géométrie exploitable, départ
 * et arrivée raccordés — sont vérifiées au prétraitement (§8.1, §9), qui refuse
 * un waypoint hors trace avant que le moteur ne soit appelé. Ce qui est
 * revérifié ici est ce que le moteur peut constater sur son propre snapshot :
 * un appelant qui assemblerait mal l'entrée ne doit pas obtenir un Plan
 * plausible mais faux.
 */
export function validateInput(input: PlanCalculationInput): void {
  const { course } = input;

  if (course.microSegments.length === 0) {
    throw fail('GPX_INVALID', 'aucun micro-segment : le parcours prétraité est vide');
  }

  if (course.waypoints.length < 2) {
    throw fail('GPX_INVALID', 'un parcours a au moins un départ et une arrivée');
  }

  if (course.raceSegments.length === 0) {
    throw fail('GPX_INVALID', 'aucun segment de course : la chaîne est vide');
  }

  // §7.4 — waypoints ordonnés de façon monotone.
  const waypoints = [...course.waypoints].sort((left, right) => left.sortOrder - right.sortOrder);
  for (let index = 1; index < waypoints.length; index += 1) {
    const previous = waypoints[index - 1];
    const current = waypoints[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      current.sortOrder === previous.sortOrder
    ) {
      throw fail('GPX_INVALID', `deux waypoints partagent le rang ${current.sortOrder}`, {
        waypointId: current.id,
      });
    }
  }

  const waypointIds = new Set(waypoints.map((waypoint) => waypoint.id));

  // §7.5 — les RaceSegments forment une chaîne cohérente.
  const segments = [...course.raceSegments].sort((left, right) => left.sortOrder - right.sortOrder);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] as (typeof segments)[number];
    const expectedFrom = waypoints[index];
    const expectedTo = waypoints[index + 1];

    if (expectedFrom === undefined || expectedTo === undefined) {
      throw fail('GPX_INVALID', 'plus de segments que d’intervalles entre waypoints', {
        segmentId: segment.id,
      });
    }

    if (segment.fromWaypointId !== expectedFrom.id || segment.toWaypointId !== expectedTo.id) {
      throw fail(
        'GPX_INVALID',
        `le segment ${segment.id} ne relie pas ${expectedFrom.id} à ${expectedTo.id}`,
        { segmentId: segment.id },
      );
    }
  }

  if (segments.length !== waypoints.length - 1) {
    throw fail('GPX_INVALID', 'la chaîne de segments ne couvre pas tous les waypoints');
  }

  const segmentIds = new Set(segments.map((segment) => segment.id));

  // §7.11 — tout appartient à la même course.
  for (const micro of course.microSegments) {
    if (!segmentIds.has(micro.raceSegmentId)) {
      throw fail(
        'GPX_INVALID',
        `le micro-segment ${micro.id} référence un segment absent du parcours`,
        { segmentId: micro.raceSegmentId },
      );
    }
  }

  // §7.6 — objectif strictement positif.
  if (!Number.isFinite(input.targetDurationSeconds) || input.targetDurationSeconds <= 0) {
    throw fail('TARGET_TOO_SHORT', 'l’objectif doit être strictement positif');
  }

  // §7.7 — stops >= 0.
  for (const stop of input.stops) {
    if (!waypointIds.has(stop.waypointId)) {
      throw fail('GPX_INVALID', `arrêt sur un waypoint absent du parcours`, {
        waypointId: stop.waypointId,
      });
    }
    if (!Number.isFinite(stop.durationSeconds) || stop.durationSeconds < 0) {
      throw fail('GPX_INVALID', 'un arrêt ne peut pas être négatif', {
        waypointId: stop.waypointId,
      });
    }
  }

  // §7.8 — overrides de segment > 0. §20 le répète : « un segment imposé a une
  // durée <= 0 » bloque le calcul.
  for (const override of input.segmentOverrides) {
    if (!segmentIds.has(override.segmentId)) {
      throw fail('GPX_INVALID', 'durée imposée sur un segment absent du parcours', {
        segmentId: override.segmentId,
      });
    }
    if (!Number.isFinite(override.durationSeconds) || override.durationSeconds <= 0) {
      throw fail('FIXED_DURATION_CONFLICT', 'une durée imposée doit être strictement positive', {
        segmentId: override.segmentId,
      });
    }
  }

  // §7.9, §7.10 — ancres ordonnées et temporellement cohérentes.
  for (const anchor of input.anchors) {
    if (!waypointIds.has(anchor.waypointId)) {
      throw fail('GPX_INVALID', 'ancre sur un waypoint absent du parcours', {
        waypointId: anchor.waypointId,
      });
    }
    if (!Number.isFinite(anchor.arrivalElapsedSeconds) || anchor.arrivalElapsedSeconds <= 0) {
      throw fail('ANCHOR_ORDER_CONFLICT', 'une ancre se situe après le départ', {
        waypointId: anchor.waypointId,
      });
    }
  }

  // §7.11 — les barrières aussi appartiennent à cette course.
  for (const cutoff of course.cutoffs) {
    if (!waypointIds.has(cutoff.waypointId)) {
      throw fail('GPX_INVALID', 'barrière sur un waypoint absent du parcours', {
        waypointId: cutoff.waypointId,
      });
    }
  }

  // §7.12 — la version moteur vient du serveur, elle ne peut pas manquer.
  if (input.engineConfig.engineVersion === '') {
    throw fail('GPX_INVALID', 'la version du moteur est obligatoire');
  }

  if (course.preprocessingVersion === '') {
    throw fail('GPX_INVALID', 'la version de prétraitement est obligatoire');
  }

  if (!Number.isFinite(Date.parse(input.race.startAt))) {
    throw fail('GPX_INVALID', 'le départ effectif n’est pas une date valide');
  }
}

function fail(
  code: Parameters<typeof planIssue>[0],
  message: string,
  subject: Parameters<typeof planIssue>[2] = {},
): PlanEngineError {
  return new PlanEngineError(planIssue(code, message, subject));
}
