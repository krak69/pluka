import { SectionHeader } from '@pluka/ui';

import { NotWired } from '@/components/not-wired';

/**
 * Conditions — écran non branché.
 *
 * Tables présentes, aucun appel fournisseur. 04_ENTITLEMENTS §39 pour les alertes officielles, §35 pour la prévision personnelle.
 */
export default function Page() {
  return (
    <div className="ap-page">
      <SectionHeader eyebrow="Ma course" title="Conditions" />

      <NotWired
        area="Conditions"
        purpose="Les conditions que tu devrais rencontrer là où tu seras, au moment où tu devrais y passer. Rien avant J-14."
        detail="Aucun fournisseur météo n'est branché. Les alertes de l'organisation resteront gratuites pour tous ; la prévision personnelle demandera un Race Pass."
      />
    </div>
  );
}
