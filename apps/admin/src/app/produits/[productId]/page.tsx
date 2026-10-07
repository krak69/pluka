import { DomainError, getNutritionProduct } from '@pluka/domain';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AdminPageHeader } from '@/components/admin-page';
import { AdminStatus, productCategoryLabel } from '@/components/admin-status';
import { ConsoleNotice } from '@/components/console-action';
import { nutritionCatalogueContext, redirectOnReadError } from '@/lib/admin';
import { consoleNotice, type ConsoleNoticeParams } from '@/lib/console-notice';
import { day } from '@/lib/format';
import { requireSession } from '@/lib/session';

import { ProductForm } from '../product-form';

/**
 * Fiche produit — édition (migration 0039). Modifier une fiche ne change pas
 * une stratégie déjà confirmée : elle garde ses valeurs (NUTRITION_ENGINE
 * §734).
 */
export const metadata = { title: 'Fiche produit' };

export default async function ProductPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly productId: string }>;
  readonly searchParams: Promise<ConsoleNoticeParams>;
}) {
  const { productId } = await params;
  const session = await requireSession(`/produits/${productId}`);
  const product = await getNutritionProduct(nutritionCatalogueContext(session), {
    productId,
  }).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === 'validation') notFound();
    return redirectOnReadError(error);
  });

  return (
    <main className="ad-page ad-org">
      <Link href="/produits/tous" className="pk-link">
        Banque Nutrition
      </Link>

      <AdminPageHeader
        title={product.name}
        aside={<AdminStatus domain="product" status={product.status} />}
        lede={[
          [product.brand, product.variant].filter((part) => part !== null).join(' · '),
          productCategoryLabel(product.category),
          product.verifiedAt === null
            ? 'jamais vérifiée'
            : `vérifiée le ${day(product.verifiedAt)}`,
        ]
          .filter((part) => part !== '')
          .join(' — ')}
      />

      <ConsoleNotice notice={consoleNotice(await searchParams)} />

      {product.imageUrl === null ? null : (
        <span className="ad-product-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={product.imageUrl}
            alt={`Visuel de ${product.name}`}
            referrerPolicy="no-referrer"
          />
        </span>
      )}

      <ProductForm product={product} />
    </main>
  );
}
