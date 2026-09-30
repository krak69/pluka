import { SectionHeader } from '@pluka/ui';

import { NotWired } from '@/components/not-wired';

/**
 * Préparation · À faire — écran non branché.
 *
 * `setPreparationState` est exposé par le domaine ; il manque la lecture — aucun use case ne liste les tâches d'une participation.
 */
export default function Page() {
  return (
    <div className="ap-page">
      <SectionHeader eyebrow="Ma course" title="À faire" />

      <NotWired
        area="Préparation · À faire"
        purpose="Ce qu'il te reste à faire avant le départ : retrait du dossard, dépôt des sacs, pièces à emporter."
        detail="Les tâches s'enregistrent déjà côté serveur, mais rien ne sait encore les lister."
      />
    </div>
  );
}
