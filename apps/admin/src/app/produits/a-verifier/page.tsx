import { listAdminNutritionProducts } from '@pluka/domain';

import { PendingList } from '@/app/produits/product-list';
import { BankHeader } from '@/app/produits/tabs';
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
      <BankHeader current="/produits/a-verifier" />

      <ConsoleNotice notice={consoleNotice(await searchParams)} />

      <PendingList products={products} />
    </main>
  );
}
