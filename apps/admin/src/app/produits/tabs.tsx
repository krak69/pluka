import { NavTabs } from '@pluka/ui';

/**
 * Sous-onglets de la Banque Nutrition — `bankAdminNav` du prototype.
 *
 * Trois onglets, donc trois routes (§1.2 de `05_ROUTES_FLOWS.md`) : un
 * administrateur qui veut montrer « la fiche à vérifier » doit pouvoir en
 * envoyer l'adresse.
 *
 * L'onglet courant est passé en paramètre plutôt que déduit de `usePathname` :
 * chaque page connaît sa propre adresse, et ce composant reste un Server
 * Component.
 */
const TABS = [
  { href: '/produits/catalogue', label: 'Produits' },
  { href: '/produits/a-verifier', label: 'À vérifier' },
  { href: '/produits/signalements', label: 'Signalements' },
] as const;

export type ProductTab = (typeof TABS)[number]['href'];

export function ProductTabs({ current }: { readonly current: ProductTab }) {
  return (
    <NavTabs
      label="Sections de la Banque Nutrition"
      tabs={TABS.map((tab) => ({
        href: tab.href,
        label: tab.label,
        current: tab.href === current,
      }))}
    />
  );
}
