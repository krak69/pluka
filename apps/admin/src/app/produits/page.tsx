import { redirect } from 'next/navigation';

/**
 * `/produits` n'a pas d'écran propre : c'est le segment de regroupement des
 * trois sous-onglets. §1.6 de `05_ROUTES_FLOWS.md` — un tel segment redirige
 * vers son premier enfant plutôt que de rendre une page vide.
 */
export default function ProductsIndexPage() {
  redirect('/produits/catalogue');
}
