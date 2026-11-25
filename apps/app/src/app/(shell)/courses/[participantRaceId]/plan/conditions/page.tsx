import { getRaceConditions } from '@pluka/domain';
import { MicroLabel, SectionHeader } from '@pluka/ui';
import Link from 'next/link';

import { ConditionsRefresh } from '@/app/(shell)/courses/[participantRaceId]/plan/conditions/conditions-refresh';
import { NotWired } from '@/components/not-wired';
import { conditionsContext, conditionsEnabled } from '@/lib/conditions';
import { conditionsScreen } from '@/lib/conditions-format';
import { redirectOnDomainError } from '@/lib/plan';
import { requireSession } from '@/lib/session';

/**
 * Conditions — WEATHER_CONDITIONS §1, §7, §9 à §12, §50 à §55 ; 0113.
 *
 * La prévision externe, projetée sur les heures de passage du Plan actif :
 * départ, points de passage, ravitaillements, sommets, cols et arrivée. Rien
 * avant J-14, rien sans Race Pass ; les alertes de l'organisation restent
 * dans l'onglet Course, pour tous (§8). La météo ne change jamais le Plan.
 */
export default async function ConditionsPage({
  params,
}: {
  readonly params: Promise<{ readonly participantRaceId: string }>;
}) {
  const { participantRaceId } = await params;

  if (!conditionsEnabled()) {
    return (
      <div className="ap-page">
        <SectionHeader eyebrow="Ma course" title="Conditions" />
        <NotWired
          area="Conditions"
          purpose="Les conditions que tu devrais rencontrer là où tu seras, au moment où tu devrais y passer. Rien avant J-14."
          detail="Cette fonctionnalité n’est pas encore ouverte. Les alertes de l’organisation restent visibles pour tous, dans l’onglet Course."
        />
      </div>
    );
  }

  const session = await requireSession(`/courses/${participantRaceId}/plan/conditions`);
  const view = await getRaceConditions(conditionsContext(session), { participantRaceId }).catch(
    redirectOnDomainError,
  );
  const screen = conditionsScreen(view, participantRaceId);

  return (
    <div className="ap-page cd-page">
      <SectionHeader eyebrow="Ma course" title="Conditions" />
      <ConditionsRefresh
        participantRaceId={participantRaceId}
        due={view.refreshDue}
        version={view.forecast?.fetchedAt ?? null}
      />

      {screen.kind === 'unavailable' ? (
        <section className="cd-empty">
          <h2 className="cd-empty-title">{screen.title}</h2>
          <p className="cd-empty-body">{screen.body}</p>
          {screen.action === null ? null : (
            <Link className="pk-btn pk-button-secondary" href={screen.action.href}>
              {screen.action.label}
            </Link>
          )}
        </section>
      ) : screen.kind === 'waiting' ? (
        <section className="cd-empty">
          <h2 className="cd-empty-title">
            {screen.failed
              ? 'Conditions indisponibles pour le moment'
              : 'Première prévision en préparation'}
          </h2>
          <p className="cd-empty-body">
            {screen.failed
              ? 'Le fournisseur météo n’a pas répondu. PLUKA réessaiera à ta prochaine visite ; ton Plan n’est pas concerné.'
              : 'PLUKA demande la prévision pour tes points de passage. Elle s’affiche ici dans quelques instants.'}
          </p>
        </section>
      ) : (
        <>
          <section className="cd-head">
            <MicroLabel>{screen.horizon}</MicroLabel>
            <p className="cd-freshness">{screen.freshness}</p>
            {screen.notices.map((notice) => (
              <p key={notice} className="cd-notice">
                {notice}
              </p>
            ))}
            {screen.summary.length === 0 ? null : (
              <ul className="cd-summary" aria-label="En résumé">
                {screen.summary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            {screen.nights.length === 0 ? null : (
              <ul className="cd-nights" aria-label="Nuit">
                {screen.nights.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </section>

          <ol className="cd-points" aria-label="Conditions à chaque point">
            {screen.points.map((point) => (
              <li key={point.key} className="cd-point">
                <div className="cd-point-place">
                  <span className="cd-point-name">{point.name}</span>
                  <span className="cd-meta">{point.where}</span>
                </div>
                <span className="cd-point-passage">{point.passage}</span>
                <div className="cd-point-weather">
                  <span className="cd-point-temp">{point.temperature}</span>
                  <span className="cd-meta">
                    {point.sky === '—' ? point.feelsLike : `${point.feelsLike} · ${point.sky}`}
                  </span>
                </div>
                <div className="cd-point-details">
                  {point.rain === null ? null : <span>Pluie {point.rain}</span>}
                  <span>Vent {point.wind}</span>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}

      {screen.kind === 'forecast' ? (
        <p className="cd-source">
          <a href={view.attribution.url} target="_blank" rel="noreferrer">
            {view.attribution.text}
          </a>{' '}
          ·{' '}
          <a href={view.attribution.licenceUrl} target="_blank" rel="noreferrer">
            {view.attribution.licence}
          </a>{' '}
          · Prévision externe, jamais une décision officielle.
        </p>
      ) : null}
    </div>
  );
}
