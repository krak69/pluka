import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  BillingProvider,
  BillingWebhookDelivery,
  JsonObject,
  VerifiedBillingEvent,
} from '@pluka/contracts';

/**
 * Le prestataire de paiement, côté worker — 01_ARCHITECTURE §28.1, migration 0089.
 *
 * Le worker vérifie la signature des webhooks déposés par l'application : il
 * est seul à détenir la clé de service qui confirme un paiement. Aucun
 * prestataire réel n'est choisi ; `test` signe en HMAC-SHA256 le corps brut
 * avec `BILLING_WEBHOOK_SECRET`, comme le fait la page de paiement simulée de
 * l'application. Il est refusé en production : il accorderait un Race Pass
 * sans encaissement.
 *
 * Un adaptateur réel n'implémentera ici que `verifyWebhook` : l'ouverture de
 * la page de paiement appartient à l'application.
 */
export interface BillingEnvironment {
  readonly BILLING_PROVIDER?: string | undefined;
  readonly BILLING_WEBHOOK_SECRET?: string | undefined;
  readonly NODE_ENV?: string | undefined;
}

function createTestVerifier(secret: string): BillingProvider {
  return {
    name: 'test',

    createCheckoutSession() {
      return Promise.reject(new Error('le worker n’ouvre pas de session de paiement'));
    },

    verifyWebhook(delivery: BillingWebhookDelivery): Promise<VerifiedBillingEvent> {
      const expected = createHmac('sha256', secret).update(delivery.rawBody).digest();
      const received = Buffer.from(delivery.signature, 'hex');
      if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
        return Promise.reject(new Error('unauthorized : signature invalide'));
      }

      let parsed: { id?: unknown; type?: unknown; occurredAt?: unknown; data?: unknown };
      try {
        parsed = JSON.parse(delivery.rawBody) as typeof parsed;
      } catch {
        return Promise.reject(new Error('unauthorized : corps illisible'));
      }

      if (
        typeof parsed.id !== 'string' ||
        typeof parsed.type !== 'string' ||
        typeof parsed.occurredAt !== 'string' ||
        typeof parsed.data !== 'object' ||
        parsed.data === null
      ) {
        return Promise.reject(new Error('unauthorized : événement incomplet'));
      }

      return Promise.resolve({
        providerEventId: parsed.id,
        type: parsed.type,
        occurredAt: parsed.occurredAt,
        payload: parsed.data as JsonObject,
      });
    },
  };
}

export function createBilling(env: BillingEnvironment): BillingProvider | null {
  const secret = env.BILLING_WEBHOOK_SECRET;
  if (secret === undefined || secret === '') return null;

  if (env.BILLING_PROVIDER === 'test' && env.NODE_ENV !== 'production') {
    return createTestVerifier(secret);
  }

  return null;
}
