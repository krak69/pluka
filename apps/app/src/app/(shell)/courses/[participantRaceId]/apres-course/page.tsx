import { SectionHeader } from '@pluka/ui';

import { NotWired } from '@/components/not-wired';

/**
 * Après-course — écran non branché.
 *
 * Tables présentes, aucun service. La publication est soumise au consentement (03_PRIVACY_RLS §57).
 */
export default function Page() {
  return (
    <div className="ap-page">
      <SectionHeader eyebrow="Ma course" title="Après-course" />

      <NotWired
        area="Après-course"
        purpose="Ton bilan une fois la course finie : ce qui a tenu, ce qui a lâché, ce que tu garderas pour la prochaine."
        detail="Le bilan n'est pas encore branché."
      />
    </div>
  );
}
