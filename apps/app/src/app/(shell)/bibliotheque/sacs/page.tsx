import { SectionHeader } from '@pluka/ui';

import { NotWired } from '@/components/not-wired';

/**
 * Bibliothèque · Sacs — écran non branché.
 *
 * Tables présentes, aucun service de domaine.
 */
export default function Page() {
  return (
    <div className="ap-page">
      <SectionHeader eyebrow="Ma bibliothèque" title="Sacs" />

      <NotWired
        area="Bibliothèque · Sacs"
        purpose="Tes modèles de sacs : assistance, arrivée, base vie."
        detail="La bibliothèque n'est pas encore lisible."
      />
    </div>
  );
}
