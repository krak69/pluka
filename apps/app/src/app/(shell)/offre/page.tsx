import { SectionHeader } from '@pluka/ui';

import { NotWired } from '@/components/not-wired';
import { activeBetaAccess } from '@/lib/beta';
import { requireSession } from '@/lib/session';

/**
 * Choix de l'offre — `05_ROUTES_FLOWS.md` §5.3.
 *
 * Aucune grille tarifaire n'est affichée ici. Les prix du prototype marketing
 * sont du contenu éditorial de `apps/www` ; les reprendre dans l'application
 * laisserait croire qu'on peut acheter, alors qu'aucun prestataire de paiement
 * n'est configuré.
 *
 * L'écran dit ce que le coureur a réellement : un accès bêta en cours
 * (04_ENTITLEMENTS §14, migration 0073), ou rien de plus que le socle gratuit.
 * Il ne promet jamais un accès que la base ne lui donne pas.
 */
export const metadata = { title: 'Mon offre' };

function day(instant: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(new Date(instant));
}

export default async function OffrePage() {
  const session = await requireSession('/offre');
  const beta = await activeBetaAccess(session);

  return (
    <div className="ap-page">
      <SectionHeader eyebrow="Mon compte" title="Mon offre" />

      {beta === null ? (
        <NotWired
          area="Offre et paiement"
          purpose="Tu choisiras ici entre préparer une seule course et accompagner toute ta saison."
          detail="Aucun paiement n’est encore possible. Ton accès est gratuit : informations de course, premier Plan et Conditions officielles. Les testeurs invités par PLUKA ont l’accès complet pendant la bêta."
        />
      ) : (
        <section className="rp-repere-result" aria-labelledby="beta-title">
          <h2 id="beta-title" className="pk-h2">
            Accès bêta ouvert
          </h2>
          <p className="pk-body">
            Tu fais partie des testeurs : tout PLUKA est ouvert, sur toutes tes courses
            {beta.endsAt === null ? '' : `, jusqu’au ${day(beta.endsAt)}`}. Ensuite, ton compte
            revient à l’accès gratuit, et ta préparation reste la tienne.
          </p>
        </section>
      )}
    </div>
  );
}
