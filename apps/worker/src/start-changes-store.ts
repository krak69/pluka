import type { PlukaClient } from '@pluka/db';

import { transient } from './errors.js';
import type { StartChangeClaim, StartChangeStore } from './ports.js';

/**
 * Adaptateur des changements d'heure de départ — migration 0082.
 *
 * Trois fonctions `worker_*`, réservées à `service_role`.
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

const NOT_SENDABLE: StartChangeClaim = {
  sendable: false,
  recipientEmail: null,
  firstName: null,
  eventName: null,
  raceName: null,
  timezone: null,
  participantRaceId: null,
  previousWaveName: null,
  newWaveName: null,
  previousStartAt: null,
  newStartAt: null,
  hasPlan: false,
  attempt: 0,
};

export function createStartChangeStore(client: PlukaClient): StartChangeStore {
  return {
    async claim(changeId) {
      const operation = 'worker_claim_start_change';
      const data = unwrapRpc(
        await rpc(client).rpc(operation, { p_change_id: changeId }),
        operation,
      );
      const row = (Array.isArray(data) ? data[0] : undefined) as
        Record<string, unknown> | undefined;

      if (row === undefined || row['sendable'] !== true) return NOT_SENDABLE;

      return {
        sendable: true,
        recipientEmail: text(row['recipient_email']),
        firstName: text(row['first_name']),
        eventName: text(row['event_name']),
        raceName: text(row['race_name']),
        timezone: text(row['timezone']),
        participantRaceId: text(row['participant_race_id']),
        previousWaveName: text(row['previous_wave_name']),
        newWaveName: text(row['new_wave_name']),
        previousStartAt: text(row['previous_start_at']),
        newStartAt: text(row['new_start_at']),
        hasPlan: row['has_plan'] === true,
        attempt: typeof row['attempt'] === 'number' ? row['attempt'] : 1,
      };
    },

    async complete(changeId) {
      const operation = 'worker_complete_start_change';
      unwrapRpc(await rpc(client).rpc(operation, { p_change_id: changeId }), operation);
    },

    async fail(changeId, error, abandon) {
      const operation = 'worker_fail_start_change';
      unwrapRpc(
        await rpc(client).rpc(operation, {
          p_change_id: changeId,
          p_error: error,
          p_abandon: abandon,
        }),
        operation,
      );
    },
  };
}
