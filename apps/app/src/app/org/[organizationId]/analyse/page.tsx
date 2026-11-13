import { TerrainBand } from '@pluka/ui';

import { NotWired } from '@/components/not-wired';

/**
 * Analyse — 05_ROUTES_FLOWS §6.1, 00_PRODUCT_SPEC §25 ; RACE_INTELLIGENCE.
 *
 * L'entrée fait partie de la navigation organisateur canonique (Accueil, Ma
 * course, Analyse, Participants). Le moteur Race Intelligence n'est pas
 * branché : l'écran annonce ce qu'il montrera, sans valeur inventée.
 */
export const metadata = { title: 'Analyse' };

export default function AnalysisPage() {
  return (
    <>
      <TerrainBand
        tone="dark"
        topo
        eyebrow="Analyse"
        title="Votre peloton, avant qu’il passe"
        body="Une lecture agrégée de la préparation de vos participants, jamais nominative."
      />
      <NotWired
        area="Analyse"
        purpose="Quand le gros du peloton atteindra chaque ravitaillement, quelles barrières seront sous tension, et ce que vos participants cherchent sans trouver de réponse officielle."
        detail="Le moteur d’analyse n’est pas encore branché. Les tendances ne seront jamais calculées sur moins de 10 participants."
      />
    </>
  );
}
