import { SectionHeader } from '@pluka/ui';

import { NotWired } from '@/components/not-wired';

/**
 * Communauté — écran non branché.
 *
 * Tables présentes, aucun service de domaine. La portée de cet onglet — globale ou par course — reste le cas ouvert §12.4 de 05_ROUTES_FLOWS.
 */
export default function Page() {
  return (
    <div className="ap-page">
      <SectionHeader eyebrow="Ma saison" title="Communauté" />

      <NotWired
        area="Communauté"
        purpose="Les retours des autres participants sur ton épreuve — utiles sur le terrain, jamais présentés comme une règle officielle."
        detail="Les échanges ne sont pas encore ouverts."
      />
    </div>
  );
}
