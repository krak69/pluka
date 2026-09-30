import { SectionHeader } from '@pluka/ui';

import { NotWired } from '@/components/not-wired';

/**
 * Ma saison — écran non branché.
 *
 * Les participations et les plans sont persistés. La mémoire de saison est un droit PLUKA+ (04_ENTITLEMENTS §50) qu'aucun service ne calcule.
 */
export default function Page() {
  return (
    <div className="ap-page">
      <SectionHeader eyebrow="Ma saison" title="Ma saison" />

      <NotWired
        area="Ma saison"
        purpose="Tes courses d'une saison à l'autre, avec ce que tu en as retenu."
        detail="PLUKA conserve déjà tes participations et tes plans, mais ne sait pas encore en faire une mémoire de saison."
      />
    </div>
  );
}
