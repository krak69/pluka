import { SectionHeader } from '@pluka/ui';

import { NotWired } from '@/components/not-wired';

/**
 * Bibliothèque · Produits — écran non branché.
 *
 * Tables présentes, aucun service de domaine.
 */
export default function Page() {
  return (
    <div className="ap-page">
      <SectionHeader eyebrow="Ma bibliothèque" title="Produits" />

      <NotWired
        area="Bibliothèque · Produits"
        purpose="Les produits que tu réutilises, avec ce que tu en sais."
        detail="La bibliothèque n'est pas encore lisible."
      />
    </div>
  );
}
