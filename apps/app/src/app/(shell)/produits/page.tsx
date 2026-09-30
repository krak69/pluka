import { SectionHeader } from '@pluka/ui';

import { NotWired } from '@/components/not-wired';

/**
 * Mes produits — écran non branché.
 *
 * Tables présentes, aucun service de domaine.
 */
export default function Page() {
  return (
    <div className="ap-page">
      <SectionHeader eyebrow="Ma bibliothèque" title="Mes produits" />

      <NotWired
        area="Mes produits"
        purpose="Ta banque de produits : ce que tu utilises, ce que tu supportes, ce que tu veux éviter."
        detail="La banque de produits n'est pas encore lisible."
      />
    </div>
  );
}
