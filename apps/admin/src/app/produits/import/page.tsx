import Link from 'next/link';

import { AdminPageHeader } from '@/components/admin-page';
import { requireAdminConsoleGate } from '@/lib/admin';

import { ImportForm } from './import-form';

/**
 * Importer le catalogue — migration 0039. Les colonnes attendues sont celles
 * de l'export nutra.run ; seules Type, Nom, Glucides, Sodium et Caféine sont
 * obligatoires.
 */
export const metadata = { title: 'Importer le catalogue' };

const COLUMNS =
  'Type ; Marque ; Nom ; Saveur ; Poids (g) ; Image URL ; Lien achat ; Kcal ; Glucides (g) ; Sodium (mg) ; Potassium (mg) ; Magnésium (mg) ; Caféine (mg) ; Protéines (g) ; Lipides (g) ; Fibres (g) ; Texture ; Ratio glucose/fructose ; Vegan ; Bio ; Sans gluten ; Tags ; Statut';

export default async function ImportPage() {
  await requireAdminConsoleGate('/produits/import');

  return (
    <main className="ad-page ad-org">
      <Link href="/produits/tous" className="pk-link">
        Banque Nutrition
      </Link>
      <AdminPageHeader
        title="Importer le catalogue"
        lede="Un fichier CSV, une ligne par produit. Les lignes valides entrent en une seule fois ; les lignes rejetées sont listées avec leur raison."
      />
      <p className="pk-body ad-measure">
        Colonnes reconnues : <span className="ad-mono">{COLUMNS}</span>. Obligatoires : Type, Nom,
        Glucides, Sodium, Caféine. Une valeur vide reste vide — jamais remplacée par 0. Seuls les
        tags de faits sont gardés : Caféiné, Riche en glucides, Riche en sodium, Salé, Isotonique,
        Hydrogel.
      </p>
      <ImportForm />
    </main>
  );
}
