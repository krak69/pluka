import {
  CHUNKER_VERSION,
  PARSER_VERSION,
  chunkBlocks,
  contentHash,
  isParseError,
  parseSnapshot,
} from '@pluka/sources';

import { formatForStorage, normalizeError, permanent, transient } from '../errors.js';
import type { QueueMessage, WorkerPorts } from '../ports.js';

/**
 * Job `source.parse` — étape 2 de docs/engines/SOURCES_EXTRACTION.md.
 *
 * Le snapshot immuable devient une suite de blocks et de chunks. Aucune
 * extraction de candidats, aucune IA : §29 pose l'ordre, et l'IA de §21
 * travaillera sur ces chunks, jamais sur le fichier d'origine.
 *
 * Le run porte les versions de parseur et de chunker, dans le schéma privé.
 * Deux conséquences, qui sont l'essentiel de ce job :
 *
 * - re-parser un snapshot inchangé avec les mêmes versions ne produit rien de
 *   nouveau — le run existant est rendu tel quel ;
 * - changer une version ouvre un nouveau run, et l'ancien reste consultable :
 *   le changement est traçable, et le snapshot n'a pas bougé.
 */

export const SOURCE_PARSE_QUEUE = 'pluka_sources';

const SOURCES_BUCKET = 'race-sources';

interface ParseJobPayload {
  readonly snapshotId: string;
  readonly storagePath: string;
  readonly contentType: string | null;
  readonly idempotencyKey: string;
}

function readPayload(message: QueueMessage): ParseJobPayload {
  const { snapshotId, storagePath, contentType, idempotencyKey } = message.payload;

  if (
    typeof snapshotId !== 'string' ||
    typeof storagePath !== 'string' ||
    typeof idempotencyKey !== 'string'
  ) {
    throw permanent('PAYLOAD_INVALID', 'charge utile incomplète');
  }

  return {
    snapshotId,
    storagePath,
    contentType: typeof contentType === 'string' ? contentType : null,
    idempotencyKey,
  };
}

export type ParseOutcome =
  | { readonly kind: 'parsed'; readonly runId: string; readonly blockCount: number }
  | { readonly kind: 'already_done'; readonly runId: string }
  | { readonly kind: 'retry'; readonly code: string }
  | { readonly kind: 'abandoned'; readonly code: string };

/** Reconnaît un message de parsing parmi ceux de la file `pluka_sources`. */
export function isParseMessage(message: QueueMessage): boolean {
  return typeof message.payload.snapshotId === 'string';
}

export async function handleParseMessage(
  ports: WorkerPorts,
  message: QueueMessage,
): Promise<ParseOutcome> {
  let payload: ParseJobPayload;

  try {
    payload = readPayload(message);
  } catch (error) {
    const normalized = normalizeError(error);
    ports.logger.error('message de parsing illisible', {
      msgId: message.msgId,
      code: normalized.code,
    });
    return { kind: 'abandoned', code: normalized.code };
  }

  let runId = '';

  try {
    const content = await downloadSnapshot(ports, payload.storagePath);

    // L'empreinte du contenu entre dans le run : elle prouve *sur quoi* le
    // parsing a porté, indépendamment du chemin de stockage.
    const inputHash = contentHash(new TextEncoder().encode(content));

    const run = await ports.parsing.startRun({
      snapshotId: payload.snapshotId,
      parserVersion: PARSER_VERSION,
      chunkerVersion: CHUNKER_VERSION,
      inputHash,
    });

    runId = run.runId;

    if (run.alreadyCompleted) {
      // Snapshot inchangé, versions inchangées : il n'y a rien à refaire, et
      // refaire produirait un second jeu de blocks identique au premier.
      ports.logger.info('parsing déjà effectué', {
        snapshotId: payload.snapshotId,
        runId: run.runId,
        parserVersion: PARSER_VERSION,
      });
      return { kind: 'already_done', runId: run.runId };
    }

    const parsed = parseSnapshot({ content, contentType: payload.contentType });
    const chunks = chunkBlocks(parsed.blocks);

    const blockCount = await ports.parsing.completeRun({
      runId: run.runId,
      snapshotId: payload.snapshotId,
      blocks: parsed.blocks,
      chunks,
      chunkerVersion: CHUNKER_VERSION,
    });

    ports.logger.info('snapshot parsé', {
      snapshotId: payload.snapshotId,
      runId: run.runId,
      blockCount,
      chunkCount: chunks.length,
      parserVersion: PARSER_VERSION,
      chunkerVersion: CHUNKER_VERSION,
      outputHash: parsed.outputHash,
    });

    return { kind: 'parsed', runId: run.runId, blockCount };
  } catch (error) {
    return failRun(ports, payload, runId, error);
  }
}

async function downloadSnapshot(ports: WorkerPorts, storagePath: string): Promise<string> {
  try {
    return await ports.objects.downloadText(SOURCES_BUCKET, storagePath);
  } catch (error) {
    throw transient('STORAGE_UNAVAILABLE', 'snapshot illisible', error);
  }
}

async function failRun(
  ports: WorkerPorts,
  payload: ParseJobPayload,
  runId: string,
  error: unknown,
): Promise<ParseOutcome> {
  // Un document non traitable — PDF sans extracteur, contenu vide, aucun texte
  // exploitable — ne guérira pas au retry. Le distinguer évite d'user cinq
  // tentatives sur un fichier qui restera le même.
  const normalized = isParseError(error)
    ? {
        kind: 'permanent' as const,
        code: error.code,
        message: `parsing refusé (${error.reason})`,
      }
    : normalizeError(error);

  if (runId !== '') {
    // Le run garde la trace de son échec : un snapshot non parsé doit être
    // visible, pas silencieux.
    await ports.parsing.failRun(runId, formatForStorage(normalized)).catch(() => undefined);
  }

  ports.logger.error('parsing en échec', {
    snapshotId: payload.snapshotId,
    code: normalized.code,
    kind: normalized.kind,
  });

  return normalized.kind === 'permanent'
    ? { kind: 'abandoned', code: normalized.code }
    : { kind: 'retry', code: normalized.code };
}
