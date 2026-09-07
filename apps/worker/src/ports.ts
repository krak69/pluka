import type { AIProvider, EmailProvider } from '@pluka/contracts';
import type { ProcessedTrack } from '@pluka/gpx';
import type { DeclaredWaypoint, PlanMicroSegment, PlanRaceSegmentInput } from '@pluka/plan-engine';
import type { Capture, ExtractedCandidate, ParsedBlock, ParsedChunk } from '@pluka/sources';

import type { NotificationStore } from './ports-notifications.js';

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
  /**
   * Télécharge un objet tel qu'il a été capturé.
   *
   * Un PDF n'est pas du texte : le décoder en UTF-8 le détruirait. Les octets
   * sont aussi ce sur quoi l'empreinte du snapshot a été calculée à l'étape 1,
   * donc la seule forme qui permette de la revérifier.
   */
  downloadBytes(bucket: string, path: string): Promise<Uint8Array>;
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

/**
 * Runs d'extraction — étape 3 de SOURCES_EXTRACTION.
 *
 * L'extraction lit ce que le parsing a persisté, écrit des candidats, et ne
 * touche à aucun fact publié : §25 et §61. Les cinq éléments de traçabilité de
 * §26 — moteur, schéma, prompt, fournisseur, modèle — voyagent avec le run,
 * plus le run de parsing dont il descend.
 */
export interface ParseOutput {
  readonly blocks: readonly ParsedBlock[];
  readonly chunks: readonly ParsedChunk[];
}

export interface ExtractionRunStart {
  readonly parseRunId: string;
  readonly snapshotId: string;
  readonly engineVersion: string;
  readonly schemaVersion: string;
  readonly promptVersion: string;
  /** Nul quand aucune IA n'est configurée : l'extraction reste déterministe. */
  readonly provider: string | null;
  readonly model: string | null;
  readonly inputHash: string;
}

export interface ExtractionRun {
  readonly runId: string;
  /** Vrai si un run identique — même parsing, mêmes versions — existe déjà. */
  readonly alreadyCompleted: boolean;
}

export interface ExtractionRecord {
  readonly runId: string;
  readonly parseRunId: string;
  readonly snapshotId: string;
  readonly candidates: readonly ExtractedCandidate[];
}

export interface ExtractionUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly latencyMs: number;
}

export interface ExtractionStore {
  readParseOutput(parseRunId: string): Promise<ParseOutput>;
  startRun(input: ExtractionRunStart): Promise<ExtractionRun>;
  /** Rend le nombre de candidats écrits, toutes courses confondues. */
  recordCandidates(input: ExtractionRecord): Promise<number>;
  completeRun(
    runId: string,
    usage: ExtractionUsage,
    summary: Readonly<Record<string, unknown>>,
  ): Promise<void>;
  failRun(runId: string, code: string, error: string): Promise<void>;
}

/**
 * Impact Analyzer — §44.
 *
 * Une seule opération, et sa signature dit l'essentiel : un identifiant
 * d'événement entre, un nombre sort. Les données de préparation qui servent à
 * déterminer l'affectation ne franchissent jamais cette frontière
 * (00_PRODUCT_SPEC §37).
 */
export interface ImpactStore {
  /** Rend le nombre d'impacts créés. Rejouer n'en crée aucun de plus. */
  analyze(changeEventId: string): Promise<number>;
}

export type {
  NotificationClaim,
  NotificationResult,
  NotificationStore,
} from './ports-notifications.js';

export interface GeometryStore {
  persist(input: {
    readonly raceId: string;
    readonly sourceSnapshotId: string;
    readonly track: ProcessedTrack;
    readonly idempotencyKey: string;
  }): Promise<string>;
}

/**
 * Prétraitement du parcours — PLAN_ENGINE §8.1, étapes 5 à 9.
 *
 * `readInput` rend le référentiel en une lecture : waypoints à raccorder,
 * chaîne de segments, valeurs officielles pour les contrôles qualité de §9. Les
 * séparer laisserait le prétraitement raisonner sur deux états différents.
 *
 * `persist` remplace l'ensemble des micro-segments d'une géométrie ; `block`
 * les retire et enregistre le motif. §9.1 : un écart au référentiel « produit
 * un état de qualité à résoudre », pas un silence.
 */
export interface CoursePreprocessingInput {
  readonly waypoints: readonly DeclaredWaypoint[];
  readonly segments: readonly PlanRaceSegmentInput[];
  readonly official: {
    readonly distanceMeters: number | null;
    readonly elevationGainMeters: number | null;
  };
}

export interface CoursePreprocessingStore {
  readInput(raceId: string): Promise<CoursePreprocessingInput>;
  /** Rend le nombre de micro-segments écrits. */
  persist(
    courseGeometryId: string,
    preprocessingVersion: string,
    microSegments: readonly PlanMicroSegment[],
  ): Promise<number>;
  block(courseGeometryId: string, issue: string): Promise<void>;
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

/**
 * Fournisseur IA configuré, s'il y en a un.
 *
 * Le modèle accompagne le fournisseur parce que le worker en a besoin *avant*
 * d'appeler quoi que ce soit : §26 fait du couple fournisseur / modèle une
 * partie de l'identité d'un run, donc de sa clé d'idempotence. `AIProvider` ne
 * l'expose pas, et n'a pas à le faire — c'est une donnée de configuration, pas
 * de contrat.
 *
 * Nul quand aucune IA n'est configurée. Ce n'est pas une panne : l'extraction
 * déterministe de §29 fonctionne seule.
 */
export interface ConfiguredAI {
  readonly provider: AIProvider;
  readonly model: string;
}

export interface WorkerPorts {
  readonly queue: Queue;
  readonly jobs: JobStore;
  readonly objects: ObjectStore;
  readonly geometries: GeometryStore;
  readonly coursePreprocessing: CoursePreprocessingStore;
  readonly sources: SourceStore;
  readonly parsing: ParsingStore;
  readonly extraction: ExtractionStore;
  readonly impacts: ImpactStore;
  readonly notifications: NotificationStore;
  /**
   * Fournisseur email, ou son absence.
   *
   * Nul quand rien n'est configuré : §35 veut alors que la livraison reste
   * persistée et soit retentée, pas qu'elle disparaisse.
   */
  readonly email: EmailProvider | null;
  /** Base des liens envoyés au coureur — `APP_URL`, reçue au démarrage. */
  readonly appUrl: string;
  readonly ai: ConfiguredAI | null;
  readonly outbox: OutboxDispatcher;
  readonly logger: Logger;
}
