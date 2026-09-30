import { SectionHeader } from '@pluka/ui';

import { NotWired } from '@/components/not-wired';

/**
 * Préparation · Matériel — écran non branché.
 *
 * Tables présentes. Le matériel obligatoire est un droit Free (04_ENTITLEMENTS §6) ; aucun use case de lecture.
 */
export default function Page() {
  return (
    <div className="ap-page">
      <SectionHeader eyebrow="Ma course" title="Matériel" />

      <NotWired
        area="Préparation · Matériel"
        purpose="Le matériel obligatoire extrait du règlement de ton épreuve, avec sa source, et ce qu'il te reste à vérifier."
        detail="Le matériel obligatoire sera lisible gratuitement ; aucun service ne le lit encore."
      />
    </div>
  );
}
