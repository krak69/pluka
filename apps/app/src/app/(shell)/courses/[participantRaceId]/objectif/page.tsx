import { SectionHeader } from '@pluka/ui';

import { NotWired } from '@/components/not-wired';

/**
 * Mon objectif — écran non branché.
 *
 * `setRaceGoal` et `changePlanTarget` existent, ainsi que le moteur de plan. Le repère et son indice de fiabilité ne sont pas calculés.
 */
export default function Page() {
  return (
    <div className="ap-page">
      <SectionHeader eyebrow="Ma course" title="Mon objectif" />

      <NotWired
        area="Mon objectif"
        purpose="Le chrono que tu vises, et le repère que PLUKA en tire : fourchette, fiabilité, marges aux barrières."
        detail="L'objectif s'enregistre déjà côté serveur, mais le repère PLUKA n'est pas encore calculé."
      />
    </div>
  );
}
