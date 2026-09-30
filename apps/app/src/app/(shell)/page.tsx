import { SectionHeader } from '@pluka/ui';

import { signOut } from '@/app/actions';
import { NotWired } from '@/components/not-wired';

/**
 * Accueil coureur — `05_ROUTES_FLOWS.md` §5.1.
 *
 * Les tables de préparation existent ; aucun agrégat d'accueil n'est calculé.
 *
 * Server Component. L'écran du prototype ordonne des actions prioritaires
 * calculées sur le matériel, les sacs, les tâches et les conditions : aucun de
 * ces agrégats n'existe côté serveur. L'état vide le dit plutôt que de classer
 * des actions inventées.
 */
export default function HomePage() {
  return (
    <div className="ap-page">
      <SectionHeader eyebrow="Ma saison" title="Accueil" />

      <NotWired
        area="Accueil"
        purpose="Cet écran classera ce qui mérite ton attention en premier : matériel manquant, sacs à compléter, tâches avant le départ et conditions annoncées."
        detail="Aucun service ne calcule encore ces priorités : il n'y a rien à classer."
      />

      <form action={signOut}>
        <button type="submit" className="pk-btn pk-button-secondary">
          Se déconnecter
        </button>
      </form>
    </div>
  );
}
