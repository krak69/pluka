'use server';

import { DomainError, startRacePassCheckout } from '@pluka/domain';
import { redirect } from 'next/navigation';

import { billingContext } from '@/lib/billing';
import { requireSession } from '@/lib/session';

/**
 * « Payer » — ouvre la page du prestataire. Le client n'envoie que la
 * participation : le produit et le prix se décident en base (04 §72.1).
 */
export async function startRacePassCheckoutAction(form: FormData): Promise<void> {
  const participantRaceId = String(form.get('participantRaceId') ?? '');
  const session = await requireSession(`/offre?course=${encodeURIComponent(participantRaceId)}`);

  let checkoutUrl: string;
  try {
    ({ checkoutUrl } = await startRacePassCheckout(billingContext(session), { participantRaceId }));
  } catch (error) {
    // Une course déjà couverte ou un paiement fermé : l'écran d'offre le dit.
    if (error instanceof DomainError) {
      redirect(`/offre?course=${encodeURIComponent(participantRaceId)}&refus=${error.code}`);
    }
    throw error;
  }

  redirect(checkoutUrl);
}
