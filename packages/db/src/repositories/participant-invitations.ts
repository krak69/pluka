import { DbError, mapPostgrestError, type PostgrestLikeError } from '../errors.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrapMaybe } from '../results.js';
import type { Enum, PlukaClient } from '../types.js';

/*
 * Repository des invitations de participants — migration 0069.
 *
 * Chaque fonction SQL porte sa garde (owner ou admin de l'organisation, ou
 * PLUKA) et la relit dans le jeton : ce repository ne décide rien. Le jeton
 * d'invitation n'y entre qu'haché, par le domaine.
 */

export type ParticipantInvitationStatus = Enum<'invitation_status'>;

/**
 * Adoption d'une épreuve (0080) : des compteurs, jamais une ligne par coureur.
 * Les trois chiffres de préparation sont nuls sous 10 activés (§70).
 */
export interface RaceAdoptionRecord {
  readonly raceId: string;
  readonly registered: number;
  readonly invited: number;
  readonly activated: number;
  readonly withPlan: number | null;
  readonly withNutrition: number | null;
  readonly withAssistance: number | null;
}

/** L'état de la dernière invitation d'une participation, sans adresse (§28). */
export interface ParticipantInvitationRecord {
  readonly participantRaceId: string;
  /** `expired` est calculé à la lecture pour une invitation dont la date est passée. */
  readonly status: ParticipantInvitationStatus;
  /** Le dernier envoi a échoué et l'email n'est pas parti. */
  readonly sendFailed: boolean;
  readonly sentAt: string | null;
  readonly createdAt: string;
}

export type ParticipantInvitationPreviewState = 'valid' | 'expired' | 'closed' | 'unknown';

export interface ParticipantInvitationPreviewRecord {
  readonly state: ParticipantInvitationPreviewState;
  readonly eventName: string | null;
  readonly raceName: string | null;
  readonly raceStart: string | null;
  readonly raceTimezone: string | null;
  readonly organizationName: string | null;
  /** `c***@exemple.fr` : de quoi savoir avec quel compte se connecter. */
  readonly maskedEmail: string | null;
  readonly included: boolean;
  /** L'option PLUKA a été achetée à l'inscription (canal B, 0086) : rien à payer. */
  readonly prepaid: boolean;
}

export interface ParticipantInvitationRepository {
  /** Rend le nombre d'invitations créées. Sans liste : toutes celles à faire. */
  send(editionId: string, participantRaceIds: readonly string[] | null): Promise<number>;
  list(editionId: string): Promise<readonly ParticipantInvitationRecord[]>;
  /** Nul quand l'édition n'est pas lisible par l'acteur. */
  editionIncluded(editionId: string): Promise<boolean | null>;
  setEditionIncluded(editionId: string, included: boolean): Promise<void>;
  /** Canal B ouvert (0086). Nul quand l'édition n'est pas lisible par l'acteur. */
  editionPartnerSales(editionId: string): Promise<boolean | null>;
  setEditionPartnerSales(editionId: string, enabled: boolean): Promise<void>;
  preview(tokenHash: string): Promise<ParticipantInvitationPreviewRecord>;
  /** Rend la participation à ouvrir. */
  accept(tokenHash: string): Promise<string>;
  /** Refuser d'être contacté (0075) : `declined`, `closed` ou `unknown`. */
  decline(tokenHash: string): Promise<'declined' | 'closed' | 'unknown'>;
  /** Les participations de l'édition dont l'adresse a refusé d'être contactée. */
  listOptouts(editionId: string): Promise<readonly string[]>;
  /** L'adoption par épreuve de l'édition (0080). */
  adoption(editionId: string): Promise<readonly RaceAdoptionRecord[]>;
}

interface RpcCapableClient {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

async function invoke(
  client: PlukaClient,
  operation: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await (client as unknown as RpcCapableClient).rpc(operation, args);

  if (result.error !== null && result.error !== undefined) {
    throw mapPostgrestError(result.error as PostgrestLikeError, operation);
  }

  return result.data;
}

function unexpected(operation: string, message: string): DbError {
  return new DbError({ code: 'unknown', operation, message });
}

function rows(data: unknown, operation: string): readonly Record<string, unknown>[] {
  if (!Array.isArray(data)) throw unexpected(operation, 'la fonction devait rendre des lignes');
  return data as readonly Record<string, unknown>[];
}

function text(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

function requiredText(row: Record<string, unknown>, key: string, operation: string): string {
  const value = text(row, key);
  if (value === null) throw unexpected(operation, `colonne ${key} absente ou non textuelle`);
  return value;
}

const PREVIEW_STATES: readonly ParticipantInvitationPreviewState[] = [
  'valid',
  'expired',
  'closed',
  'unknown',
];

function isPreviewState(value: string | null): value is ParticipantInvitationPreviewState {
  return value !== null && (PREVIEW_STATES as readonly string[]).includes(value);
}

const UNKNOWN_PREVIEW: ParticipantInvitationPreviewRecord = {
  state: 'unknown',
  eventName: null,
  raceName: null,
  raceStart: null,
  raceTimezone: null,
  organizationName: null,
  maskedEmail: null,
  included: false,
  prepaid: false,
};

export const participantInvitationRepository = defineRepository<ParticipantInvitationRepository>(
  (context) => ({
    async send(editionId, participantRaceIds) {
      const operation = 'org_send_participant_invitations';
      const data = await invoke(context.client, operation, {
        p_edition_id: editionId,
        p_participant_race_ids: participantRaceIds,
      });

      if (typeof data !== 'number')
        throw unexpected(operation, 'la fonction devait rendre un nombre');
      return data;
    },

    async list(editionId) {
      const operation = 'org_list_participant_invitations';
      const data = rows(
        await invoke(context.client, operation, { p_edition_id: editionId }),
        operation,
      );

      return data.map((row) => ({
        participantRaceId: requiredText(row, 'participant_race_id', operation),
        status: requiredText(row, 'status', operation) as ParticipantInvitationStatus,
        sendFailed: row['send_failed'] === true,
        sentAt: text(row, 'sent_at'),
        createdAt: requiredText(row, 'created_at', operation),
      }));
    },

    async editionIncluded(editionId) {
      const row = unwrapMaybe(
        await context.client
          .from('editions')
          .select('participants_included')
          .eq('id', editionId)
          .maybeSingle(),
        'editions.participantsIncluded',
      );

      return row === null ? null : row.participants_included;
    },

    async setEditionIncluded(editionId, included) {
      await invoke(context.client, 'admin_set_edition_participants_included', {
        p_edition_id: editionId,
        p_included: included,
      });
    },

    async editionPartnerSales(editionId) {
      const row = unwrapMaybe(
        await context.client
          .from('editions')
          .select('partner_sales_enabled')
          .eq('id', editionId)
          .maybeSingle(),
        'editions.partnerSalesEnabled',
      );

      return row === null ? null : row.partner_sales_enabled;
    },

    async setEditionPartnerSales(editionId, enabled) {
      await invoke(context.client, 'admin_set_edition_partner_sales', {
        p_edition_id: editionId,
        p_enabled: enabled,
      });
    },

    async preview(tokenHash) {
      const operation = 'preview_participant_invitation';
      const row = rows(
        await invoke(context.client, operation, { p_token_hash: tokenHash }),
        operation,
      )[0];

      if (row === undefined) return UNKNOWN_PREVIEW;

      const state = text(row, 'state');
      if (!isPreviewState(state)) throw unexpected(operation, 'état d’invitation inconnu');

      return {
        state,
        eventName: text(row, 'event_name'),
        raceName: text(row, 'race_name'),
        raceStart: text(row, 'race_start'),
        raceTimezone: text(row, 'race_timezone'),
        organizationName: text(row, 'organization_name'),
        maskedEmail: text(row, 'masked_email'),
        included: row['included'] === true,
        prepaid: row['prepaid'] === true,
      };
    },

    async decline(tokenHash) {
      const operation = 'decline_participant_invitation';
      const data = await invoke(context.client, operation, { p_token_hash: tokenHash });

      if (data === 'declined' || data === 'closed' || data === 'unknown') return data;
      throw unexpected(operation, 'état de refus inconnu');
    },

    async listOptouts(editionId) {
      const operation = 'org_list_contact_optouts';
      return rows(
        await invoke(context.client, operation, { p_edition_id: editionId }),
        operation,
      ).map((row) => requiredText(row, 'participant_race_id', operation));
    },

    async adoption(editionId) {
      const operation = 'org_race_adoption';
      const count = (row: Record<string, unknown>, key: string): number | null =>
        typeof row[key] === 'number' ? row[key] : null;

      return rows(
        await invoke(context.client, operation, { p_edition_id: editionId }),
        operation,
      ).map((row) => ({
        raceId: requiredText(row, 'race_id', operation),
        registered: count(row, 'registered') ?? 0,
        invited: count(row, 'invited') ?? 0,
        activated: count(row, 'activated') ?? 0,
        withPlan: count(row, 'with_plan'),
        withNutrition: count(row, 'with_nutrition'),
        withAssistance: count(row, 'with_assistance'),
      }));
    },

    async accept(tokenHash) {
      const operation = 'accept_participant_invitation';
      const data = await invoke(context.client, operation, { p_token_hash: tokenHash });

      if (typeof data !== 'string')
        throw unexpected(operation, 'la fonction devait rendre un uuid');
      return data;
    },
  }),
);

export interface ParticipantInvitationRepositories {
  readonly participantInvitations: ParticipantInvitationRepository;
}

export function createParticipantInvitationRepositories(
  context: RepositoryContext,
): ParticipantInvitationRepositories {
  return { participantInvitations: participantInvitationRepository(context) };
}
