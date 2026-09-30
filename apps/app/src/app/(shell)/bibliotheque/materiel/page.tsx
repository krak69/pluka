import { SectionHeader } from '@pluka/ui';

import { NotWired } from '@/components/not-wired';

/**
 * Bibliothèque · Matériel — écran non branché.
 *
 * Tables présentes, aucun service. `library.edit` est un droit PLUKA+ (04_ENTITLEMENTS §48).
 */
export default function Page() {
  return (
    <div className="ap-page">
      <SectionHeader eyebrow="Ma bibliothèque" title="Matériel" />

      <NotWired
        area="Bibliothèque · Matériel"
        purpose="Tes modèles de matériel, réutilisables d'une course à l'autre."
        detail="La bibliothèque n'est pas encore lisible. Sa modification demandera un PLUKA+."
      />
    </div>
  );
}
