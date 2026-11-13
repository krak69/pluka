import { OfferView } from '@/app/(shell)/offre/offer-view';
import { SideDrawer } from '@/components/side-drawer';

/**
 * `/offre` ouvert depuis l'application : le tiroir des formules par-dessus
 * l'écran en cours (prototype, `tiersOpen`). L'adresse reste `/offre` ; ouverte
 * directement ou rechargée, c'est la page entière qui s'affiche.
 */
export default async function OfferDrawer({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly course?: string; readonly refus?: string }>;
}) {
  const { course, refus } = await searchParams;
  return (
    <SideDrawer labelledBy="of-title">
      <div className="of-page of-in-drawer">
        <OfferView course={course} refus={refus} inDrawer />
      </div>
    </SideDrawer>
  );
}
