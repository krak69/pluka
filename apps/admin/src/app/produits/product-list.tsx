import type { AdminNutritionProductRecord } from '@pluka/db';
import Link from 'next/link';

import {
  archiveNutritionProductAction,
  validateNutritionProductAction,
} from '@/app/console-actions';
import { AdminEmpty } from '@/components/admin-page';
import { AdminStatus, productCategoryLabel } from '@/components/admin-status';
import { ConsoleAction } from '@/components/console-action';
import { day } from '@/lib/format';

/**
 * Fiches nutrition — `bankAdminRows` et `bankPending` du prototype.
 *
 * Deux formes, comme le prototype :
 *
 * - **catalogue** : une carte par fiche — nom, « marque · type · valeurs »,
 *   date de vérification, statut ;
 * - **à vérifier** : une carte plus haute — nom, type, valeurs, puis les
 *   gestes sous un filet.
 *
 * GESTES — lot 4b, migration 0029
 *
 * Ils suivent le statut de la fiche, jamais le rôle de la personne qui regarde :
 *
 * - `draft` sur « À vérifier » : Valider, ou Refuser — qui archive ;
 * - `draft` sur le catalogue : un lien vers « À vérifier » ;
 * - `validated` : Archiver, qui la retire des coureurs ;
 * - `archived` : rien — aucune spécification ne décrit de désarchivage.
 *
 * Refuser et Archiver sont destructeurs pour les coureurs : repliés, et
 * confirmés par une case. « Demander correction » et « Fusionner » du
 * prototype n'existent pas en base : ils ne sont pas rendus.
 */

type Product = AdminNutritionProductRecord;

/** « 25 g glucides · 50 mg sodium · 75 mg caféine » — les zéros optionnels se taisent. */
function nutrition(product: Product): string {
  return [
    `${product.carbsG} g glucides`,
    `${product.sodiumMg} mg sodium`,
    product.caffeineMg > 0 ? `${product.caffeineMg} mg caféine` : null,
    product.hydrationMl > 0 ? `${product.hydrationMl} ml d’eau` : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

function productName(product: Product): string {
  return product.variant === null ? product.name : `${product.name} ${product.variant}`;
}

export function CatalogList({ products }: { readonly products: readonly Product[] }) {
  if (products.length === 0) {
    return (
      <AdminEmpty icon="Package" title="Aucune fiche dans la banque.">
        <p>Une fiche naît d’une proposition de coureur ou d’un import PLUKA.</p>
      </AdminEmpty>
    );
  }

  return (
    <ul className="ad-cards" aria-label={`${products.length} fiche${products.length > 1 ? 's' : ''}, tous statuts`}>
      {products.map((product) => (
        <li key={product.productId} className="ad-card">
          <div className="ad-card-main">
            <span className="ad-card-title">{productName(product)}</span>
            <span className="ad-card-meta">
              {product.brand ?? '—'} · {productCategoryLabel(product.category)} ·{' '}
              {nutrition(product)}
            </span>
          </div>

          {/* Jamais vérifiée le dit : « — » se lirait « vérifiée, date inconnue ». */}
          <span className="ad-card-side">
            {product.verifiedAt === null ? 'Jamais vérifiée' : `Vérifiée le ${day(product.verifiedAt)}`}
          </span>
          <AdminStatus domain="product" status={product.status} />
          <CatalogActions product={product} />
        </li>
      ))}
    </ul>
  );
}

function CatalogActions({ product }: { readonly product: Product }) {
  if (product.status === 'archived') return null;

  if (product.status === 'draft') {
    return (
      <Link href="/produits/a-verifier" className="pk-btn pk-button-secondary">
        À vérifier
      </Link>
    );
  }

  return (
    <details className="ad-disclosure">
      <summary>Archiver…</summary>
      <ConsoleAction
        action={archiveNutritionProductAction}
        fields={{ productId: product.productId, from: 'catalogue' }}
        label="Archiver la fiche"
        variant="destructive"
        confirm="Je confirme retirer cette fiche du catalogue des coureurs"
      />
    </details>
  );
}

export function PendingList({ products }: { readonly products: readonly Product[] }) {
  if (products.length === 0) {
    return (
      <AdminEmpty icon="CheckCircle" title="Aucune fiche en attente.">
        <p>Les produits proposés par les coureurs apparaîtront ici.</p>
      </AdminEmpty>
    );
  }

  return (
    <ul className="ad-cards" aria-label={`${products.length} fiche${products.length > 1 ? 's' : ''} en attente`}>
      {products.map((product) => {
        const fields = { productId: product.productId, from: 'a-verifier' };

        return (
          <li key={product.productId} className="ad-card ad-card-stack">
            <span className="ad-card-heading">{productName(product)}</span>
            <span className="ad-card-meta">
              {product.brand ?? 'Sans marque'} · {productCategoryLabel(product.category)}
            </span>
            <p className="ad-card-text">{nutrition(product)}</p>

            <div className="ad-card-actions ad-card-footer">
              <ConsoleAction
                action={validateNutritionProductAction}
                fields={fields}
                label="Valider"
                variant="primary"
              />

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
          </li>
        );
      })}
    </ul>
  );
}
