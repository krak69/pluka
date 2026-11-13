import { receiveBillingWebhook } from '@pluka/domain';

import { billingInboxContext, billingProvider, billingSignatureHeader } from '@/lib/billing';

/**
 * Le webhook du prestataire de paiement — 01_ARCHITECTURE §28.1.
 *
 * Il dépose la livraison telle quelle, corps brut et signature, et répond
 * aussitôt : la vérification et l'application appartiennent au worker, seul
 * détenteur de la clé de service (03_PRIVACY_RLS §8, migration 0089). Les
 * journaux ne portent que des identifiants techniques (AGENTS §62).
 */
export async function POST(request: Request): Promise<Response> {
  const provider = billingProvider();
  const header = billingSignatureHeader();
  if (provider === null || header === null) {
    return new Response('paiement non configuré', { status: 404 });
  }

  const rawBody = await request.text();

  try {
    const id = await receiveBillingWebhook(billingInboxContext(), {
      provider: provider.name,
      rawBody,
      signature: request.headers.get(header) ?? '',
    });
    console.info(JSON.stringify({ event: 'billing_webhook_received', provider: provider.name, id }));
    return Response.json({ received: true });
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: 'billing_webhook_refused',
        provider: provider.name,
        reason: error instanceof Error ? error.name : 'unknown',
      }),
    );
    return new Response('livraison refusée', { status: 400 });
  }
}
