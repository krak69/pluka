import { handleBillingWebhook } from '@pluka/domain';

import { normalizeError } from '../errors.js';
import type { QueueMessage, WorkerPorts } from '../ports.js';

/**
 * Un webhook de paiement déposé par l'application — 01_ARCHITECTURE §28.1,
 * migration 0089 : « payment event → validation signature → commande domaine
 * → entitlement PLUKA ».
 *
 * Une signature invalide est rejetée pour de bon : la réessayer ne la rendrait
 * pas valide. Une panne de la base, elle, se retente ; la confirmation est
 * idempotente par identifiant d'événement (0088).
 */
export type BillingWebhookOutcome =
  | { readonly kind: 'processed'; readonly result: string }
  | { readonly kind: 'rejected'; readonly code: string }
  | { readonly kind: 'already_done' }
  | { readonly kind: 'retry'; readonly code: string }
  | { readonly kind: 'abandoned'; readonly code: string };

export function isBillingWebhookMessage(message: QueueMessage): boolean {
  return typeof message.payload.billingWebhookId === 'string';
}

export async function handleBillingWebhookMessage(
  ports: WorkerPorts,
  message: QueueMessage,
): Promise<BillingWebhookOutcome> {
  const id = message.payload.billingWebhookId;
  if (typeof id !== 'string') return { kind: 'abandoned', code: 'PAYLOAD_INVALID' };

  try {
    const delivery = await ports.billing.inbox.claim(id);
    if (delivery === null) return { kind: 'already_done' };

    // §35 : sans prestataire configuré, la livraison reste en boîte et se retente.
    const provider = ports.billing.provider;
    if (provider === null) return { kind: 'retry', code: 'BILLING_NOT_CONFIGURED' };

    if (provider.name !== delivery.provider) {
      await ports.billing.inbox.settle(id, 'rejected', 'PROVIDER_MISMATCH');
      return { kind: 'rejected', code: 'PROVIDER_MISMATCH' };
    }

    let result: string;
    try {
      result = await handleBillingWebhook(
        { repositories: { billingWebhook: ports.billing.webhook }, provider },
        { rawBody: delivery.rawBody, signature: delivery.signature },
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('unauthorized')) {
        await ports.billing.inbox.settle(id, 'rejected', 'SIGNATURE');
        ports.logger.warn('webhook de paiement rejeté', { billingWebhookId: id });
        return { kind: 'rejected', code: 'SIGNATURE' };
      }
      throw error;
    }

    await ports.billing.inbox.settle(id, 'processed', result);
    // Ni montant, ni coureur : l'identifiant et l'issue suffisent au diagnostic.
    ports.logger.info('webhook de paiement appliqué', { billingWebhookId: id, result });
    return { kind: 'processed', result };
  } catch (error) {
    const normalized = normalizeError(error);
    ports.logger.error('webhook de paiement en échec', { billingWebhookId: id, code: normalized.code });
    return { kind: 'retry', code: normalized.code };
  }
}
