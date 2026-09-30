import { SectionHeader } from '@pluka/ui';

import { NotWired } from '@/components/not-wired';

/**
 * Préparation · Sacs — écran non branché.
 *
 * Tables présentes, aucun service de domaine.
 */
export default function Page() {
  return (
    <div className="ap-page">
      <SectionHeader eyebrow="Ma course" title="Sacs" />

      <NotWired
        area="Préparation · Sacs"
        purpose="Tes sacs remplis depuis ton plan : ce que chacun contient, et quand le déposer."
        detail="Les sacs ne sont pas encore branchés."
      />
    </div>
  );
}
