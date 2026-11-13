import { OfferView } from '@/app/(shell)/offre/offer-view';

/**
 * Choix de l'offre, en page entière : l'adresse ouverte directement, un retour
 * de paiement abandonné, un rechargement. Depuis l'application, le même contenu
 * s'ouvre en tiroir par-dessus l'écran en cours (`@drawer/(.)offre`).
 */
export const metadata = { title: 'Mon offre' };

export default async function OffrePage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly course?: string; readonly refus?: string }>;
}) {
  const { course, refus } = await searchParams;
  return (
    <div className="ap-page of-page">
      <OfferView course={course} refus={refus} />
    </div>
  );
}
