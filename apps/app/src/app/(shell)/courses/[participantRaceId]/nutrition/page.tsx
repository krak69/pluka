import { SectionHeader } from '@pluka/ui';

import { NotWired } from '@/components/not-wired';

/**
 * Nutrition — écran non branché.
 *
 * Tables présentes ; aucun moteur Nutrition. Voir docs/engines/NUTRITION_ENGINE.md.
 */
export default function Page() {
  return (
    <div className="ap-page">
      <SectionHeader eyebrow="Ma course" title="Nutrition" />

      <NotWired
        area="Nutrition"
        purpose="Tes cibles horaires réparties le long de ton plan, section par section, avec ce qu'il faut préparer avant le départ."
        detail="Le moteur Nutrition n'est pas encore branché."
      />
    </div>
  );
}
