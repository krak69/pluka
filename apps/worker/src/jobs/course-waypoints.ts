import { processGpx } from '@pluka/gpx';

import { normalizeError, permanent } from '../errors.js';
import type { QueueMessage, WorkerPorts } from '../ports.js';
import { downloadGpx, preprocessCourseGeometry, type PreprocessingOutcome } from './gpx-process.js';

/**
 * Job `course.waypoints.changed` — PLAN_ENGINE §8, §8.1.
 *
 * Le prétraitement d'un parcours dépend de deux choses : une trace, et un
 * référentiel de waypoints. `gpx.process` couvre le cas où la trace arrive en
 * dernier ; celui-ci couvre l'autre, et le worker l'annonçait déjà — « un GPX
 * déposé avant ses waypoints est un ordre d'import légitime […] le
 * prétraitement reste `pending` et attend que quelqu'un le relance ».
 *
 * C'est cette relance. Elle ne crée aucune version de géométrie : la trace
 * n'a pas changé, seul son découpage change. Le job repart donc du fichier —
 * 0008 ne persiste pas la trace normalisée point par point — et réécrit les
 * micro-segments de la géométrie courante.
 *
 * Rejouer un message est sans conséquence : `persist_course_micro_segments`
 * remplace l'ensemble plutôt que d'y ajouter (§22.1), et `processGpx` est une
 * fonction pure — le même fichier rend exactement la même trace.
 *
 * Cette pureté est aussi ce qui permet le rattrapage de 0027. Une géométrie
 * persistée avant 0026 n'a pas de dénivelé mesuré, et redéposer le même GPX ne
 * relancerait rien — le job est `completed`, et l'idempotence par empreinte
 * refuse un doublon. Le job repasse déjà le fichier dans `processGpx` : la
 * mesure est là, il n'y a qu'à la déposer où elle manque.
 */

export const COURSE_QUEUE = 'pluka_geo';

interface CourseWaypointsPayload {
  readonly raceId: string;
}

/**
 * Reconnaît une relance de prétraitement.
 *
 * La file `pluka_geo` porte aussi les imports GPX : le routage se fait sur le
 * type d'événement, que `set_race_waypoints` écrit dans la charge utile.
 */
export function isCourseWaypointsMessage(message: QueueMessage): boolean {
  return message.payload.eventType === 'course.waypoints.changed';
}

function readPayload(message: QueueMessage): CourseWaypointsPayload {
  const { raceId } = message.payload;

  if (typeof raceId !== 'string') {
    throw permanent('PAYLOAD_INVALID', 'charge utile sans épreuve');
  }

  return { raceId };
}

export type CourseWaypointsOutcome =
  | { readonly kind: 'preprocessed'; readonly preprocessing: PreprocessingOutcome }
  | { readonly kind: 'skipped'; readonly reason: string }
  | { readonly kind: 'retry'; readonly code: string }
  | { readonly kind: 'abandoned'; readonly code: string };

export async function handleCourseWaypointsMessage(
  ports: WorkerPorts,
  message: QueueMessage,
): Promise<CourseWaypointsOutcome> {
  let payload: CourseWaypointsPayload;

  try {
    payload = readPayload(message);
  } catch (error) {
    const normalized = normalizeError(error);
    ports.logger.error('message de référentiel illisible', {
      msgId: message.msgId,
      code: normalized.code,
    });
    return { kind: 'abandoned', code: normalized.code };
  }

  const source = await ports.coursePreprocessing.findCourseSource(payload.raceId);

  if (source === null) {
    // Le référentiel est prêt, la trace non. L'import GPX prétraitera de
    // lui-même quand il arrivera : il n'y a rien à réessayer ici.
    ports.logger.info('référentiel enregistré, aucune géométrie à prétraiter', {
      raceId: payload.raceId,
    });
    return { kind: 'skipped', reason: 'NO_GEOMETRY' };
  }

  try {
    const track = processGpx(await downloadGpx(ports, source.storagePath));

    // Rattrapage de 0027, avant le prétraitement : le dénivelé est un fait de
    // la trace, il ne dépend ni du référentiel ni de l'issue du découpage.
    if (source.needsElevation) {
      const filled = await ports.geometries.backfillElevation(
        source.courseGeometryId,
        Math.round(track.elevationGainMeters),
        Math.round(track.elevationLossMeters),
      );

      if (filled) {
        ports.logger.info('dénivelé mesuré comblé sur une géométrie d’avant 0026', {
          raceId: payload.raceId,
          geometryId: source.courseGeometryId,
          elevationGainM: Math.round(track.elevationGainMeters),
          elevationLossM: Math.round(track.elevationLossMeters),
        });
      }
    }

    const preprocessing = await preprocessCourseGeometry(
      ports,
      payload.raceId,
      source.courseGeometryId,
      track,
    );

    ports.logger.info('prétraitement relancé après changement de référentiel', {
      raceId: payload.raceId,
      geometryId: source.courseGeometryId,
      outcome: preprocessing.kind,
    });

    return { kind: 'preprocessed', preprocessing };
  } catch (error) {
    const normalized = normalizeError(error);

    ports.logger.error('relance du prétraitement en échec', {
      raceId: payload.raceId,
      code: normalized.code,
      kind: normalized.kind,
    });

    // Aucun job d'ingestion à clore : la relance n'en ouvre pas. Le message
    // revient tant que la cause est transitoire, et part sinon.
    return normalized.kind === 'permanent'
      ? { kind: 'abandoned', code: normalized.code }
      : { kind: 'retry', code: normalized.code };
  }
}
