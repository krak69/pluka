import { listAdminNutritionProducts } from '@pluka/domain';
import { SectionHeader } from '@pluka/ui';

import { ProductList } from '@/app/produits/product-list';
import { ProductTabs } from '@/app/produits/tabs';
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

export default async function ProductCatalogPage() {
  const context = await requireAdminConsoleContext('/produits/catalogue');
  const products = await listAdminNutritionProducts(context, {}).catch(redirectOnReadError);

  return (
    <main className="ad-page">
      <SectionHeader eyebrow="Administration" title="Banque Nutrition" />

      <p className="pk-body ad-measure">
        Catalogue mutualisé des produits nutritionnels. Les fiches validées sont trouvables par tous
        les coureurs ; les propositions restent privées à leur créateur jusqu’à validation.
      </p>

      <ProductTabs current="/produits/catalogue" />

      <ProductList
        products={products}
        caption={`${products.length} fiche${products.length > 1 ? 's' : ''}, tous statuts`}
        emptyTitle="Aucune fiche dans la banque."
        emptyDetail="Le catalogue est interrogé tous statuts confondus : il est réellement vide."
      />
    </main>
  );
}
