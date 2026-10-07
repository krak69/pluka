import type { NutritionCatalogueRow } from '@pluka/db';
import Link from 'next/link';

import {
  archiveNutritionProductAction,
  validateNutritionProductAction,
} from '@/app/console-actions';
import { deleteNutritionProductAction } from '@/app/nutrition-actions';
import { AdminIcon } from '@/components/admin-icon';
import { AdminEmpty, Chip } from '@/components/admin-page';
import { AdminStatus, productCategoryLabel } from '@/components/admin-status';
import { ConsoleAction } from '@/components/console-action';

/**
 * Liste du catalogue — sur le modèle de nutra.run, dans la grammaire PLUKA :
 * une ligne bord à bord par fiche (06_DESIGN_SYSTEM §38), image, nom,
 * marque · saveur, type, nutrition, tags, achat, statut, gestes.
 *
 * GESTES
 *
 * - Modifier : toujours ;
 * - Valider : une fiche à vérifier ;
 * - Archiver : une fiche à vérifier (la refuser) ou validée (la retirer) ;
 * - Supprimer : seulement si personne ne l'utilise — sinon elle s'archive.
 *
 * Archiver et supprimer se confirment par une case ; la base les revérifie.
 */

type Product = NutritionCatalogueRow;
export type ProductListTab = 'a-verifier' | 'catalogue' | 'archives' | 'tous';

/** La ligne courte de nutra.run — « 101 kcal · 25 g · 114 mg Na · 100 mg caf ». */
function shortNutrition(product: Product): string {
  return [
    product.caloriesKcal === null ? null : `${product.caloriesKcal} kcal`,
    `${formatNumber(product.carbsG)} g`,
    `${product.sodiumMg} mg Na`,
    product.caffeineMg > 0 ? `${product.caffeineMg} mg caf` : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

/** La même, en toutes lettres : ce que lit un lecteur d'écran. */
function nutrition(product: Product): string {
  return [
    product.caloriesKcal === null ? null : `${product.caloriesKcal} kilocalories`,
    `${formatNumber(product.carbsG)} grammes de glucides`,
    `${product.sodiumMg} milligrammes de sodium`,
    product.caffeineMg > 0 ? `${product.caffeineMg} milligrammes de caféine` : null,
  ]
    .filter((part) => part !== null)
    .join(', ');
}

function formatNumber(value: number): string {
  return value.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function subtitle(product: Product): string {
  return [product.brand, product.variant].filter((part) => part !== null).join(' · ');
}

export function ProductTable({
  products,
  tab,
}: {
  readonly products: readonly Product[];
  readonly tab: ProductListTab;
}) {
  if (products.length === 0) {
    return (
      <AdminEmpty icon="Package" title="Aucune fiche ici.">
        <p>Une fiche naît d’un import CSV, d’une création, ou d’une proposition de coureur.</p>
      </AdminEmpty>
    );
  }

  return (
    <ul className="ad-rows ad-products" aria-label={`${products.length} fiche(s)`}>
      {products.map((product) => (
        <li key={product.productId} className="ad-row ad-product">
          <span className="ad-product-thumb" aria-hidden="true">
            {product.imageUrl === null ? (
              <AdminIcon name="Package" size={20} />
            ) : (
              // Image du fabricant, servie par lui : pas de referrer, chargement différé.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
            )}
          </span>

          <div className="ad-row-main">
            <span className="ad-row-title">{product.name}</span>
            <span className="ad-row-meta">{subtitle(product) || 'Sans marque'}</span>
          </div>

          <Chip tone="neutral" plain>
            {productCategoryLabel(product.category)}
          </Chip>

          <span className="ad-product-nutrition" aria-label={nutrition(product)}>
            {shortNutrition(product)}
          </span>

          <span className="ad-product-tags">
            {product.tags.map((tag) => (
              <Chip key={tag} tone="neutral" plain>
                {tag}
              </Chip>
            ))}
          </span>

          <span className="ad-product-purchase">
            {product.purchaseUrl === null ? null : (
              <a href={product.purchaseUrl} className="pk-link" target="_blank" rel="noreferrer">
                Acheter
                {product.purchaseIsAffiliate ? (
                  <span className="ad-affiliate"> · lien affilié</span>
                ) : null}
              </a>
            )}
          </span>

          <AdminStatus domain="product" status={product.status} />

          <div className="ad-row-actions ad-product-actions">
            <Link
              href={`/produits/${product.productId}`}
              className="pk-btn pk-button-secondary"
              aria-label={`Modifier ${product.name}`}
            >
              Modifier
            </Link>

            {product.status === 'draft' ? (
              <ConsoleAction
                action={validateNutritionProductAction}
                fields={{ productId: product.productId, from: tab }}
                label="Valider"
              />
            ) : null}

            {product.status === 'archived' ? null : (
              <details className="ad-disclosure ad-row-disclosure">
                <summary>{product.status === 'draft' ? 'Refuser…' : 'Archiver…'}</summary>
                <ConsoleAction
                  action={archiveNutritionProductAction}
                  fields={{ productId: product.productId, from: tab }}
                  label={product.status === 'draft' ? 'Refuser la fiche' : 'Archiver la fiche'}
                  variant="destructive"
                  confirm="Je confirme retirer cette fiche des coureurs"
                />
              </details>
            )}

            {product.inUse ? null : (
              <details className="ad-disclosure ad-row-disclosure">
                <summary>Supprimer…</summary>
                <ConsoleAction
                  action={deleteNutritionProductAction}
                  fields={{ productId: product.productId, from: tab }}
                  label="Supprimer la fiche"
                  variant="destructive"
                  confirm="Je confirme supprimer définitivement cette fiche"
                />
              </details>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
