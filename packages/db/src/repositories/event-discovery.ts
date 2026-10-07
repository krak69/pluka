import { DbError, mapPostgrestError, type PostgrestLikeError } from '../errors.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import { RACE_SOURCES_BUCKET, storageError } from './gpx.js';

/*
 * Repository de la création classique d'un événement, de l'inventaire de son
 * site et de ses documents — migrations 0040, 0042.
 *
 * Chaque opération est une fonction de console qui porte sa garde
 * (administration qui écrit) et son audit. L'inventaire reste du `jsonb` au
 * schéma contrôlé (02_DATA_MODEL §7.10) : il est rendu tel quel, et c'est le
 * domaine qui le lit.
 */

export type EventDiscoveryStatus = 'queued' | 'running' | 'ready' | 'failed';

export interface EventDiscoveryRecord {
  readonly discoveryId: string;
  readonly siteUrl: string;
  readonly finalUrl: string | null;
  readonly status: EventDiscoveryStatus;
  readonly errorCode: string | null;
  readonly pagesRead: number | null;
  readonly inventory: unknown;
}

export interface CreateEventInput {
  readonly event: {
    readonly name: string;
    readonly slug: string;
    readonly organizationId: string | null;
    readonly city: string | null;
    readonly officialWebsiteUrl: string | null;
  };
  readonly edition: {
    readonly year: number;
    readonly slug: string;
    readonly startDate: string;
    readonly endDate: string | null;
  };
  readonly races: readonly {
    readonly name: string;
    readonly slug: string;
    readonly distanceKm: number;
    readonly elevationGainM: number | null;
    readonly startDate: string;
    readonly startTime: string;
    readonly timezone: string;
  }[];
}

export interface EditionDocumentInput {
  readonly url: string;
  readonly title: string;
  readonly kind: 'pdf' | 'page';
  readonly raceId: string | null;
}

export interface EditionFileInput {
  readonly editionId: string;
  readonly title: string;
  readonly contentHash: string;
  readonly bytes: Uint8Array;
  readonly raceId: string | null;
}

export type EditionDocumentState = 'queued' | 'reading' | 'done' | 'failed';

export interface EditionDocument {
  readonly sourceId: string;
  readonly title: string;
  readonly sourceType: string;
  readonly url: string | null;
  readonly uploaded: boolean;
  readonly raceName: string | null;
  readonly state: EditionDocumentState;
  readonly candidateCount: number;
}

export interface EditionDocumentsRecord {
  readonly documents: readonly EditionDocument[];
  readonly pendingByCategory: readonly { readonly category: string; readonly count: number }[];
}

export interface EventDiscoveryRepository {
  /** Événement, édition, épreuves — et l'inventaire du site s'il est donné. Rend l'événement. */
  createEvent(input: CreateEventInput): Promise<string>;
  /** Dernier inventaire du site de l'événement, ou `null`. */
  latestDiscovery(eventId: string): Promise<EventDiscoveryRecord | null>;
  refreshDiscovery(eventId: string): Promise<string>;
  addDocuments(editionId: string, documents: readonly EditionDocumentInput[]): Promise<number>;
  /** Dépose le PDF sous la session — la policy du bucket tranche —, puis déclare la source. */
  addFile(input: EditionFileInput): Promise<string>;
  listDocuments(editionId: string): Promise<EditionDocumentsRecord>;
}

interface RpcCapableClient {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

async function invoke(
  context: RepositoryContext,
  operation: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await (context.client as unknown as RpcCapableClient).rpc(operation, args);
  if (result.error !== null && result.error !== undefined) {
    throw mapPostgrestError(result.error as PostgrestLikeError, operation);
  }
  return result.data;
}

function unexpected(operation: string, message: string): DbError {
  return new DbError({ code: 'unknown', operation, message });
}

function uuidOf(data: unknown, operation: string): string {
  if (typeof data !== 'string') throw unexpected(operation, 'la fonction devait rendre un uuid');
  return data;
}

function objectOf(data: unknown, operation: string): Record<string, unknown> {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw unexpected(operation, 'la fonction devait rendre un objet');
  }
  return data as Record<string, unknown>;
}

function text(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

function count(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  return typeof value === 'number' ? value : 0;
}

function list(row: Record<string, unknown>, key: string): readonly Record<string, unknown>[] {
  const value = row[key];
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

export function editionDocumentStoragePath(editionId: string, contentHash: string): string {
  return `editions/${editionId}/documents/${contentHash}.pdf`;
}

export const eventDiscoveryRepository = defineRepository<EventDiscoveryRepository>((context) => ({
  async createEvent(input) {
    const operation = 'admin_create_event';
    return uuidOf(await invoke(context, operation, { p_payload: input }), operation);
  },

  async latestDiscovery(eventId) {
    const operation = 'admin_get_event_discovery';
    const data = await invoke(context, operation, { p_event_id: eventId });
    if (data === null) return null;
    const row = objectOf(data, operation);

    return {
      discoveryId: text(row, 'discoveryId') ?? '',
      siteUrl: text(row, 'siteUrl') ?? '',
      finalUrl: text(row, 'finalUrl'),
      status: (text(row, 'status') ?? 'queued') as EventDiscoveryStatus,
      errorCode: text(row, 'errorCode'),
      pagesRead: typeof row['pagesRead'] === 'number' ? row['pagesRead'] : null,
      inventory: row['inventory'] ?? null,
    };
  },

  async refreshDiscovery(eventId) {
    const operation = 'admin_refresh_event_discovery';
    return uuidOf(await invoke(context, operation, { p_event_id: eventId }), operation);
  },

  async addDocuments(editionId, documents) {
    const operation = 'admin_add_edition_documents';
    const data = await invoke(context, operation, {
      p_edition_id: editionId,
      p_documents: documents,
    });
    return typeof data === 'number' ? data : 0;
  },

  async addFile(input) {
    const path = editionDocumentStoragePath(input.editionId, input.contentHash);

    const { error } = await context.client.storage
      .from(RACE_SOURCES_BUCKET)
      .upload(path, new Blob([new Uint8Array(input.bytes)], { type: 'application/pdf' }), {
        contentType: 'application/pdf',
        // Le chemin dérive du contenu : le réécrire ne peut produire que le même fichier.
        upsert: true,
      });
    if (error !== null) throw storageError(error, 'edition_document.upload');

    const operation = 'admin_add_edition_file';
    return uuidOf(
      await invoke(context, operation, {
        p_edition_id: input.editionId,
        p_title: input.title,
        p_storage_path: path,
        p_content_hash: input.contentHash,
        p_size_bytes: input.bytes.byteLength,
        p_race_id: input.raceId,
      }),
      operation,
    );
  },

  async listDocuments(editionId) {
    const operation = 'admin_list_edition_documents';
    const row = objectOf(await invoke(context, operation, { p_edition_id: editionId }), operation);

    return {
      documents: list(row, 'documents').map((document) => ({
        sourceId: text(document, 'sourceId') ?? '',
        title: text(document, 'title') ?? '',
        sourceType: text(document, 'sourceType') ?? 'url',
        url: text(document, 'url'),
        uploaded: document['uploaded'] === true,
        raceName: text(document, 'raceName'),
        state: (text(document, 'state') ?? 'queued') as EditionDocumentState,
        candidateCount: count(document, 'candidateCount'),
      })),
      pendingByCategory: list(row, 'pendingByCategory').map((entry) => ({
        category: text(entry, 'category') ?? 'other',
        count: count(entry, 'count'),
      })),
    };
  },
}));

export interface EventDiscoveryRepositories {
  readonly eventDiscovery: EventDiscoveryRepository;
}

export function createEventDiscoveryRepositories(
  context: RepositoryContext,
): EventDiscoveryRepositories {
  return { eventDiscovery: eventDiscoveryRepository(context) };
}
