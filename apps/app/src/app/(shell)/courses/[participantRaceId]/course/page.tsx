import { SectionHeader } from '@pluka/ui';

import { NotWired } from '@/components/not-wired';

/**
 * La course — écran non branché.
 *
 * C'est l'onglet le plus proche d'être branché : les facts sont persistés et publiés par le domaine, et l'administration les revoit déjà.
 */
export default function Page() {
  return (
    <div className="ap-page">
      <SectionHeader eyebrow="Ma course" title="La course" />

      <NotWired
        area="La course"
        purpose="Les informations officielles de ton épreuve, chacune avec sa source : barrières horaires, matériel obligatoire, règles d'assistance."
        detail="Les informations sont déjà publiées côté administration, mais aucun écran coureur ne les lit encore."
      />
    </div>
  );
}
