import type { PlukaClient } from '@pluka/db';

import { transient } from './errors.js';
import type { DiscoveryStore } from './ports.js';

/**
 * Adaptateur des inventaires de site — migrations 0040, 0042.
 *
 * Trois fonctions `worker_*`, réservées à `service_role`. L'ouverture est un
 * compare-and-set sur le statut : un inventaire terminé rend `null`.
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

export function createDiscoveryStore(client: PlukaClient): DiscoveryStore {
  return {
    async begin(discoveryId) {
      const operation = 'worker_begin_event_discovery';
      const data = unwrapRpc(
        await rpc(client).rpc(operation, { p_discovery_id: discoveryId }),
        operation,
      );
      return typeof data === 'string' ? data : null;
    },

    async complete(input) {
      const operation = 'worker_complete_event_discovery';
      unwrapRpc(
        await rpc(client).rpc(operation, {
          p_discovery_id: input.discoveryId,
          p_final_url: input.finalUrl,
          p_inventory: input.inventory,
          p_pages_read: input.pagesRead,
          p_discovery_version: input.discoveryVersion,
        }),
        operation,
      );
    },

    async fail(discoveryId, errorCode) {
      const operation = 'worker_fail_event_discovery';
      unwrapRpc(
        await rpc(client).rpc(operation, { p_discovery_id: discoveryId, p_error_code: errorCode }),
        operation,
      );
    },
  };
}
