import { listAdminNutritionProducts } from '@pluka/domain';

import { CatalogList } from '@/app/produits/product-list';
import { BankHeader } from '@/app/produits/tabs';
import { ConsoleNotice } from '@/components/console-action';
import { consoleNotice, type ConsoleNoticeParams } from '@/lib/console-notice';
import { redirectOnReadError, requireAdminConsoleContext } from '@/lib/admin';

/**
 * Banque Nutrition, catalogue — tous statuts.
 *
 * Le prototype affiche la pastille de statut sur chaque ligne de cet onglet :
 * le catalogue n'est donc pas « les fiches validées » mais « les fiches, avec
 * leur état ». `nutrition_products__select__validated` n'ouvre que les
 * validées, d'où `admin_list_nutrition_products`.
 */
export const metadata = { title: 'Banque Nutrition' };

export default async function ProductCatalogPage({
  searchParams,
}: {
  readonly searchParams: Promise<ConsoleNoticeParams>;
}) {
  const context = await requireAdminConsoleContext('/produits/catalogue');
  const products = await listAdminNutritionProducts(context, {}).catch(redirectOnReadError);

  return (
    <main className="ad-page">
      <BankHeader current="/produits/catalogue" />

      <ConsoleNotice notice={consoleNotice(await searchParams)} />

      <CatalogList products={products} />
    </main>
  );
}
