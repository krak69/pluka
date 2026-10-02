import { listAdminNutritionProducts } from '@pluka/domain';
import { SectionHeader } from '@pluka/ui';

import { ProductList } from '@/app/produits/product-list';
import { ProductTabs } from '@/app/produits/tabs';
import { ConsoleNotice } from '@/components/console-action';
import { consoleNotice, type ConsoleNoticeParams } from '@/lib/console-notice';
import { redirectOnReadError, requireAdminConsoleContext } from '@/lib/admin';

/**
 * Banque Nutrition, fiches à vérifier — statut `draft`.
 *
 * Ces fiches sont invisibles pour tout le monde sauf leur créateur : c'est
 * exactement ce que la policy garantit, et exactement ce qui rendait cet onglet
 * impossible sans RPC dédiée.
 *
 * Chaque fiche se valide ou se refuse depuis sa ligne (lot 4b, migration
 * 0029). Refuser archive la fiche, après confirmation : elle n'est pas
 * supprimée, et le geste figure au journal.
 */
export const metadata = { title: 'Fiches à vérifier' };

export default async function ProductsToVerifyPage({
  searchParams,
}: {
  readonly searchParams: Promise<ConsoleNoticeParams>;
}) {
  const context = await requireAdminConsoleContext('/produits/a-verifier');
  const products = await listAdminNutritionProducts(context, { status: 'draft' }).catch(
    redirectOnReadError,
  );

  return (
    <main className="ad-page">
      <SectionHeader eyebrow="Administration" title="Banque Nutrition" />

      <ConsoleNotice notice={consoleNotice(await searchParams)} />

      <ProductTabs current="/produits/a-verifier" />

      <ProductList
        products={products}
        tab="a-verifier"
        caption={`${products.length} fiche${products.length > 1 ? 's' : ''} en attente`}
        emptyTitle="Aucune fiche en attente."
        emptyDetail="Les produits proposés par les coureurs apparaîtront ici."
      />
    </main>
  );
}
