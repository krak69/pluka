import { redirect } from 'next/navigation';

/**
 * `05_ROUTES_FLOWS.md` §9.3 : un segment de regroupement sans écran propre
 * redirige vers son premier enfant plutôt que de rendre une page vide.
 */
export default function BibliothequePage() {
  redirect('/bibliotheque/materiel');
}
