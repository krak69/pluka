import { SectionHeader } from '@pluka/ui';

import { NotWired } from '@/components/not-wired';

/**
 * Bibliothèque · Stratégies — écran non branché.
 *
 * Table présente, aucun service. `strategy.reuse` est un droit PLUKA+ (04_ENTITLEMENTS §49).
 */
export default function Page() {
  return (
    <div className="ap-page">
      <SectionHeader eyebrow="Ma bibliothèque" title="Stratégies" />

      <NotWired
        area="Bibliothèque · Stratégies"
        purpose="Les stratégies qui ont fonctionné pour toi, rejouables sur une prochaine course."
        detail="Les stratégies réutilisables demanderont un PLUKA+, et ne sont pas encore disponibles."
      />
    </div>
  );
}
