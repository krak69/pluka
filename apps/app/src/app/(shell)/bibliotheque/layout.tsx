import type { ReactNode } from 'react';

import { SubTabs } from '@/components/sub-tabs';

/**
 * Bibliothèque — quatre onglets, quatre routes (`05_ROUTES_FLOWS.md` §5.1).
 *
 * Le bandeau vit dans le layout pour que les quatre pages n'aient pas à le
 * répéter, et pour qu'il ne clignote pas d'un onglet à l'autre.
 */
const TABS = [
  { href: '/bibliotheque/materiel', label: 'Matériel' },
  { href: '/bibliotheque/produits', label: 'Produits' },
  { href: '/bibliotheque/sacs', label: 'Sacs' },
  { href: '/bibliotheque/strategies', label: 'Stratégies' },
];

export default function BibliothequeLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="ap-page">
      <SubTabs label="Sections de la bibliothèque" tabs={TABS} />
      {children}
    </div>
  );
}
