import type { AdminNutritionProductRecord } from '@pluka/db';
import { EmptyState, Table } from '@pluka/ui';

import { AdminStatus, productCategoryLabel } from '@/components/admin-status';
import { day } from '@/lib/format';

/**
 * Liste de fiches nutrition.
 *
 * Deux onglets affichent la même donnée sous deux filtres : une seule table,
 * paramétrée par son état vide. Les dupliquer ferait diverger l'ordre des
 * colonnes d'un onglet à l'autre.
 *
 * Les quatre valeurs nutritionnelles sont en colonnes numériques : c'est
 * précisément ce qu'un vérificateur compare d'une fiche à l'autre (§54).
 */
export function ProductList({
  products,
  caption,
  emptyTitle,
  emptyDetail,
}: {
  readonly products: readonly AdminNutritionProductRecord[];
  readonly caption: string;
  readonly emptyTitle: string;
  readonly emptyDetail: string;
}) {
  if (products.length === 0) {
    return (
      <EmptyState label="Banque Nutrition" title={emptyTitle} detail={emptyDetail}>
        <p>Une fiche naît d’une proposition de coureur ou d’un import PLUKA.</p>
      </EmptyState>
    );
  }

  return (
    <Table
      caption={caption}
      columns={[
        { key: 'name', label: 'Produit' },
        { key: 'category', label: 'Type' },
        { key: 'carbs', label: 'Glucides', unit: 'g', align: 'numeric' },
        { key: 'sodium', label: 'Sodium', unit: 'mg', align: 'numeric' },
        { key: 'caffeine', label: 'Caféine', unit: 'mg', align: 'numeric' },
        { key: 'hydration', label: 'Eau', unit: 'ml', align: 'numeric' },
        { key: 'status', label: 'Statut' },
        { key: 'verified', label: 'Vérifiée le' },
      ]}
      rows={products.map((product) => ({
        key: product.productId,
        cells: {
          name: (
            <>
              <span>{product.name}</span>
              <span className="ad-sub">
                {[product.brand, product.variant].filter((part) => part !== null).join(' · ') ||
                  'sans marque'}
              </span>
            </>
          ),
          category: productCategoryLabel(product.category),
          carbs: product.carbsG,
          sodium: product.sodiumMg,
          caffeine: product.caffeineMg,
          hydration: product.hydrationMl,
          status: <AdminStatus domain="product" status={product.status} />,
          /* Une fiche jamais vérifiée le dit : « — » se lirait « vérifiée, date
             inconnue », qui est le contraire. */
          verified:
            product.verifiedAt === null ? (
              <span className="ad-muted">jamais</span>
            ) : (
              day(product.verifiedAt)
            ),
        },
      }))}
    />
  );
}
