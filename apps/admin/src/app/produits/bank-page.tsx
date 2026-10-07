import { listNutritionCatalogue } from '@pluka/domain';

import { BankHeader, type ProductTab } from '@/app/produits/tabs';
import { ProductTable, type ProductListTab } from '@/app/produits/product-table';
import { AdminIcon } from '@/components/admin-icon';
import { ConsoleNotice } from '@/components/console-action';
import { nutritionCatalogueContext, redirectOnReadError } from '@/lib/admin';
import { consoleNotice, type ConsoleNoticeParams } from '@/lib/console-notice';
import { requireSession } from '@/lib/session';

/**
 * Un onglet de la Banque Nutrition : en-tête avec ses compteurs, recherche,
 * liste. Les quatre onglets de statut partagent cette page ; seul le filtre
 * change.
 *
 * La recherche est un formulaire GET : l'adresse porte la requête, et un
 * résultat se partage (§1.2).
 */
export async function BankTabPage({
  tab,
  status,
  searchParams,
}: {
  readonly tab: ProductListTab;
  readonly status: 'draft' | 'validated' | 'archived' | null;
  readonly searchParams: Promise<ConsoleNoticeParams>;
}) {
  const params = await searchParams;
  const raw = params['q'];
  const query = typeof raw === 'string' ? raw.trim().slice(0, 100) : '';
  const path = `/produits/${tab}` as ProductTab;

  const session = await requireSession(path);
  const { products, counts } = await listNutritionCatalogue(nutritionCatalogueContext(session), {
    status,
    query: query === '' ? null : query,
  }).catch(redirectOnReadError);

  return (
    <main className="ad-page">
      <BankHeader current={path} counts={counts} />

      <ConsoleNotice notice={consoleNotice(params)} />

      <form role="search" method="get" className="ad-search ad-bank-search">
        <label htmlFor="bank-search" className="ad-visually-hidden">
          Rechercher dans la Banque Nutrition
        </label>
        <AdminIcon name="MagnifyingGlass" size={17} />
        <input
          id="bank-search"
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Rechercher par nom, marque, saveur, type…"
          className="pk-input"
        />
      </form>

      <ProductTable products={products} tab={tab} />
    </main>
  );
}
