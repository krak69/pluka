import type { PlukaClient } from '@pluka/db';

import { transient } from './errors.js';
import type { BillingInboxStore } from './ports.js';

/** Les fonctions de 0089, qui ne sont pas dans les types générés. */
type RpcClient = {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

function rpc(client: PlukaClient): RpcClient {
  return client as unknown as RpcClient;
}

function unwrap(result: { data: unknown; error: unknown }, operation: string): unknown {
  if (result.error !== null && result.error !== undefined) {
    throw transient('DB_ERROR', `${operation} a échoué`, result.error);
  }
  return result.data;
}

/** La boîte de réception des webhooks de paiement — migration 0089. */
export function createBillingInboxStore(client: PlukaClient): BillingInboxStore {
  return {
    async claim(id) {
      const operation = 'worker_claim_billing_webhook';
      const data = unwrap(await rpc(client).rpc(operation, { p_id: id }), operation);
      const row = (Array.isArray(data) ? data[0] : undefined) as
        | Record<string, unknown>
        | undefined;
      if (row === undefined) return null;

      return {
        provider: String(row['provider']),
        rawBody: String(row['raw_body']),
        signature: String(row['signature']),
      };
    },

    async settle(id, status, result) {
      const operation = 'worker_settle_billing_webhook';
      unwrap(
        await rpc(client).rpc(operation, { p_id: id, p_status: status, p_result: result }),
        operation,
      );
    },
  };
}
