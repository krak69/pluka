import type { PlukaClient } from '@pluka/db';

import { transient } from './errors.js';
import type {
  InvitationSendClaim,
  InvitationStore,
  ParticipantInvitationSendClaim,
  ParticipantInvitationStore,
  StaffInvitationSendClaim,
  StaffInvitationStore,
} from './ports.js';

/**
 * Adaptateur des envois d'invitation d'équipe — migration 0033.
 *
 * Trois fonctions `worker_*`, réservées à `service_role`. La réclamation est
 * un compare-and-set sur `status = 'pending'` : un message pgmq rejoué après
 * un envoi réussi revient `sendable = false`, et le job s'arrête.
 */

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

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function createInvitationStore(client: PlukaClient): InvitationStore {
  return {
    async claim(invitationId, tokenHash): Promise<InvitationSendClaim> {
      const operation = 'worker_claim_organization_invitation';
      const data = unwrapRpc(
        await rpc(client).rpc(operation, {
          p_invitation_id: invitationId,
          p_token_hash: tokenHash,
        }),
        operation,
      );
      const row = (Array.isArray(data) ? data[0] : undefined) as
        Record<string, unknown> | undefined;

      if (row === undefined || row['sendable'] !== true) {
        return {
          sendable: false,
          email: null,
          role: null,
          organizationName: null,
          inviterName: null,
          expiresAt: null,
          attempt: 0,
        };
      }

      return {
        sendable: true,
        email: text(row['email']),
        role: text(row['role']),
        organizationName: text(row['organization_name']),
        inviterName: text(row['inviter_name']),
        expiresAt: text(row['expires_at']),
        attempt: typeof row['attempt'] === 'number' ? row['attempt'] : 1,
      };
    },

    async complete(invitationId) {
      const operation = 'worker_complete_organization_invitation';
      unwrapRpc(await rpc(client).rpc(operation, { p_invitation_id: invitationId }), operation);
    },

    async fail(invitationId, error) {
      const operation = 'worker_fail_organization_invitation';
      const data = unwrapRpc(
        await rpc(client).rpc(operation, { p_invitation_id: invitationId, p_error: error }),
        operation,
      );

      return typeof data === 'number' ? data : 0;
    },
  };
}

/** Même adaptateur pour l'équipe PLUKA — fonctions `worker_*_staff_invitation` de 0036. */
const NOT_SENDABLE: ParticipantInvitationSendClaim = {
  sendable: false,
  email: null,
  firstName: null,
  eventName: null,
  raceName: null,
  organizationName: null,
  raceStart: null,
  raceTimezone: null,
  included: false,
  attempt: 0,
};

/** Invitations des participants — migration 0069. */
export function createParticipantInvitationStore(client: PlukaClient): ParticipantInvitationStore {
  return {
    async claim(invitationId, tokenHash) {
      const operation = 'worker_claim_participant_invitation';
      const data = unwrapRpc(
        await rpc(client).rpc(operation, {
          p_invitation_id: invitationId,
          p_token_hash: tokenHash,
        }),
        operation,
      );
      const row = (Array.isArray(data) ? data[0] : undefined) as
        Record<string, unknown> | undefined;

      if (row === undefined || row['sendable'] !== true) return NOT_SENDABLE;

      return {
        sendable: true,
        email: text(row['email']),
        firstName: text(row['first_name']),
        eventName: text(row['event_name']),
        raceName: text(row['race_name']),
        organizationName: text(row['organization_name']),
        raceStart: text(row['race_start']),
        raceTimezone: text(row['race_timezone']),
        included: row['included'] === true,
        attempt: typeof row['attempt'] === 'number' ? row['attempt'] : 1,
      };
    },

    async complete(invitationId) {
      const operation = 'worker_complete_participant_invitation';
      unwrapRpc(await rpc(client).rpc(operation, { p_invitation_id: invitationId }), operation);
    },

    async fail(invitationId, error) {
      const operation = 'worker_fail_participant_invitation';
      const data = unwrapRpc(
        await rpc(client).rpc(operation, { p_invitation_id: invitationId, p_error: error }),
        operation,
      );
      return typeof data === 'number' ? data : 0;
    },
  };
}

export function createStaffInvitationStore(client: PlukaClient): StaffInvitationStore {
  return {
    async claim(invitationId, tokenHash): Promise<StaffInvitationSendClaim> {
      const operation = 'worker_claim_staff_invitation';
      const data = unwrapRpc(
        await rpc(client).rpc(operation, {
          p_invitation_id: invitationId,
          p_token_hash: tokenHash,
        }),
        operation,
      );
      const row = (Array.isArray(data) ? data[0] : undefined) as
        Record<string, unknown> | undefined;

      if (row === undefined || row['sendable'] !== true) {
        return {
          sendable: false,
          email: null,
          staffRole: null,
          inviterName: null,
          expiresAt: null,
          attempt: 0,
        };
      }

      return {
        sendable: true,
        email: text(row['email']),
        staffRole: text(row['staff_role']),
        inviterName: text(row['inviter_name']),
        expiresAt: text(row['expires_at']),
        attempt: typeof row['attempt'] === 'number' ? row['attempt'] : 1,
      };
    },

    async complete(invitationId) {
      const operation = 'worker_complete_staff_invitation';
      unwrapRpc(await rpc(client).rpc(operation, { p_invitation_id: invitationId }), operation);
    },

    async fail(invitationId, error) {
      const operation = 'worker_fail_staff_invitation';
      const data = unwrapRpc(
        await rpc(client).rpc(operation, { p_invitation_id: invitationId, p_error: error }),
        operation,
      );
      return typeof data === 'number' ? data : 0;
    },
  };
}
