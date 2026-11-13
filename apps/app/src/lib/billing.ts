import { createHmac, randomBytes } from 'node:crypto';

import { billingInboxRepository, billingRepository } from '@pluka/db';
import { createServerClient } from '@pluka/db/server';
import type {
  BillingCheckoutRequest,
  BillingCheckoutSession,
  BillingContext,
  BillingInboxContext,
  BillingProvider,
  VerifiedBillingEvent,
} from '@pluka/domain';

import { publicEnv } from '@/lib/env';
import type { Session } from '@/lib/session';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Paiement — 01_ARCHITECTURE §28, §28.1 ; 04_ENTITLEMENTS §26 ; migrations 0088, 0089.
 *
 * Aucun prestataire réel n'est choisi (05_ROUTES_FLOWS §12.8). `BILLING_PROVIDER`
 * vide : aucun paiement possible, et l'écran le dit. `test` : un prestataire
 * local qui simule une page de paiement hébergée et signe ses webhooks comme
 * le ferait un vrai. Il est refusé en production : il accorderait un Race Pass
 * sans encaisser.
 *
 * L'application ouvre la session de paiement et dépose le webhook reçu ; elle
 * ne le vérifie ni ne l'applique. C'est le worker, seul détenteur de la clé de
 * service (03_PRIVACY_RLS §8), qui le fait (0089).
 *
 * Un adaptateur réel (Stripe, Paddle…) prendra place ici, derrière la même
 * interface ; le domaine et la base n'en sauront rien.
 */

/** L'en-tête qui porte la signature du webhook du prestataire de test. */
export const TEST_SIGNATURE_HEADER = 'x-pluka-test-signature';

/** Le secret de signature du prestataire de test, ou nul s'il n'est pas actif. */
export function testBillingSecret(): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  if (process.env.BILLING_PROVIDER !== 'test') return null;
  const secret = process.env.BILLING_WEBHOOK_SECRET;
  return secret === undefined || secret === '' ? null : secret;
}

/** Le corps d'un webhook du prestataire de test, signé. Sert la page de paiement simulée. */
export function signTestBillingEvent(
  secret: string,
  event: {
    readonly type: 'checkout.completed' | 'checkout.cancelled';
    readonly checkoutReference: string;
  },
): { readonly rawBody: string; readonly signature: string } {
  const rawBody = JSON.stringify({
    id: `evt_test_${randomBytes(8).toString('hex')}`,
    type: event.type,
    occurredAt: new Date().toISOString(),
    data: {
      checkoutReference: event.checkoutReference,
      paymentReference:
        event.type === 'checkout.completed' ? `pay_test_${randomBytes(8).toString('hex')}` : null,
    },
  });
  return { rawBody, signature: createHmac('sha256', secret).update(rawBody).digest('hex') };
}

function createTestBillingProvider(appUrl: string): BillingProvider {
  return {
    name: 'test',

    createCheckoutSession(request: BillingCheckoutRequest): Promise<BillingCheckoutSession> {
      const sessionId = `cs_test_${randomBytes(12).toString('hex')}`;
      const url = new URL(`/paiement-test/${sessionId}`, appUrl);
      url.searchParams.set('achat', String(request.metadata['purchaseId'] ?? ''));
      return Promise.resolve({ providerSessionId: sessionId, checkoutUrl: url.toString() });
    },

    // La vérification appartient au worker (0089) : l'application n'en a pas l'usage.
    verifyWebhook(): Promise<VerifiedBillingEvent> {
      return Promise.reject(new Error('unauthorized : vérification réservée au worker'));
    },
  };
}

/** Le prestataire configuré ; nul sans configuration utilisable. */
export function billingProvider(): BillingProvider | null {
  return testBillingSecret() === null
    ? null
    : createTestBillingProvider(publicEnv().NEXT_PUBLIC_APP_URL);
}

/** L'en-tête de signature du prestataire configuré ; nul sans prestataire. */
export function billingSignatureHeader(): string | null {
  return billingProvider() === null ? null : TEST_SIGNATURE_HEADER;
}

export function billingContext(session: Session): BillingContext {
  return {
    repositories: {
      billing: billingRepository({ client: createDataClient(session.accessToken) }),
    },
    provider: billingProvider(),
    appUrl: publicEnv().NEXT_PUBLIC_APP_URL,
    actor: { userId: session.userId },
  };
}

/** Le dépôt d'une livraison du webhook : sans session, le prestataire n'en a pas. */
export function billingInboxContext(): BillingInboxContext {
  const env = publicEnv();
  return {
    repositories: {
      billingInbox: billingInboxRepository({
        client: createServerClient({
          url: env.NEXT_PUBLIC_SUPABASE_URL,
          publishableKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        }),
      }),
    },
  };
}
