import type { PlukaClient } from '@pluka/db';

import { transient } from './errors.js';
import type { NotificationClaim, NotificationStore } from './ports.js';

/**
 * Adaptateur des livraisons de notification — §46.
 *
 * Réclamer, clore, échouer : trois appels, tous par fonction SQL. La
 * réclamation est un compare-and-set qui rend `alreadySent` plutôt qu'une
 * ligne : c'est ce qui rend le rejeu d'un message pgmq inoffensif sans que le
 * worker ait à raisonner dessus (§22.1).
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

export function createNotificationStore(client: PlukaClient): NotificationStore {
  return {
    async claim(deliveryId) {
      const rows = unwrapRpc(
        await rpc(client).rpc('worker_claim_notification', { p_delivery_id: deliveryId }),
        'worker_claim_notification',
      );

      const row = (Array.isArray(rows) ? rows[0] : rows) as Record<string, unknown> | undefined;

      if (row === undefined) throw transient('DB_UNAVAILABLE', 'livraison non réclamée');

      return {
        deliveryId: String(row.delivery_id),
        alreadySent: row.already_sent === true,
        attempts: Number(row.attempts ?? 0),
        maxAttempts: Number(row.max_attempts ?? 0),
        idempotencyKey: String(row.idempotency_key),
        recipientEmail: text(row.recipient_email),
        recipientFirstName: text(row.recipient_first_name),
        locale: text(row.locale),
        eventName: text(row.event_name),
        raceName: text(row.race_name),
        raceId: text(row.race_id),
        changeTitle: text(row.change_title),
        severity: text(row.severity) as NotificationClaim['severity'],
        modules: Array.isArray(row.modules) ? (row.modules as string[]) : [],
      };
    },

    async complete(deliveryId, result) {
      unwrapRpc(
        await rpc(client).rpc('worker_complete_notification', {
          p_delivery_id: deliveryId,
          p_provider: result.provider,
          p_provider_message_id: result.providerMessageId,
          p_template_version: result.templateVersion,
        }),
        'worker_complete_notification',
      );
    },

    async fail(deliveryId, error) {
      const status = unwrapRpc(
        await rpc(client).rpc('worker_fail_notification', {
          p_delivery_id: deliveryId,
          p_error: error,
        }),
        'worker_fail_notification',
      );

      return status === null || status === undefined ? null : String(status);
    },
  };
}
