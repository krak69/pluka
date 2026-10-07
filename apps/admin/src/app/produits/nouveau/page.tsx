import Link from 'next/link';

import { AdminPageHeader } from '@/components/admin-page';
import { requireAdminConsoleGate } from '@/lib/admin';

import { EMPTY_PRODUCT, ProductForm } from '../product-form';

/**
 * Nouveau produit — migration 0039. La garde d'entrée renvoie un compte hors
 * administration vers `/refuse` ; `admin_save_nutrition_product` revérifie à
 * l'envoi.
 */
export const metadata = { title: 'Nouveau produit' };

export default async function NewProductPage() {
  await requireAdminConsoleGate('/produits/nouveau');

  return (
    <main className="ad-page ad-org">
      <Link href="/produits/tous" className="pk-link">
        Banque Nutrition
      </Link>
      <AdminPageHeader title="Nouveau produit" />
      <ProductForm product={EMPTY_PRODUCT} />
    </main>
  );
}
