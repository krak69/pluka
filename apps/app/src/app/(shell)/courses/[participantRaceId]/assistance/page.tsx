import { SectionHeader } from '@pluka/ui';

import { NotWired } from '@/components/not-wired';

/**
 * Assistance — écran non branché.
 *
 * Tables présentes, aucun service. Le payload sûr de 03_PRIVACY_RLS §46 n'est pas implémenté : rien ne doit être partagé avant.
 */
export default function Page() {
  return (
    <div className="ap-page">
      <SectionHeader eyebrow="Ma course" title="Assistance" />

      <NotWired
        area="Assistance"
        purpose="Où ton accompagnant doit être, à quelle heure, et ce qu'il doit t'apporter — avec un lien privé à lui envoyer."
        detail="L'assistance n'est pas encore branchée, et le lien privé n'est pas encore émis."
      />
    </div>
  );
}
