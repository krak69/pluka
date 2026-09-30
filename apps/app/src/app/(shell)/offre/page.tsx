import { SectionHeader } from '@pluka/ui';

import { NotWired } from '@/components/not-wired';

/**
 * Choix de l'offre — `05_ROUTES_FLOWS.md` §5.3.
 *
 * Aucune grille tarifaire n'est affichée ici. Les prix du prototype marketing
 * sont du contenu éditorial de `apps/www` ; les reprendre dans l'application
 * laisserait croire qu'on peut acheter, alors qu'aucun prestataire de paiement
 * n'est configuré.
 *
 * `04_ENTITLEMENTS.md` §25 et §26 décrivent le paiement et son webhook sans
 * fixer le parcours, et la forme de la route de paiement dépend du contrat du
 * prestataire retenu — c'est le cas ouvert §12.8 de 05_ROUTES_FLOWS.
 *
 * Ce que le coureur peut faire sans offre reste entier : §41 place le Plan
 * initial consultable dans le socle Free.
 */
export default function OffrePage() {
  return (
    <div className="ap-page">
      <SectionHeader eyebrow="Mon compte" title="Choix de l’offre" />

      <NotWired
        area="Offre et paiement"
        purpose="Tu choisiras ici entre préparer une seule course et accompagner toute ta saison."
        detail="Aucun prestataire de paiement n’est branché, et aucun achat n’est possible. Pendant la phase de test, les fonctionnalités sont ouvertes sans offre."
      />
    </div>
  );
}
