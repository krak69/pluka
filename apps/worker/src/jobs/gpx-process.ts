import { isGpxError, processGpx, type ProcessedTrack } from '@pluka/gpx';
import {
  PLAN_ENGINE_V1,
  PlanEngineError,
  preprocessCourse,
  snapWaypointsToTrack,
} from '@pluka/plan-engine';

import { normalizeError, formatForStorage, permanent, transient } from '../errors.js';
import type { QueueMessage, WorkerPorts } from '../ports.js';

/**
 * Job `gpx.process` — 01_ARCHITECTURE §22, §15, PLAN_ENGINE §8.
 *
 * Séquence : réclamer le job, télécharger le fichier, le traiter, persister la
 * géométrie, puis en tirer le prétraitement du parcours.
 *
 * Les deux moitiés ne sont pas au même niveau. La géométrie est le fait brut :
 * elle vaut par elle-même, et rien ne doit l'empêcher d'être enregistrée. Le
 * prétraitement en dérive, et dépend d'un référentiel — waypoints, segments —
 * qui peut manquer ou être faux au moment de l'import. Un parcours dont un
 * ravito est pointé à 300 m de la trace produit donc une géométrie valide et un
 * prétraitement bloqué, jamais un job en échec (§9, §9.1).
 *
 * Tout l'enjeu est dans les cas non nominaux, et §22.1 les nomme : « un retry
 * ne doit pas [...] créer deux versions identiques ». Trois mécanismes s'y
 * emploient, à trois niveaux :
 *
 * 1. le job est réclamé par sa clé d'idempotence — un job `completed` est
 *    reconnu tel quel et le message est simplement archivé ;
 * 2. `private.persist_race_geometry` rend la géométrie existante plutôt que
 *    d'en créer une seconde ;
 * 3. un échec permanent — GPX invalide — n'est pas réessayé.
 *
 * Un message pgmq revient forcément un jour : le processus peut mourir entre
 * la persistance et l'archivage. C'est le cas normal, pas l'exception.
 */

export const GPX_QUEUE = 'pluka_geo';

/** Charge utile attendue, telle que `enqueue_race_gpx` la construit. */
interface GpxJobPayload {
  readonly raceId: string;
  readonly sourceSnapshotId: string;
  readonly storagePath: string;
  readonly idempotencyKey: string;
}

export const SOURCES_BUCKET = 'race-sources';

function readPayload(message: QueueMessage): GpxJobPayload {
  const { raceId, sourceSnapshotId, storagePath, idempotencyKey } = message.payload;

  if (
    typeof raceId !== 'string' ||
    typeof sourceSnapshotId !== 'string' ||
    typeof storagePath !== 'string' ||
    typeof idempotencyKey !== 'string'
  ) {
    // Un message malformé ne guérira pas au retry : il est permanent.
    throw permanent('PAYLOAD_INVALID', 'charge utile incomplète');
  }

  return { raceId, sourceSnapshotId, storagePath, idempotencyKey };
}

/** Ce que le prétraitement a produit, ou pourquoi il n'a rien produit. */
export type PreprocessingOutcome =
  | { readonly kind: 'completed'; readonly microSegmentCount: number }
  | { readonly kind: 'skipped'; readonly reason: string }
  | { readonly kind: 'blocked'; readonly code: string };

export type JobOutcome =
  | {
      readonly kind: 'processed';
      readonly geometryId: string;
      readonly preprocessing: PreprocessingOutcome;
    }
  | { readonly kind: 'already_done' }
  | { readonly kind: 'retry'; readonly code: string }
  | { readonly kind: 'abandoned'; readonly code: string };

/**
 * Traite un message.
 *
 * Rend un verdict plutôt que de lever : c'est la boucle qui décide d'archiver
 * ou de laisser le message revenir, et elle a besoin de connaître la nuance
 * entre « à réessayer » et « abandonné ».
 */
export async function handleGpxMessage(
  ports: WorkerPorts,
  message: QueueMessage,
): Promise<JobOutcome> {
  let payload: GpxJobPayload;

  try {
    payload = readPayload(message);
  } catch (error) {
    const normalized = normalizeError(error);
    ports.logger.error('message gpx illisible', { msgId: message.msgId, code: normalized.code });
    return { kind: 'abandoned', code: normalized.code };
  }

  const claim = await ports.jobs.claim(payload.idempotencyKey);

  if (claim === null) {
    // Aucun job pour cette clé : l'événement a été enfilé sans son job, ou le
    // job a été purgé. Réessayer ne le fera pas apparaître.
    ports.logger.warn('aucun job pour cette clé', { msgId: message.msgId });
    return { kind: 'abandoned', code: 'JOB_UNKNOWN' };
  }

  if (claim.status === 'completed') {
    // Le travail est déjà fait : le message est un revenant, pas une demande.
    ports.logger.info('job déjà terminé, message archivé', { jobId: claim.jobId });
    return { kind: 'already_done' };
  }

  try {
    const content = await downloadGpx(ports, payload.storagePath);
    const track = processGpx(content);

    const geometryId = await ports.geometries.persist({
      raceId: payload.raceId,
      sourceSnapshotId: payload.sourceSnapshotId,
      track,
      idempotencyKey: payload.idempotencyKey,
    });

    ports.logger.info('géométrie persistée', {
      jobId: claim.jobId,
      geometryId,
      pointCount: track.pointCount,
      lengthMeters: Math.round(track.lengthMeters),
      eligibleForReliefModel: track.quality.eligibleForReliefModel,
    });

    const preprocessing = await preprocessCourseGeometry(ports, payload.raceId, geometryId, track);

    return { kind: 'processed', geometryId, preprocessing };
  } catch (error) {
    return failJob(ports, payload.idempotencyKey, claim.jobId, error);
  }
}

export async function downloadGpx(ports: WorkerPorts, storagePath: string): Promise<string> {
  try {
    return await ports.objects.downloadText(SOURCES_BUCKET, storagePath);
  } catch (error) {
    // Le stockage peut être momentanément indisponible : transitoire.
    throw transient('STORAGE_UNAVAILABLE', 'fichier illisible depuis le stockage', error);
  }
}

async function failJob(
  ports: WorkerPorts,
  idempotencyKey: string,
  jobId: string,
  error: unknown,
): Promise<JobOutcome> {
  // Un GPX invalide est définitif : le même fichier produira la même erreur à
  // chaque tentative. Le distinguer évite d'user cinq tentatives pour rien.
  const normalized = isGpxError(error)
    ? { kind: 'permanent' as const, code: error.code, message: `parsing refusé (${error.reason})` }
    : normalizeError(error);

  const status = await ports.jobs.fail(idempotencyKey, formatForStorage(normalized));

  ports.logger.error('job en échec', {
    jobId,
    code: normalized.code,
    kind: normalized.kind,
    status,
  });

  // Permanent, ou tentatives épuisées : on archive le message pour qu'il ne
  // revienne pas indéfiniment.
  if (normalized.kind === 'permanent' || status === 'failed') {
    return { kind: 'abandoned', code: normalized.code };
  }

  return { kind: 'retry', code: normalized.code };
}

/**
 * Prétraitement du parcours — PLAN_ENGINE §8.1, étapes 5 à 9.
 *
 * Il tourne ici, à l'import, et une seule fois : §8, « le prétraitement GPX est
 * effectué lors de l'import / validation du parcours, pas à chaque recalcul du
 * Plan », et §62 le répète pour l'implémentation.
 *
 * Trois issues, et aucune ne fait échouer le job.
 *
 * - `completed` : les micro-segments remplacent ceux de cette géométrie.
 * - `skipped` : le référentiel n'est pas encore là. Un GPX déposé avant ses
 *   waypoints est un ordre d'import légitime, pas une erreur ; le prétraitement
 *   reste `pending` et attend que quelqu'un le relance.
 * - `blocked` : le référentiel est là mais incohérent — waypoint à plus de
 *   200 m de la trace, segment qui ne couvre aucune distance. §9 conclut
 *   « erreur / validation requise **avant Plan** », et §9.1 veut « un état de
 *   qualité à résoudre » : la géométrie est conservée, les micro-segments
 *   retirés, le motif enregistré.
 *
 * Faire échouer le job dans le troisième cas ferait perdre la trace elle-même,
 * et cinq tentatives n'y changeraient rien : le problème est dans le
 * référentiel, pas dans le fichier.
 */
export async function preprocessCourseGeometry(
  ports: WorkerPorts,
  raceId: string,
  geometryId: string,
  track: ProcessedTrack,
): Promise<PreprocessingOutcome> {
  const referential = await ports.coursePreprocessing.readInput(raceId);

  if (referential.waypoints.length < 2 || referential.segments.length === 0) {
    const reason = 'REFERENTIAL_INCOMPLETE';
    ports.logger.warn('prétraitement différé : parcours sans waypoints ni segments', {
      geometryId,
      waypointCount: referential.waypoints.length,
      segmentCount: referential.segments.length,
    });

    return { kind: 'skipped', reason };
  }

  try {
    // §8.1, étape 9 : les waypoints sont raccordés à la trace réelle, et c'est
    // l'abscisse mesurée qui fait foi — pas la distance officielle annoncée.
    const snapped = snapWaypointsToTrack(
      track.points.map((point) => ({
        latitude: point.latitude,
        longitude: point.longitude,
        distanceMeters: point.distanceMeters,
      })),
      referential.waypoints,
    );

    const course = preprocessCourse({
      points: track.points.map((point) => ({
        distanceMeters: point.distanceMeters,
        elevationMeters: point.elevationMeters,
      })),
      waypoints: snapped,
      raceSegments: referential.segments,
      official: {
        ...(referential.official.distanceMeters === null
          ? {}
          : { distanceMeters: referential.official.distanceMeters }),
        ...(referential.official.elevationGainMeters === null
          ? {}
          : { elevationGainMeters: referential.official.elevationGainMeters }),
      },
      config: PLAN_ENGINE_V1,
    });

    const written = await ports.coursePreprocessing.persist(
      geometryId,
      course.preprocessingVersion,
      course.microSegments,
    );

    // §9.1 : les écarts au référentiel officiel sont constatés, jamais
    // corrigés. Ils sortent en logs — un fait de course, sans donnée
    // personnelle (§60).
    for (const warning of course.warnings) {
      ports.logger.warn('qualité de parcours', {
        geometryId,
        code: warning.code,
        message: warning.message,
      });
    }

    ports.logger.info('parcours prétraité', {
      geometryId,
      microSegmentCount: written,
      preprocessingVersion: course.preprocessingVersion,
      resampledPointCount: course.resampledPointCount,
    });

    return { kind: 'completed', microSegmentCount: written };
  } catch (error) {
    if (!(error instanceof PlanEngineError)) throw error;

    await ports.coursePreprocessing.block(geometryId, error.issue.message);

    ports.logger.warn('prétraitement bloqué : état de qualité à résoudre', {
      geometryId,
      code: error.issue.code,
      waypointId: error.issue.waypointId,
      segmentId: error.issue.segmentId,
    });

    return { kind: 'blocked', code: error.issue.code };
  }
}
