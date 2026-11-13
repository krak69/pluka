'use server';

import { redirect } from 'next/navigation';

import { signTestBillingEvent, testBillingSecret, TEST_SIGNATURE_HEADER } from '@/lib/billing';
import { publicEnv } from '@/lib/env';

/**
 * Le geste de la page de paiement simulée : elle envoie au webhook de PLUKA un
 * événement signé, exactement comme le ferait un prestataire réel. Le Race
 * Pass ne naît que de ce webhook vérifié — jamais de ce bouton.
 */
export async function simulateTestPaymentAction(form: FormData): Promise<void> {
  const secret = testBillingSecret();
  if (secret === null) redirect('/offre');

  const sessionId = String(form.get('sessionId') ?? '');
  const purchaseId = String(form.get('purchaseId') ?? '');
  const participantRaceId = String(form.get('participantRaceId') ?? '');
  const outcome = form.get('outcome') === 'paid' ? 'checkout.completed' : 'checkout.cancelled';

  const { rawBody, signature } = signTestBillingEvent(secret, {
    type: outcome,
    checkoutReference: sessionId,
  });

  const appUrl = publicEnv().NEXT_PUBLIC_APP_URL;
  await fetch(new URL('/api/billing/webhook', appUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', [TEST_SIGNATURE_HEADER]: signature },
    body: rawBody,
  });

  redirect(
    outcome === 'checkout.completed'
      ? `/offre/merci?achat=${encodeURIComponent(purchaseId)}`
      : `/offre?course=${encodeURIComponent(participantRaceId)}`,
  );
}
