import { isGpxError, processGpx } from '@pluka/gpx';

import { normalizeError, formatForStorage, permanent, transient } from '../errors.js';
import type { QueueMessage, WorkerPorts } from '../ports.js';

/**
 * Job `gpx.process` — 01_ARCHITECTURE §22, §15.
 *
 * Séquence : réclamer le job, télécharger le fichier, le traiter, persister.
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

const SOURCES_BUCKET = 'race-sources';

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

export type JobOutcome =
  | { readonly kind: 'processed'; readonly geometryId: string }
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

    return { kind: 'processed', geometryId };
  } catch (error) {
    return failJob(ports, payload.idempotencyKey, claim.jobId, error);
  }
}

async function downloadGpx(ports: WorkerPorts, storagePath: string): Promise<string> {
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
