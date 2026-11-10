import type { PlukaClient } from '@pluka/db';

import { transient } from './errors.js';
import type { AccountNoticeClaim, AccountNoticeStore } from './ports.js';

/**
 * Adaptateur des avertissements de compte inactif — migration 0079.
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

const NOT_SENDABLE: AccountNoticeClaim = {
  sendable: false,
  recipientEmail: null,
  firstName: null,
  purgeAfter: null,
  attempt: 0,
};

export function createAccountNoticeStore(client: PlukaClient): AccountNoticeStore {
  return {
    async claim(userId) {
      const operation = 'worker_claim_account_notice';
      const data = unwrapRpc(await rpc(client).rpc(operation, { p_user: userId }), operation);
      const row = (Array.isArray(data) ? data[0] : undefined) as
        Record<string, unknown> | undefined;

      if (row === undefined || row['sendable'] !== true) return NOT_SENDABLE;

      return {
        sendable: true,
        recipientEmail: text(row['recipient_email']),
        firstName: text(row['first_name']),
        purgeAfter: text(row['purge_after']),
        attempt: typeof row['attempt'] === 'number' ? row['attempt'] : 1,
      };
    },

    async complete(userId) {
      const operation = 'worker_complete_account_notice';
      unwrapRpc(await rpc(client).rpc(operation, { p_user: userId }), operation);
    },

    async fail(userId, error, abandon) {
      const operation = 'worker_fail_account_notice';
      unwrapRpc(
        await rpc(client).rpc(operation, { p_user: userId, p_error: error, p_abandon: abandon }),
        operation,
      );
    },
  };
}
