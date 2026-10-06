import { NavTabs } from '@pluka/ui';

import { AdminPageHeader } from '@/components/admin-page';

/**
 * En-tête de la Banque Nutrition — `adminProduits` et `bankAdminNav` du
 * prototype : titre, phrase, puis trois sous-onglets.
 *
 * Trois onglets, donc trois routes (§1.2 de `05_ROUTES_FLOWS.md`) : un
 * administrateur qui veut montrer « la fiche à vérifier » doit pouvoir en
 * envoyer l'adresse. L'en-tête est le même sur les trois, comme dans le
 * prototype.
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

export function BankHeader({ current }: { readonly current: ProductTab }) {
  return (
    <>
      <AdminPageHeader
        title="Banque Nutrition"
        lede="Catalogue mutualisé des produits nutritionnels. Les fiches validées sont trouvables par tous les coureurs ; les propositions restent privées à leur créateur jusqu’à validation."
      />

      <NavTabs
        className="ad-subtabs"
        label="Sections de la Banque Nutrition"
        tabs={TABS.map((tab) => ({
          href: tab.href,
          label: tab.label,
          current: tab.href === current,
        }))}
      />
    </>
  );
}
