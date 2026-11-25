import { getRaceConditions } from '@pluka/domain';
import { SectionHeader } from '@pluka/ui';
import Link from 'next/link';

import { ConditionsPoints } from '@/app/(shell)/courses/[participantRaceId]/plan/conditions/conditions-points';
import { ConditionsRefresh } from '@/app/(shell)/courses/[participantRaceId]/plan/conditions/conditions-refresh';
import { Icon } from '@/components/icon';
import { NotWired } from '@/components/not-wired';
import { conditionsContext, conditionsEnabled } from '@/lib/conditions';
import { conditionsRaceLine, conditionsScreen } from '@/lib/conditions-format';
import { redirectOnDomainError } from '@/lib/plan';
import { requireSession } from '@/lib/session';

/**
 * Conditions de course — prototype `isConditions` ; WEATHER_CONDITIONS §1, §7,
 * §9 à §12, §50 à §55 ; 0113.
 *
 * La prévision externe, croisée avec les heures de passage du Plan actif :
 * départ, points de passage, ravitaillements, sommets, cols et arrivée. Rien
 * avant J-14, rien sans Race Pass ; les informations de l'organisation
 * restent dans l'onglet Course, pour tous (§8). La météo ne change jamais le
 * Plan. Les vigilances et propositions attendent leurs seuils (§38).
 */
export default async function ConditionsPage({
  params,
}: {
  readonly params: Promise<{ readonly participantRaceId: string }>;
}) {
  const { participantRaceId } = await params;
  const planHref = `/courses/${participantRaceId}/plan`;

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

  const session = await requireSession(`${planHref}/conditions`);
  const view = await getRaceConditions(conditionsContext(session), { participantRaceId }).catch(
    redirectOnDomainError,
  );
  const screen = conditionsScreen(view, participantRaceId);
  const raceLine = conditionsRaceLine(view);

  return (
    <div className="ap-page cd-page">
      <Link className="cd-back" href={planHref}>
        <Icon name="ArrowLeft" size={17} />
        Retour au plan
      </Link>

      <section className="cd-hero">
        <p className="pk-label cd-hero-kicker">Conditions de course</p>
        <div className="cd-hero-top">
          <div className="cd-hero-text">
            <h1 className="cd-hero-title">Ce qui t’attend sur le parcours.</h1>
            <p className="cd-hero-lead">
              Prévisions croisées avec tes horaires de passage actuels.
            </p>
          </div>
          {screen.kind === 'forecast' ? (
            <div className="cd-hero-status">
              <span className="pk-data cd-hero-chip">{screen.horizon}</span>
              <span className="pk-data cd-on-dark-muted">Mise à jour {screen.updated}</span>
            </div>
          ) : null}
        </div>
        <div className="cd-hero-foot">
          {raceLine === null ? null : <span className="pk-data cd-on-dark-muted">{raceLine}</span>}
          {screen.kind === 'forecast' ? (
            <details className="cd-how">
              <summary>Comment ces conditions sont calculées ?</summary>
              <p>
                PLUKA demande une prévision externe pour chaque point de ton Plan — départ, points
                de passage, ravitaillements, sommets, cols et arrivée — à l’heure où tu devrais y
                passer et à l’altitude du parcours. Elle se met à jour plus souvent à l’approche du
                départ. Elle ne change jamais ton Plan.
              </p>
            </details>
          ) : null}
        </div>
      </section>

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
            <Link
              className={`pk-btn ${screen.action.primary ? 'pk-button-primary' : 'pk-button-secondary'}`}
              href={screen.action.href}
            >
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
          {screen.notices.map((notice) => (
            <p key={notice} className="cd-notice">
              {notice}
            </p>
          ))}

          {screen.summary === null ? null : (
            <section className="cd-summary" aria-labelledby="cd-summary-title">
              <h2 id="cd-summary-title" className="pk-label">
                Sur ton parcours
              </h2>
              <div className="cd-summary-grid">
                <div>
                  <p className="pk-data cd-summary-figure">{screen.summary.range}</p>
                  <p className="cd-summary-caption">température</p>
                </div>
                <div>
                  <p className="pk-data cd-summary-figure">{screen.summary.feelsMin}</p>
                  <p className="cd-summary-caption">{screen.summary.feelsMinAt}</p>
                </div>
                <div>
                  <p className="pk-data cd-summary-figure">{screen.summary.gustMax}</p>
                  <p className="cd-summary-caption">{screen.summary.gustMaxAt}</p>
                </div>
                <div>
                  <p className="cd-summary-rain">{screen.summary.rain}</p>
                  {screen.summary.rainAt === null ? null : (
                    <p className="pk-data cd-summary-caption">{screen.summary.rainAt}</p>
                  )}
                </div>
              </div>
              {screen.nights.length === 0 ? null : (
                <ul className="cd-nights" aria-label="Nuit">
                  {screen.nights.map((line) => (
                    <li key={line}>
                      <Icon name="Moon" size={16} />
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <ConditionsPoints points={screen.points} />

          <p className="cd-source">
            Prévision externe interprétée selon ton plan — susceptible d’évoluer jusqu’au départ. Ce
            n’est pas une information officielle de l’organisation.{' '}
            <a href={view.attribution.url} target="_blank" rel="noreferrer">
              {view.attribution.text}
            </a>{' '}
            ·{' '}
            <a href={view.attribution.licenceUrl} target="_blank" rel="noreferrer">
              {view.attribution.licence}
            </a>
          </p>
        </>
      )}
    </div>
  );
}
