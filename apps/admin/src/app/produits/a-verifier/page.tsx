import { listAdminNutritionProducts } from '@pluka/domain';
import { SectionHeader } from '@pluka/ui';

import { ProductList } from '@/app/produits/product-list';
import { ProductTabs } from '@/app/produits/tabs';
import { redirectOnReadError, requireAdminConsoleContext } from '@/lib/admin';

/**
 * Banque Nutrition, fiches à vérifier — statut `draft`.
 *
 * Ces fiches sont invisibles pour tout le monde sauf leur créateur : c'est
 * exactement ce que la policy garantit, et exactement ce qui rendait cet onglet
 * impossible sans RPC dédiée.
 *
 * La validation est une écriture : elle appartient au lot 4b. Cet écran montre
 * la file, il ne la traite pas.
 */
export const metadata = { title: 'Fiches à vérifier' };

export default async function ProductsToVerifyPage() {
  const context = await requireAdminConsoleContext('/produits/a-verifier');
  const products = await listAdminNutritionProducts(context, { status: 'draft' }).catch(
    redirectOnReadError,
  );

  return (
    <main className="ad-page">
      <SectionHeader eyebrow="Administration" title="Banque Nutrition" />

      <ProductTabs current="/produits/a-verifier" />

      <ProductList
        products={products}
        caption={`${products.length} fiche${products.length > 1 ? 's' : ''} en attente`}
        emptyTitle="Aucune fiche en attente."
        emptyDetail="Les produits proposés par les coureurs apparaîtront ici."
      />
    </main>
  );
}
