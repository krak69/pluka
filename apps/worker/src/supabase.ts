import type { PlukaClient } from '@pluka/db';
import { toEwktLineStringZ } from '@pluka/gpx';
import type { Capture, ParsedBlock, ParsedChunk } from '@pluka/sources';

import { transient } from './errors.js';
import type {
  CoursePreprocessingInput,
  CoursePreprocessingStore,
  ExtractionStore,
  GeometryStore,
  ImpactStore,
  ParsingStore,
  SourceStore,
  JobClaim,
  JobStore,
  Logger,
  ObjectStore,
  OutboxDispatcher,
  Queue,
  QueueMessage,
} from './ports.js';

/**
 * Adaptateurs Supabase des frontières du worker.
 *
 * Le worker est le seul consommateur légitime de la clé de service :
 * 03_PRIVACY_RLS §8 la réserve au worker, aux Server Actions et aux Route
 * Handlers. Il contourne donc la RLS — et reste tenu de vérifier lui-même ce
 * qu'il fait, ce que les fonctions SQL appelées ici assurent de leur côté.
 *
 * Toutes les écritures passent par les fonctions de la migration 0008 : le
 * worker n'assemble aucune écriture multi-tables lui-même, parce qu'il ne
 * pourrait pas les rendre atomiques depuis PostgREST (§31).
 */

/** Les fonctions RPC de 0008 ne sont pas dans les types générés. */
type RpcClient = {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

function rpc(client: PlukaClient): RpcClient {
  return client as unknown as RpcClient;
}

function unwrapRpc(result: { data: unknown; error: unknown }, operation: string): unknown {
  if (result.error !== null && result.error !== undefined) {
    throw transient('DB_UNAVAILABLE', `${operation} a échoué`, result.error);
  }

  return result.data;
}

/**
 * File pgmq.
 *
 * `pgmq.read` rend les messages et les rend invisibles pendant le délai
 * demandé ; `pgmq.archive` les sort définitivement. Ne pas archiver est donc
 * la façon normale de demander un retry.
 */
export function createQueue(client: PlukaClient): Queue {
  return {
    async read(queue, visibilitySeconds, count) {
      const rows = unwrapRpc(
        await rpc(client).rpc('worker_read_queue', {
          p_queue: queue,
          p_visibility_seconds: visibilitySeconds,
          p_count: count,
        }),
        'pgmq.read',
      );

      if (!Array.isArray(rows)) return [];

      return rows.map((row): QueueMessage => {
        const record = row as Record<string, unknown>;
        return {
          msgId: Number(record.msg_id),
          readCount: Number(record.read_ct ?? 0),
          payload: (record.message ?? {}) as Record<string, unknown>,
        };
      });
    },

    async archive(queue, msgId) {
      unwrapRpc(
        await rpc(client).rpc('worker_archive_message', { p_queue: queue, p_msg_id: msgId }),
        'pgmq.archive',
      );
    },
  };
}

export function createJobStore(client: PlukaClient): JobStore {
  return {
    async claim(idempotencyKey) {
      const rows = unwrapRpc(
        await rpc(client).rpc('worker_claim_ingestion_job', { p_idempotency_key: idempotencyKey }),
        'worker_claim_ingestion_job',
      );

      if (!Array.isArray(rows) || rows.length === 0) return null;

      const row = rows[0] as Record<string, unknown>;

      return {
        jobId: String(row.job_id),
        status: String(row.status),
        attempts: Number(row.attempts),
        maxAttempts: Number(row.max_attempts),
      } satisfies JobClaim;
    },

    async fail(idempotencyKey, error) {
      const status = unwrapRpc(
        await rpc(client).rpc('worker_fail_ingestion_job', {
          p_idempotency_key: idempotencyKey,
          p_error: error,
        }),
        'worker_fail_ingestion_job',
      );

      return status === null || status === undefined ? null : String(status);
    },
  };
}

export function createObjectStore(client: PlukaClient): ObjectStore {
  return {
    async downloadText(bucket, path) {
      const { data, error } = await client.storage.from(bucket).download(path);

      if (error !== null || data === null) {
        throw transient('STORAGE_UNAVAILABLE', 'téléchargement impossible', error);
      }

      return data.text();
    },

    async downloadBytes(bucket, path) {
      const { data, error } = await client.storage.from(bucket).download(path);

      if (error !== null || data === null) {
        throw transient('STORAGE_UNAVAILABLE', 'téléchargement impossible', error);
      }

      return new Uint8Array(await data.arrayBuffer());
    },

    async upload(bucket, path, bytes, contentType) {
      const { error } = await client.storage.from(bucket).upload(path, new Blob([bytes]), {
        contentType: contentType ?? 'application/octet-stream',
        // Le chemin dérive de l'empreinte : réécrire écrit les mêmes octets,
        // ce qui rend l'étape rejouable sans conflit.
        upsert: true,
      });

      if (error !== null) {
        throw transient('STORAGE_UNAVAILABLE', 'écriture impossible', error);
      }
    },
  };
}

/**
 * Acquisition de sources — étape 1 de SOURCES_EXTRACTION.
 *
 * `fetchSource` est injecté plutôt qu'importé pour que le test unitaire puisse
 * exercer la décision de déduplication sans réseau.
 */
export function createSourceStore(
  client: PlukaClient,
  fetchSource: (url: string) => Promise<Capture>,
): SourceStore {
  return {
    fetch: fetchSource,

    async knownHashes(sourceId) {
      const rows = unwrapRpc(
        await rpc(client).rpc('worker_source_content_hashes', { p_source_id: sourceId }),
        'worker_source_content_hashes',
      );

      if (!Array.isArray(rows)) return [];

      return rows
        .map((row) => String((row as Record<string, unknown>).content_hash ?? ''))
        .filter((hash) => hash !== '');
    },

    async recordSnapshot(input) {
      const rows = unwrapRpc(
        await rpc(client).rpc('worker_record_source_snapshot', {
          p_source_id: input.sourceId,
          p_content_hash: input.contentHash,
          p_storage_path: input.storagePath,
          p_content_type: input.contentType,
          p_size_bytes: input.sizeBytes,
          p_final_url: input.finalUrl,
          p_http_status: input.httpStatus,
        }),
        'worker_record_source_snapshot',
      );

      const row = (Array.isArray(rows) ? rows[0] : rows) as Record<string, unknown> | undefined;

      if (row === undefined) {
        throw transient('DB_UNAVAILABLE', 'snapshot non enregistré');
      }

      return { snapshotId: String(row.snapshot_id), created: row.created === true };
    },

    async markFailed(sourceId) {
      unwrapRpc(
        await rpc(client).rpc('worker_mark_source_failed', { p_source_id: sourceId }),
        'worker_mark_source_failed',
      );
    },
  };
}

export function createGeometryStore(client: PlukaClient): GeometryStore {
  return {
    async persist({ raceId, sourceSnapshotId, track, idempotencyKey }) {
      const geometryId = unwrapRpc(
        await rpc(client).rpc('worker_persist_race_geometry', {
          p_race_id: raceId,
          p_source_snapshot_id: sourceSnapshotId,
          p_geometry_ewkt: toEwktLineStringZ(track.points),
          p_point_count: track.pointCount,
          // La colonne est `numeric(12,2)` : arrondir ici évite un écart de
          // représentation entre ce qui est calculé et ce qui est relu.
          p_length_m: Number(track.lengthMeters.toFixed(2)),
          p_processor_version: track.processorVersion,
          p_idempotency_key: idempotencyKey,
        }),
        'worker_persist_race_geometry',
      );

      return String(geometryId);
    },
  };
}

/**
 * Prétraitement du parcours — PLAN_ENGINE §8.1, étapes 5 à 9.
 *
 * Les trois opérations passent par les fonctions de 0021, réservées à
 * `service_role`. L'écriture y est un remplacement complet dans une seule
 * transaction : un rejeu de message rend le même ensemble de micro-segments,
 * jamais un second exemplaire (01_ARCHITECTURE §22.1).
 */
export function createCoursePreprocessingStore(client: PlukaClient): CoursePreprocessingStore {
  return {
    async readInput(raceId) {
      const data = unwrapRpc(
        await rpc(client).rpc('worker_course_preprocessing_input', { p_race_id: raceId }),
        'worker_course_preprocessing_input',
      ) as CoursePreprocessingInput | null;

      return (
        data ?? {
          waypoints: [],
          segments: [],
          official: { distanceMeters: null, elevationGainMeters: null },
        }
      );
    },

    async persist(courseGeometryId, preprocessingVersion, microSegments) {
      const written = unwrapRpc(
        await rpc(client).rpc('worker_persist_course_micro_segments', {
          p_course_geometry_id: courseGeometryId,
          p_preprocessing_version: preprocessingVersion,
          // Les colonnes sont `numeric` : arrondir ici évite un écart de
          // représentation entre ce qui est calculé et ce qui est relu.
          p_micro_segments: microSegments.map((micro) => ({
            race_segment_id: micro.raceSegmentId,
            sort_order: micro.sortOrder,
            distance_m: round(micro.distanceMeters, 3),
            elevation_delta_m: round(micro.elevationDeltaMeters, 3),
            elevation_gain_m: round(micro.elevationGainMeters, 3),
            elevation_loss_m: round(micro.elevationLossMeters, 3),
            raw_grade: round(micro.rawGrade, 6),
            model_grade: round(micro.modelGrade, 6),
            progress: round(micro.progress, 8),
            technicality: micro.technicality,
          })),
        }),
        'worker_persist_course_micro_segments',
      );

      return Number(written);
    },

    async block(courseGeometryId, issue) {
      unwrapRpc(
        await rpc(client).rpc('worker_block_course_preprocessing', {
          p_course_geometry_id: courseGeometryId,
          p_issue: issue,
        }),
        'worker_block_course_preprocessing',
      );
    },
  };
}

/** Arrondi à la précision de la colonne, pour que relire rende ce qu'on a écrit. */
function round(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

export function createOutboxDispatcher(client: PlukaClient): OutboxDispatcher {
  return {
    async dispatch(limit) {
      const dispatched = unwrapRpc(
        await rpc(client).rpc('worker_dispatch_outbox', { p_limit: limit }),
        'worker_dispatch_outbox',
      );

      return Number(dispatched ?? 0);
    },
  };
}

/**
 * Journalisation structurée — 01_ARCHITECTURE §34.2.
 *
 * Une ligne JSON par événement, sans donnée personnelle : ni email, ni
 * contenu de fichier, ni requête (03_PRIVACY_RLS §130).
 */
export function createLogger(): Logger {
  function emit(level: string, message: string, context?: Record<string, unknown>): void {
    const line = JSON.stringify({
      level,
      message,
      ...(context ?? {}),
      at: new Date().toISOString(),
    });

    if (level === 'error') console.error(line);
    else console.log(line);
  }

  return {
    info: (message, context) => emit('info', message, context),
    warn: (message, context) => emit('warn', message, context),
    error: (message, context) => emit('error', message, context),
  };
}

/**
 * Runs de parsing — étape 2.
 *
 * Toutes les écritures passent par `worker_complete_parse_run` : blocks,
 * chunks, liens et clôture du run doivent réussir ensemble (§31), ce que
 * PostgREST ne saurait pas orchestrer en plusieurs appels.
 */
export function createParsingStore(client: PlukaClient): ParsingStore {
  return {
    async startRun(input) {
      const rows = unwrapRpc(
        await rpc(client).rpc('worker_start_parse_run', {
          p_snapshot_id: input.snapshotId,
          p_parser_version: input.parserVersion,
          p_chunker_version: input.chunkerVersion,
          p_input_hash: input.inputHash,
        }),
        'worker_start_parse_run',
      );

      const row = (Array.isArray(rows) ? rows[0] : rows) as Record<string, unknown> | undefined;

      if (row === undefined) throw transient('DB_UNAVAILABLE', 'run non ouvert');

      return { runId: String(row.run_id), alreadyCompleted: row.already_completed === true };
    },

    async completeRun(result) {
      const count = unwrapRpc(
        await rpc(client).rpc('worker_complete_parse_run', {
          p_run_id: result.runId,
          p_snapshot_id: result.snapshotId,
          p_blocks: result.blocks,
          p_chunks: result.chunks,
          p_chunker_version: result.chunkerVersion,
        }),
        'worker_complete_parse_run',
      );

      return Number(count ?? 0);
    },

    async failRun(runId, error) {
      unwrapRpc(
        await rpc(client).rpc('worker_fail_parse_run', { p_run_id: runId, p_error: error }),
        'worker_fail_parse_run',
      );
    },
  };
}

/**
 * Runs d'extraction — étape 3.
 *
 * Comme pour le parsing, tout passe par des fonctions SQL : candidats, preuves
 * et clôture du run doivent réussir ensemble (§31). Aucune de ces fonctions
 * n'écrit dans `race_facts` — un candidat est une proposition (§25).
 */
export function createExtractionStore(client: PlukaClient): ExtractionStore {
  return {
    async readParseOutput(parseRunId) {
      const rows = unwrapRpc(
        await rpc(client).rpc('worker_read_parse_output', { p_parse_run_id: parseRunId }),
        'worker_read_parse_output',
      );

      const row = (Array.isArray(rows) ? rows[0] : rows) as Record<string, unknown> | undefined;

      return {
        blocks: (row?.blocks ?? []) as ParsedBlock[],
        chunks: (row?.chunks ?? []) as ParsedChunk[],
      };
    },

    async startRun(input) {
      const rows = unwrapRpc(
        await rpc(client).rpc('worker_start_extraction_run', {
          p_parse_run_id: input.parseRunId,
          p_snapshot_id: input.snapshotId,
          p_engine_version: input.engineVersion,
          p_schema_version: input.schemaVersion,
          p_prompt_version: input.promptVersion,
          p_provider: input.provider,
          p_model: input.model,
          p_input_hash: input.inputHash,
        }),
        'worker_start_extraction_run',
      );

      const row = (Array.isArray(rows) ? rows[0] : rows) as Record<string, unknown> | undefined;

      if (row === undefined) throw transient('DB_UNAVAILABLE', "run d'extraction non ouvert");

      return { runId: String(row.run_id), alreadyCompleted: row.already_completed === true };
    },

    async recordCandidates(input) {
      const count = unwrapRpc(
        await rpc(client).rpc('worker_record_fact_candidates', {
          p_run_id: input.runId,
          p_parse_run_id: input.parseRunId,
          p_snapshot_id: input.snapshotId,
          p_candidates: input.candidates,
        }),
        'worker_record_fact_candidates',
      );

      return Number(count ?? 0);
    },

    async completeRun(runId, usage, summary) {
      unwrapRpc(
        await rpc(client).rpc('worker_complete_extraction_run', {
          p_run_id: runId,
          p_input_tokens: usage.inputTokens,
          p_output_tokens: usage.outputTokens,
          p_latency_ms: usage.latencyMs,
          p_output_json: summary,
        }),
        'worker_complete_extraction_run',
      );
    },

    async failRun(runId, code, error) {
      unwrapRpc(
        await rpc(client).rpc('worker_fail_extraction_run', {
          p_run_id: runId,
          p_error_code: code,
          p_error: error,
        }),
        'worker_fail_extraction_run',
      );
    },
  };
}

/**
 * Impact Analyzer — §44.
 *
 * L'analyse entière est une fonction SQL : c'est ce qui garantit que les
 * données de préparation servant à déterminer l'affectation ne quittent jamais
 * la base (00_PRODUCT_SPEC §37, 03_PRIVACY_RLS §35).
 */
export function createImpactStore(client: PlukaClient): ImpactStore {
  return {
    async analyze(changeEventId) {
      const created = unwrapRpc(
        await rpc(client).rpc('worker_analyze_change_impact', {
          p_change_event_id: changeEventId,
        }),
        'worker_analyze_change_impact',
      );

      return Number(created ?? 0);
    },
  };
}
