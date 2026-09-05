import type { ProcessedTrack } from '@pluka/gpx';
import type { Capture, ParsedBlock, ParsedChunk } from '@pluka/sources';

/**
 * Frontières du worker.
 *
 * Le worker fait de l'I/O — c'est sa raison d'être — mais la logique de
 * traitement d'un job ne doit pas en dépendre pour être testée. Ces interfaces
 * séparent « ce que le job décide » de « comment on parle à Postgres et au
 * stockage », ce qui permet de tester l'idempotence, le compteur de tentatives
 * et la normalisation d'erreur sans base ni réseau.
 *
 * Les adaptateurs réels vivent dans `supabase.ts`.
 */

/** Message tel que pgmq le rend. */
export interface QueueMessage {
  readonly msgId: number;
  readonly readCount: number;
  readonly payload: Record<string, unknown>;
}

export interface Queue {
  /** Lit jusqu'à `count` messages, invisibles pendant `visibilitySeconds`. */
  read(queue: string, visibilitySeconds: number, count: number): Promise<readonly QueueMessage[]>;
  /** Retire définitivement un message traité. */
  archive(queue: string, msgId: number): Promise<void>;
}

export interface JobClaim {
  readonly jobId: string;
  readonly status: string;
  readonly attempts: number;
  readonly maxAttempts: number;
}

export interface JobStore {
  /** Passe le job en `running` et incrémente les tentatives. Rend `null` si inconnu. */
  claim(idempotencyKey: string): Promise<JobClaim | null>;
  /** Enregistre l'échec ; rend le statut résultant (`queued` ou `failed`). */
  fail(idempotencyKey: string, error: string): Promise<string | null>;
}

export interface ObjectStore {
  /** Télécharge un objet sous forme de texte. */
  downloadText(bucket: string, path: string): Promise<string>;
  /** Écrit un objet. Le chemin dérivant de l'empreinte, réécrire écrit les mêmes octets. */
  upload(
    bucket: string,
    path: string,
    bytes: Uint8Array,
    contentType: string | null,
  ): Promise<void>;
}

/**
 * Acquisition de sources — étape 1 de SOURCES_EXTRACTION.
 *
 * `fetch` fait l'I/O réseau sous politique SSRF ; `knownHashes` alimente la
 * décision de déduplication ; `recordSnapshot` écrit le snapshot immuable.
 */
export interface SnapshotInput {
  readonly sourceId: string;
  readonly contentHash: string;
  readonly storagePath: string;
  readonly contentType: string | null;
  readonly sizeBytes: number;
  readonly finalUrl: string | null;
  readonly httpStatus: number | null;
}

export interface RecordedSnapshot {
  readonly snapshotId: string;
  /** Faux lorsque le contenu était déjà connu : aucun snapshot n'a été ajouté. */
  readonly created: boolean;
}

export interface SourceStore {
  fetch(url: string): Promise<Capture>;
  knownHashes(sourceId: string): Promise<readonly string[]>;
  recordSnapshot(input: SnapshotInput): Promise<RecordedSnapshot>;
  markFailed(sourceId: string): Promise<void>;
}

/**
 * Runs de parsing — étape 2 de SOURCES_EXTRACTION.
 *
 * Les versions de parseur et de chunker vivent dans le schéma privé, avec le
 * run : le snapshot reste immuable, et re-parser crée un run, jamais une
 * modification du contenu capturé.
 */
export interface ParseRunStart {
  readonly snapshotId: string;
  readonly parserVersion: string;
  readonly chunkerVersion: string;
  readonly inputHash: string;
}

export interface ParseRun {
  readonly runId: string;
  /** Vrai si un run identique — mêmes versions, même snapshot — existe déjà. */
  readonly alreadyCompleted: boolean;
}

export interface ParseRunResult {
  readonly runId: string;
  readonly snapshotId: string;
  readonly blocks: readonly ParsedBlock[];
  readonly chunks: readonly ParsedChunk[];
  readonly chunkerVersion: string;
}

export interface ParsingStore {
  startRun(input: ParseRunStart): Promise<ParseRun>;
  /** Rend le nombre de blocks écrits. */
  completeRun(result: ParseRunResult): Promise<number>;
  failRun(runId: string, error: string): Promise<void>;
}

export interface GeometryStore {
  persist(input: {
    readonly raceId: string;
    readonly sourceSnapshotId: string;
    readonly track: ProcessedTrack;
    readonly idempotencyKey: string;
  }): Promise<string>;
}

export interface OutboxDispatcher {
  /** Traduit les événements en attente en messages de file. Rend le nombre traité. */
  dispatch(limit: number): Promise<number>;
}

export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface WorkerPorts {
  readonly queue: Queue;
  readonly jobs: JobStore;
  readonly objects: ObjectStore;
  readonly geometries: GeometryStore;
  readonly sources: SourceStore;
  readonly parsing: ParsingStore;
  readonly outbox: OutboxDispatcher;
  readonly logger: Logger;
}
