import {
  MIN_CALIBRATION_SAMPLES,
  REPERE_V0,
  getMyStaffRole,
  getRepereCalibrationReport,
} from '@pluka/domain';
import { DataValue } from '@pluka/ui';

import { AdminEmpty } from '@/components/admin-page';
import { redirectOnReadError, repereCalibrationContext, staffTeamContext } from '@/lib/admin';
import { requireSession } from '@/lib/session';

import { SettingsHeader } from '../tabs';

/**
 * Calibrage du Repère PLUKA — docs/engines/REPERE_PLUKA.md §5 · migration 0074.
 *
 * Des agrégats seulement : la base rend des échantillons sans identité, et
 * l'écran n'en montre aucun un par un. Le rapport ne change aucune constante :
 * une nouvelle version du Repère reste un changement de code, validé.
 */
export const metadata = { title: 'Repère PLUKA' };

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)} %`;
}

function signedPercent(value: number | null): string {
  if (value === null) return '—';
  const rounded = Math.round(value * 1000) / 10;
  return `${rounded > 0 ? '+' : ''}${String(rounded).replace('.', ',')} %`;
}

function decimal(value: number | null): string {
  return value === null ? '—' : value.toFixed(3).replace('.', ',');
}

export default async function RepereCalibrationPage() {
  const session = await requireSession('/parametres/repere');
  const [report, staffRole] = await Promise.all([
    getRepereCalibrationReport(repereCalibrationContext(session)).catch(redirectOnReadError),
    getMyStaffRole(staffTeamContext(session)),
  ]);
  const enough = report.samples >= MIN_CALIBRATION_SAMPLES;

  return (
    <main className="ad-page">
      <SettingsHeader current="/parametres/repere" staffRole={staffRole} />
      <p className="pk-body ad-measure">
        Comment la version {report.configVersion} du Repère s’en sort sur des courses réellement
        courues, et ce qu’il faudrait changer. Les couples sont anonymes : ni compte, ni course, ni
        date.
      </p>

      {report.samples === 0 ? (
        <AdminEmpty icon="Timer" title="Aucun couple pour l’instant.">
          <p>
            Les testeurs ajoutent leurs couples depuis leur profil (Aider à calibrer le Repère), et
            chaque Repère suivi d’un temps déclaré après course en devient un.
          </p>
        </AdminEmpty>
      ) : (
        <>
          <div className="ad-facts">
            <DataValue label="Couples" value={report.samples} />
            <DataValue label="Donnés par les testeurs" value={report.declared} />
            <DataValue label="Repères suivis d’une course" value={report.estimates} />
            <DataValue label="Sans plage (refusés)" value={report.refused} />
          </div>

          {enough ? null : (
            <p className="pk-body ad-notice">
              {report.samples} couple{report.samples > 1 ? 's' : ''} sur les{' '}
              {MIN_CALIBRATION_SAMPLES} à partir desquels les chiffres commencent à dire quelque
              chose. Ils sont affichés, mais n’en tire pas de conclusion.
            </p>
          )}

          <h2 className="pk-h2 ad-section-title">Version en cours</h2>
          <div className="ad-facts">
            <DataValue
              label="Temps réels dans la plage"
              value={`${percent(report.coverage)} (visé : ${percent(report.targetCoverage)})`}
            />
            <DataValue label="Écart médian au central" value={signedPercent(report.medianBias)} />
          </div>
          <p className="pk-body ad-measure">
            Un écart positif veut dire que les coureurs ont mis plus longtemps que le milieu de la
            plage.
          </p>

          <h2 className="pk-h2 ad-section-title">Ce que les couples suggèrent</h2>
          <div className="ad-facts">
            <DataValue
              label="Exposant d’endurance"
              value={`${decimal(report.fittedK)} (en cours : ${decimal(REPERE_V0.k)})`}
            />
            <DataValue
              label={`Demi-largeur pour ${percent(report.targetCoverage)} dans la plage`}
              value={`${decimal(report.suggestedWidth)} (base en cours : ${decimal(REPERE_V0.widthBase)})`}
            />
          </div>
          <p className="pk-body ad-measure">
            Une nouvelle version reprend ces valeurs dans le code, avec sa propre version :
            l’historique des Repères affichés garde celle qui les a produits.
          </p>
        </>
      )}
    </main>
  );
}
