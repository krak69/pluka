import {
  decideSnapshot,
  describeCapture,
  isAcquisitionError,
  snapshotStoragePath,
  type Capture,
} from '@pluka/sources';

import { formatForStorage, normalizeError, permanent, transient } from '../errors.js';
import type { QueueMessage, WorkerPorts } from '../ports.js';

/**
 * Job `source.ingest` — étape 1 de docs/engines/SOURCES_EXTRACTION.md.
 *
 * Séquence : capturer, dédupliquer, stocker le contenu original, enregistrer
 * la provenance.
 *
 * Ce qui n'y est pas est aussi important que ce qui y est : aucun parsing,
 * aucun chunking, aucune extraction, aucune IA. §29 pose l'ordre —
 * « extraction déterministe avant IA » — et les deux supposent un contenu
 * figé auquel se référer. Ce job produit ce contenu figé, rien de plus.
 *
 * L'ordre des écritures compte : l'objet est stocké **avant** que le snapshot
 * soit enregistré. Un snapshot qui pointerait vers un objet absent serait une
 * citation cassée ; l'inverse — un objet orphelin — n'est qu'un déchet de
 * stockage, rattrapable par balayage.
 */

export const SOURCES_QUEUE = 'pluka_sources';

const SOURCES_BUCKET = 'race-sources';

interface SourceJobPayload {
  readonly sourceId: string;
  readonly url: string | null;
  readonly idempotencyKey: string;
}

function readPayload(message: QueueMessage): SourceJobPayload {
  const { sourceId, url, idempotencyKey } = message.payload;

  if (typeof sourceId !== 'string' || typeof idempotencyKey !== 'string') {
    throw permanent('PAYLOAD_INVALID', 'charge utile incomplète');
  }

  return { sourceId, url: typeof url === 'string' ? url : null, idempotencyKey };
}

export type SourceOutcome =
  | { readonly kind: 'captured'; readonly snapshotId: string }
  | { readonly kind: 'unchanged'; readonly snapshotId: string }
  | { readonly kind: 'retry'; readonly code: string }
  | { readonly kind: 'abandoned'; readonly code: string };

export async function handleSourceMessage(
  ports: WorkerPorts,
  message: QueueMessage,
): Promise<SourceOutcome> {
  let payload: SourceJobPayload;

  try {
    payload = readPayload(message);
  } catch (error) {
    const normalized = normalizeError(error);
    ports.logger.error('message source illisible', { msgId: message.msgId, code: normalized.code });
    return { kind: 'abandoned', code: normalized.code };
  }

  if (payload.url === null) {
    // Une source sans URL est déposée par fichier : sa capture n'est pas un
    // téléchargement, et ce job n'a rien à faire. Ce n'est pas un échec.
    ports.logger.info('source sans URL, capture non applicable', { sourceId: payload.sourceId });
    return { kind: 'abandoned', code: 'NO_URL' };
  }

  try {
    const capture = await ports.sources.fetch(payload.url);
    const provenance = describeCapture(capture);

    // §10 : la déduplication se fait sur l'empreinte, au sein de la source.
    const knownHashes = await ports.sources.knownHashes(payload.sourceId);
    const decision = decideSnapshot(provenance.contentHash, knownHashes);

    const storagePath = snapshotStoragePath(payload.sourceId, provenance.contentHash);

    if (decision.kind === 'create') {
      // Stockage immuable : le chemin dérive de l'empreinte, donc réécrire le
      // même objet écrit les mêmes octets. `upsert` est sans danger ici, et
      // rend l'étape rejouable.
      await storeContent(ports, storagePath, capture);
    }

    const snapshot = await ports.sources.recordSnapshot({
      sourceId: payload.sourceId,
      contentHash: provenance.contentHash,
      storagePath,
      contentType: provenance.contentType,
      sizeBytes: provenance.sizeBytes,
      finalUrl: provenance.finalUrl,
      httpStatus: provenance.httpStatus,
    });

    ports.logger.info(snapshot.created ? 'snapshot créé' : 'contenu inchangé', {
      sourceId: payload.sourceId,
      snapshotId: snapshot.snapshotId,
      sizeBytes: provenance.sizeBytes,
      // Le domaine est journalisé, pas l'URL complète (§32.1 « journaliser le
      // domaine source »).
      host: hostOf(provenance.finalUrl),
      reason: decision.reason,
    });

    return snapshot.created
      ? { kind: 'captured', snapshotId: snapshot.snapshotId }
      : { kind: 'unchanged', snapshotId: snapshot.snapshotId };
  } catch (error) {
    return failJob(ports, payload, error);
  }
}

async function storeContent(
  ports: WorkerPorts,
  storagePath: string,
  capture: Capture,
): Promise<void> {
  try {
    await ports.objects.upload(SOURCES_BUCKET, storagePath, capture.bytes, capture.contentType);
  } catch (error) {
    throw transient('STORAGE_UNAVAILABLE', 'écriture du snapshot impossible', error);
  }
}

function hostOf(url: string | null): string | null {
  if (url === null) return null;

  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function failJob(
  ports: WorkerPorts,
  payload: SourceJobPayload,
  error: unknown,
): Promise<SourceOutcome> {
  // Une URL bloquée par la politique SSRF ne guérira pas ; un délai dépassé,
  // peut-être. Le paquet `@pluka/sources` porte déjà cette distinction.
  const normalized = isAcquisitionError(error)
    ? {
        kind: error.permanent ? ('permanent' as const) : ('transient' as const),
        code: error.code,
        message: error.detail === undefined ? error.code : `${error.code} (${error.detail})`,
      }
    : normalizeError(error);

  await ports.jobs.fail(payload.idempotencyKey, formatForStorage(normalized)).catch(() => null);

  if (normalized.kind === 'permanent') {
    // La source est marquée en erreur : elle ne sera pas reprise, et son état
    // est visible plutôt que silencieux.
    await ports.sources.markFailed(payload.sourceId).catch(() => undefined);
  }

  ports.logger.error('capture en échec', {
    sourceId: payload.sourceId,
    code: normalized.code,
    kind: normalized.kind,
  });

  return normalized.kind === 'permanent'
    ? { kind: 'abandoned', code: normalized.code }
    : { kind: 'retry', code: normalized.code };
}
