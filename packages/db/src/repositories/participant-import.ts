import { mapPostgrestError, type PostgrestLikeError } from '../errors.js';
import { defineRepository } from '../repository.js';
import type { PlukaClient } from '../types.js';

/*
 * L'import d'une liste de participants — migration 0060.
 *
 * Tout passe par des fonctions SQL sous la session du membre : elles gardent le
 * rôle (owner, admin) et construisent ce qui sort. La liste n'est pas une
 * lecture de table : elle ne porte ni compte, ni préparation, ni signal.
 */

export interface ParticipantImportView {
  readonly id: string;
  readonly editionId: string;
  readonly status: 'uploaded' | 'mapping' | 'validating' | 'imported' | 'failed';
  readonly fileName: string | null;
  readonly headers: readonly string[];
  readonly columns: Readonly<Record<string, string>>;
  readonly rows: readonly {
    readonly rowNumber: number;
    readonly data: Readonly<Record<string, string>>;
  }[];
  readonly counts: Readonly<Record<string, number>>;
  readonly exceptions: readonly {
    readonly rowNumber: number;
    readonly status: string;
    readonly message: string;
  }[];
}

export interface EditionParticipantRecord {
  readonly id: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  /** Nul pour qui n'a pas le rang d'inviter (03_PRIVACY_RLS §28). */
  readonly email: string | null;
  readonly bib: string | null;
  readonly raceName: string;
  readonly waveName: string | null;
  readonly activated: boolean;
}

export interface EditionParticipants {
  readonly total: number;
  readonly participants: readonly EditionParticipantRecord[];
}

export interface ParticipantImportRepository {
  create(
    editionId: string,
    fileName: string,
    headers: readonly string[],
    rows: readonly Readonly<Record<string, string>>[],
  ): Promise<string>;
  find(importId: string): Promise<ParticipantImportView>;
  validate(
    importId: string,
    columns: Readonly<Record<string, string>>,
    rows: readonly unknown[],
  ): Promise<void>;
  commit(importId: string): Promise<{ readonly created: number; readonly skipped: number }>;
  discard(importId: string): Promise<void>;
  listParticipants(editionId: string): Promise<EditionParticipants>;
}

interface RpcCapableClient {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

async function call(client: PlukaClient, operation: string, args: Record<string, unknown>) {
  const result = await (client as unknown as RpcCapableClient).rpc(operation, args);
  if (result.error !== null && result.error !== undefined) {
    throw mapPostgrestError(result.error as PostgrestLikeError, operation);
  }
  return result.data;
}

export const participantImportRepository = defineRepository<ParticipantImportRepository>(
  (context) => ({
    async create(editionId, fileName, headers, rows) {
      return (await call(context.client, 'create_participant_import', {
        p_edition_id: editionId,
        p_file_name: fileName,
        p_headers: headers,
        p_rows: rows,
      })) as string;
    },

    async find(importId) {
      return (await call(context.client, 'get_participant_import', {
        p_import_id: importId,
      })) as ParticipantImportView;
    },

    async validate(importId, columns, rows) {
      await call(context.client, 'validate_participant_import', {
        p_import_id: importId,
        p_mapping: columns,
        p_rows: rows,
      });
    },

    async commit(importId) {
      return (await call(context.client, 'commit_participant_import', {
        p_import_id: importId,
      })) as { created: number; skipped: number };
    },

    async discard(importId) {
      await call(context.client, 'discard_participant_import', { p_import_id: importId });
    },

    async listParticipants(editionId) {
      return (await call(context.client, 'list_edition_participants', {
        p_edition_id: editionId,
      })) as EditionParticipants;
    },
  }),
);
