import type { AdminNutritionProductRecord } from '@pluka/db';
import { EmptyState, Table } from '@pluka/ui';

import Link from 'next/link';

import {
  archiveNutritionProductAction,
  validateNutritionProductAction,
} from '@/app/console-actions';
import { AdminStatus, productCategoryLabel } from '@/components/admin-status';
import { ConsoleAction } from '@/components/console-action';
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
 *
 * GESTES — lot 4b, migration 0029
 *
 * La colonne « Action » suit le statut de la fiche, jamais le rôle de la
 * personne qui regarde :
 *
 * - `draft` sur « À vérifier » : Valider, ou Refuser — qui archive ;
 * - `draft` sur le catalogue : un lien vers « À vérifier », où la fiche se
 *   compare aux autres propositions ;
 * - `validated` : Archiver, qui la retire des coureurs ;
 * - `archived` : rien — aucune spécification ne décrit de désarchivage.
 *
 * Refuser et Archiver sont destructeurs pour les coureurs : repliés derrière
 * un « … », et confirmés par une case.
 */
export function ProductList({
  products,
  tab,
  caption,
  emptyTitle,
  emptyDetail,
}: {
  readonly products: readonly AdminNutritionProductRecord[];
  /** L'onglet qui affiche la liste : les gestes y reviennent après succès. */
  readonly tab: 'catalogue' | 'a-verifier';
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
        { key: 'action', label: 'Action' },
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
          action: <ProductActions product={product} tab={tab} />,
        },
      }))}
    />
  );
}

function ProductActions({
  product,
  tab,
}: {
  readonly product: AdminNutritionProductRecord;
  readonly tab: 'catalogue' | 'a-verifier';
}) {
  const fields = { productId: product.productId, from: tab };

  if (product.status === 'archived') {
    return <span className="ad-muted">archivée</span>;
  }

  if (product.status === 'draft' && tab === 'catalogue') {
    return (
      <Link href="/produits/a-verifier" className="pk-link">
        À vérifier
      </Link>
    );
  }

  if (product.status === 'draft') {
    return (
      <div className="ad-action">
        <ConsoleAction action={validateNutritionProductAction} fields={fields} label="Valider" />

        <details className="ad-disclosure">
          <summary>Refuser…</summary>
          <ConsoleAction
            action={archiveNutritionProductAction}
            fields={fields}
            label="Refuser la fiche"
            variant="destructive"
            confirm="Je confirme refuser cette fiche : elle ne sera pas proposée aux coureurs"
          />
        </details>
      </div>
    );
  }

  return (
    <details className="ad-disclosure">
      <summary>Archiver…</summary>
      <ConsoleAction
        action={archiveNutritionProductAction}
        fields={fields}
        label="Archiver la fiche"
        variant="destructive"
        confirm="Je confirme retirer cette fiche du catalogue des coureurs"
      />
    </details>
  );
}
