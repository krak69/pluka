import { SectionHeader } from '@pluka/ui';

import { NotWired } from '@/components/not-wired';

/**
 * Mes sorties — écran non branché.
 *
 * Tables présentes ; `consumeLinkedOutingQuota` existe côté domaine. Aucun use case de lecture ou d'écriture de sortie.
 */
export default function Page() {
  return (
    <div className="ap-page">
      <SectionHeader eyebrow="Ma saison" title="Mes sorties" />

      <NotWired
        area="Mes sorties"
        purpose="Tes sorties de préparation, préparées comme des courses : profil, durée estimée, jalons nutrition et checklist."
        detail="Le quota de sorties liées est déjà géré, mais aucun service ne lit ni n'écrit encore une sortie."
      />
    </div>
  );
}
