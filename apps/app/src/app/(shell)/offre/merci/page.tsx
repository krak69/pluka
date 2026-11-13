import { getMyPurchase } from '@pluka/domain';
import Link from 'next/link';

import { Icon } from '@/components/icon';
import { billingContext } from '@/lib/billing';
import { requireSession } from '@/lib/session';

/**
 * Retour du paiement. L'état vient de la base, jamais de l'adresse de retour :
 * le prestataire peut renvoyer le coureur avant que son webhook ne soit arrivé,
 * et l'écran ne promet alors rien (01_ARCHITECTURE §35).
 */
export const metadata = { title: 'Paiement' };

export default async function ThanksPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly achat?: string }>;
}) {
  const { achat } = await searchParams;
  const session = await requireSession(`/offre/merci?achat=${achat ?? ''}`);
  const purchase = await getMyPurchase(billingContext(session), { purchaseId: achat ?? '' }).catch(
    () => null,
  );

  const course =
    purchase?.participantRaceId === null || purchase === null
      ? null
      : `/courses/${purchase.participantRaceId}`;

  const view =
    purchase === null
      ? {
          eyebrow: 'Paiement',
          title: 'Achat introuvable',
          text: 'Ce lien ne correspond à aucun de tes achats.',
          done: false,
        }
      : purchase.status === 'paid' && !purchase.conflict
        ? {
            eyebrow: 'Paiement confirmé',
            title: 'Ton Race Pass est actif.',
            text: 'La préparation complète de ta course est ouverte : Plan éditable, Nutrition, Préparation, Assistance, et les Conditions dès J-14.',
            done: true,
          }
        : purchase.status === 'paid'
          ? {
              eyebrow: 'Paiement reçu',
              title: 'Ta course était déjà couverte.',
              text: 'Ton paiement est arrivé alors que ta course avait déjà un Race Pass. Il te sera remboursé ; écris-nous à hello@pluka.run si tu as une question.',
              done: false,
            }
          : purchase.status === 'pending'
            ? {
                eyebrow: 'Paiement',
                title: 'Confirmation en cours…',
                text: 'Le prestataire n’a pas encore confirmé ton paiement. Recharge cette page dans un instant.',
                done: false,
              }
            : {
                eyebrow: 'Paiement',
                title: 'Paiement non abouti.',
                text: 'Rien n’a été débité. Tu peux réessayer depuis ton offre.',
                done: false,
              };

  return (
    <div className="ap-page of-page">
      <header className="of-intro">
        {view.done ? (
          <span className="of-done" aria-hidden="true">
            <Icon name="Check" size={24} />
          </span>
        ) : null}
        <p className="pk-label">{view.eyebrow}</p>
        <h1 className="of-title">{view.title}</h1>
        <p className="of-sub">{view.text}</p>
      </header>

      <p className="of-next">
        {course === null ? null : (
          <Link
            href={`${course}/plan`}
            className={view.done ? 'pk-btn pk-button-primary' : 'pk-btn pk-button-secondary'}
          >
            {view.done ? 'Commencer ma préparation' : 'Aller à ma course'}
          </Link>
        )}
        <Link href="/offre" className="pk-link">
          Mon offre
        </Link>
      </p>
    </div>
  );
}
