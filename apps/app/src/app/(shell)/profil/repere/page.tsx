import { listMyCalibrationPairs } from '@pluka/domain';
import { Divider, SectionHeader } from '@pluka/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { repereCalibrationContext, repereEnabled } from '@/lib/repere';
import { requireSession } from '@/lib/session';

import { CalibrationPairForm, RemovePairForm } from './pair-forms';

/**
 * Aider à calibrer le Repère PLUKA — docs/engines/REPERE_PLUKA.md §5.
 *
 * Le coureur donne des couples tirés de ses propres courses : une sortie, puis
 * une course faite ensuite. Ils restent les siens ; PLUKA n'en lit que des
 * échantillons anonymes pour ajuster le Repère. Bêta : derrière le flag.
 */
export const metadata = { title: 'Aider à calibrer le Repère' };

function clock(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return `${String(hours)}h${String(minutes).padStart(2, '0')}`;
}

function day(date: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

export default async function RepereCalibrationPage() {
  if (!repereEnabled()) notFound();

  const session = await requireSession('/profil/repere');
  const pairs = await listMyCalibrationPairs(repereCalibrationContext(session));

  return (
    <div className="ap-page">
      <Link href="/profil" className="pk-link">
        Mon profil
      </Link>

      <SectionHeader eyebrow="Repère PLUKA · Bêta" title="Aider à calibrer le Repère" />

      <p className="pk-body rp-measure">
        Le Repère propose une plage de chrono à partir d’une sortie récente. Pour le rendre juste,
        PLUKA a besoin de vrais exemples : une sortie, puis une course que tu as courue quelques
        semaines ou mois après. Chaque couple que tu donnes aide à régler la plage.
      </p>
      <p className="rp-hint">
        Tes couples restent les tiens. PLUKA n’en lit que des chiffres anonymes : ni ton nom, ni le
        nom des courses, ni les dates.
      </p>

      <Divider spaced />

      <CalibrationPairForm />

      {pairs.length === 0 ? null : (
        <>
          <Divider spaced />
          <h2 className="pk-h2">Tes couples · {pairs.length}</h2>
          <ul className="rp-pairs">
            {pairs.map((pair) => (
              <li key={pair.id} className="rp-pair">
                <span>
                  {pair.referenceDistanceKm} km · {pair.referenceElevationGainM} m D+ en{' '}
                  {clock(pair.referenceDurationSeconds)} ({day(pair.referenceDate)})
                </span>
                <span>
                  puis {pair.courseDistanceKm} km · {pair.courseElevationGainM} m D+ en{' '}
                  {clock(pair.courseDurationSeconds)} ({day(pair.courseDate)})
                </span>
                <RemovePairForm pairId={pair.id} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
