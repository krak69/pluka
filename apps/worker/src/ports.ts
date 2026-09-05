import type { ProcessedTrack } from '@pluka/gpx';

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
  readonly outbox: OutboxDispatcher;
  readonly logger: Logger;
}
