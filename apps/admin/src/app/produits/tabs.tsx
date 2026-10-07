import { NavTabs } from '@pluka/ui';
import Link from 'next/link';

import { AdminIcon } from '@/components/admin-icon';
import { AdminPageHeader } from '@/components/admin-page';

/**
 * En-tête de la Banque Nutrition — `adminProduits` du prototype, étendu sur
 * le modèle du catalogue nutra.run (migration 0039) : titre, phrase, les deux
 * gestes de création — importer, créer — puis un onglet par statut, avec son
 * compte.
 *
 * Chaque onglet est une route (§1.2 de `05_ROUTES_FLOWS.md`) : on doit
 * pouvoir envoyer l'adresse de « les fiches à vérifier ».
 */
const TABS = [
  { href: '/produits/a-verifier', label: 'À vérifier', status: 'draft' },
  { href: '/produits/catalogue', label: 'Validés', status: 'validated' },
  { href: '/produits/archives', label: 'Archivés', status: 'archived' },
  { href: '/produits/tous', label: 'Tous', status: null },
  { href: '/produits/signalements', label: 'Signalements', status: undefined },
] as const;

export type ProductTab = (typeof TABS)[number]['href'];

export interface BankCounts {
  readonly draft: number;
  readonly validated: number;
  readonly archived: number;
}

function labelOf(tab: (typeof TABS)[number], counts: BankCounts | null): string {
  if (counts === null || tab.status === undefined) return tab.label;
  const total =
    tab.status === null ? counts.draft + counts.validated + counts.archived : counts[tab.status];
  return `${tab.label} (${total})`;
}

export function BankHeader({
  current,
  counts = null,
}: {
  readonly current: ProductTab;
  readonly counts?: BankCounts | null;
}) {
  return (
    <>
      <AdminPageHeader
        title="Banque Nutrition"
        lede="Catalogue mutualisé des produits nutritionnels. Les fiches validées sont trouvables par tous les coureurs ; les propositions restent privées à leur créateur jusqu’à validation."
        aside={
          <div className="ad-bank-actions">
            <Link href="/produits/import" className="pk-btn pk-button-secondary">
              <AdminIcon name="Tray" size={16} />
              Importer un CSV
            </Link>
            <Link href="/produits/nouveau" className="pk-btn pk-button-primary">
              <AdminIcon name="Plus" size={16} />
              Nouveau produit
            </Link>
          </div>
        }
      />

      <NavTabs
        className="ad-subtabs"
        label="Sections de la Banque Nutrition"
        tabs={TABS.map((tab) => ({
          href: tab.href,
          label: labelOf(tab, counts),
          current: tab.href === current,
        }))}
      />
    </>
  );
}
