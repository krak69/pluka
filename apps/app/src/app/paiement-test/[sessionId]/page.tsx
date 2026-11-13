import { getMyPurchase } from '@pluka/domain';
import { Button, Logo } from '@pluka/ui';
import { notFound } from 'next/navigation';

import { simulateTestPaymentAction } from '@/app/paiement-test/actions';
import { billingContext, testBillingSecret } from '@/lib/billing';
import { listMyRaces } from '@/lib/participations';
import { requireSession } from '@/lib/session';

/**
 * La page de paiement du prestataire de test — elle tient la place de la page
 * hébergée d'un prestataire réel (05_ROUTES_FLOWS §12.8). Aucun débit : elle
 * n'existe qu'avec `BILLING_PROVIDER=test`, et jamais en production.
 */
export const metadata = { title: 'Paiement simulé' };

function amount(minor: number | null, currency: string | null): string {
  if (minor === null) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency ?? 'EUR' }).format(
    minor / 100,
  );
}

export default async function TestPaymentPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly sessionId: string }>;
  readonly searchParams: Promise<{ readonly achat?: string }>;
}) {
  if (testBillingSecret() === null) notFound();

  const { sessionId } = await params;
  const { achat } = await searchParams;
  const session = await requireSession(`/paiement-test/${sessionId}?achat=${achat ?? ''}`);
  const purchase = await getMyPurchase(billingContext(session), { purchaseId: achat ?? '' }).catch(
    () => null,
  );

  if (purchase === null || purchase.checkoutReference !== sessionId) notFound();

  const race = (await listMyRaces(session)).find(
    (candidate) => candidate.participantRaceId === purchase.participantRaceId,
  );
  const raceName = race?.name ?? 'ta course';
  const early = purchase.productKey === 'race_pass_early';

  // Mise en page du prototype (écran `checkout`) : un récapitulatif, un geste.
  return (
    <main className="pt-page">
      <div className="pt-column">
        <Logo />
        <p className="pk-label">Race Pass</p>
        <h1 className="pt-title">Débloque ta préparation de {raceName}.</h1>

        <div className="pt-recap">
          <p className="pt-line">
            <span>Race Pass · {raceName}</span>
            <strong>{amount(purchase.amountMinor, purchase.currency)}</strong>
          </p>
          <p className="pt-note">
            Paiement unique pour cette course, sorties de préparation incluses.
            {early ? ' Tarif inscrit appliqué.' : ''}
          </p>
        </div>

        {purchase.status !== 'pending' ? (
          <p className="pt-note">Cet achat est déjà réglé ou abandonné.</p>
        ) : (
          <div className="pt-actions">
            {(['paid', 'cancelled'] as const).map((outcome) => (
              <form key={outcome} action={simulateTestPaymentAction}>
                <input type="hidden" name="sessionId" value={sessionId} />
                <input type="hidden" name="purchaseId" value={achat ?? ''} />
                <input
                  type="hidden"
                  name="participantRaceId"
                  value={purchase.participantRaceId ?? ''}
                />
                <input type="hidden" name="outcome" value={outcome} />
                {outcome === 'paid' ? (
                  <Button type="submit" variant="primary" className="pt-pay">
                    Débloquer ma préparation
                  </Button>
                ) : (
                  <button type="submit" className="pt-back">
                    Revenir aux offres
                  </button>
                )}
              </form>
            ))}
          </div>
        )}

        <p className="pt-test">
          Paiement simulé, en développement seulement : aucun débit. Le Race Pass n’est accordé qu’à
          la réception du webhook signé, comme en production.
        </p>
      </div>
    </main>
  );
}
