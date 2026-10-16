import type { PlukaClient } from '@pluka/db';

import { transient } from './errors.js';
import type { EventSiteContactClaim, EventSiteContactStore } from './ports.js';

/**
 * Adaptateur des messages du formulaire de contact — migration 0052.
 *
 * Trois fonctions `worker_*`, réservées à `service_role`. Le contenu n'est lu
 * qu'au moment de l'envoi, et effacé dès qu'il est parti ou abandonné.
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

const NOT_SENDABLE: EventSiteContactClaim = {
  sendable: false,
  recipientEmail: null,
  eventName: null,
  raceName: null,
  senderName: null,
  senderEmail: null,
  body: null,
  attempt: 0,
};

export function createSiteContactStore(client: PlukaClient): EventSiteContactStore {
  return {
    async claim(messageId) {
      const operation = 'worker_claim_event_site_contact';
      const data = unwrapRpc(await rpc(client).rpc(operation, { p_message_id: messageId }), operation);
      const row = (Array.isArray(data) ? data[0] : undefined) as Record<string, unknown> | undefined;

      if (row === undefined || row['sendable'] !== true) return NOT_SENDABLE;

      return {
        sendable: true,
        recipientEmail: text(row['recipient_email']),
        eventName: text(row['event_name']),
        raceName: text(row['race_name']),
        senderName: text(row['sender_name']),
        senderEmail: text(row['sender_email']),
        body: text(row['body']),
        attempt: typeof row['attempt'] === 'number' ? row['attempt'] : 1,
      };
    },

    async complete(messageId) {
      const operation = 'worker_complete_event_site_contact';
      unwrapRpc(await rpc(client).rpc(operation, { p_message_id: messageId }), operation);
    },

    async fail(messageId, error, abandon) {
      const operation = 'worker_fail_event_site_contact';
      const data = unwrapRpc(
        await rpc(client).rpc(operation, {
          p_message_id: messageId,
          p_error: error,
          p_abandon: abandon,
        }),
        operation,
      );
      return typeof data === 'number' ? data : 0;
    },
  };
}
