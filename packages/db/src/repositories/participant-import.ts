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
  /** Ce que l'import fera des lignes valides, calculé comme l'import lui-même. */
  readonly effects: {
    readonly created: number;
    readonly updated: number;
    readonly unchanged: number;
    readonly kept: number;
    readonly withdrawn: number;
  };
  /** Vagues du fichier sans vague de ce nom sur l'épreuve : `shown` s'arrête à 20. */
  readonly unknownWaves: {
    readonly rows: number;
    readonly groups: number;
    readonly shown: readonly {
      readonly raceName: string;
      readonly wave: string;
      readonly rows: number;
    }[];
  };
}

/** Une vague proposée à la correction : officielle, ou apportée par un fichier. */
export interface ParticipantWaveOption {
  readonly raceId: string;
  readonly name: string;
  readonly official: boolean;
}

export interface EditionParticipantRecord {
  readonly id: string;
  readonly raceId: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  /** Nul pour qui n'a pas le rang d'inviter (03_PRIVACY_RLS §28). */
  readonly email: string | null;
  readonly bib: string | null;
  readonly raceName: string;
  readonly waveName: string | null;
  /** Écrite dans le fichier, en attente d'une vague de ce nom sur l'épreuve. */
  readonly declaredWaveName: string | null;
  /** Le même dossard sur plusieurs lignes de cette épreuve. */
  readonly bibConflict: boolean;
  readonly activated: boolean;
}

export interface WithdrawnParticipantRecord {
  readonly id: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly bib: string | null;
  readonly raceName: string;
}

export interface ParticipantImportResult {
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly kept: number;
  readonly withdrawn: number;
}

export interface EditionParticipants {
  readonly total: number;
  /** Sur toute l'édition, même au-delà de la limite de la liste. */
  readonly toCheck: { readonly bibs: number };
  /** Participants dont la vague attend d'être déclarée : une mention, pas une alerte. */
  readonly pendingWaves: number;
  readonly waveOptions: readonly ParticipantWaveOption[];
  readonly participants: readonly EditionParticipantRecord[];
  readonly withdrawn: readonly WithdrawnParticipantRecord[];
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
  commit(importId: string): Promise<ParticipantImportResult>;
  discard(importId: string): Promise<void>;
  listParticipants(editionId: string): Promise<EditionParticipants>;
  correct(participantRaceId: string, bib: string, wave: string): Promise<void>;
  setWithdrawn(participantRaceId: string, withdrawn: boolean): Promise<void>;
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
      })) as ParticipantImportResult;
    },

    async discard(importId) {
      await call(context.client, 'discard_participant_import', { p_import_id: importId });
    },

    async listParticipants(editionId) {
      return (await call(context.client, 'list_edition_participants', {
        p_edition_id: editionId,
      })) as EditionParticipants;
    },

    async correct(participantRaceId, bib, wave) {
      await call(context.client, 'correct_participant_registration', {
        p_participant_race_id: participantRaceId,
        p_bib: bib,
        p_wave: wave,
      });
    },

    async setWithdrawn(participantRaceId, withdrawn) {
      await call(context.client, 'set_participant_withdrawn', {
        p_participant_race_id: participantRaceId,
        p_withdrawn: withdrawn,
      });
    },
  }),
);
