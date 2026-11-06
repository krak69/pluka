import {
  civilMoment,
  getOrganizerCourse,
  getRaceGpxImport,
  getRaceWaypoints,
  listRaceEquipment,
  type OrganizerCourse,
  type RaceGpxImportStage,
} from '@pluka/domain';
import { NavTabs, StatusBadge, TrustBadge, type StatusTone } from '@pluka/ui';
import Link from 'next/link';

import { raceStartLabel } from '@/app/site/format';
import { AutoRefresh } from '@/components/auto-refresh';
import {
  DuplicateEditionForm,
  PublishEditionForm,
  PublishRaceForm,
  RestoreFactForm,
  RetireFactForm,
  UpdateRaceForm,
} from '@/components/course-forms';
import { CourseFrame } from '@/components/course-frame';
import {
  AddEquipmentForm,
  CancelRaceForm,
  ImportGpxForm,
  ReviseEquipmentForm,
  WaypointsForm,
} from '@/components/race-course-forms';
import { sessionEventSiteContext } from '@/lib/event-site-editing';
import {
  courseContext,
  courseHref,
  factEditingContext,
  gpxImportContext,
} from '@/lib/organizer-course';
import { requireSession } from '@/lib/session';

/**
 * Ma course · Épreuves — 00_PRODUCT_SPEC §28.
 *
 * Une épreuve à la fois, en trois volets : sa fiche, son parcours, son matériel.
 * Le volet tient dans l'adresse : chaque geste y ramène, et il se partage. Puis
 * l'édition suivante. Une édition dupliquée naît en brouillon : elle se relit,
 * ses dates se règlent, puis elle se publie.
 * Publier une épreuve demande une édition publiée : l'écran le dit dans cet
 * ordre plutôt que de laisser un bouton refusé.
 */
export const metadata = { title: 'Épreuves' };

type SearchParams = Record<string, string | string[] | undefined>;

const STATES: Readonly<Record<string, { label: string; tone: StatusTone }>> = {
  draft: { label: 'Brouillon', tone: 'neutral' },
  published: { label: 'Publiée', tone: 'success' },
  completed: { label: 'Courue', tone: 'neutral' },
  cancelled: { label: 'Annulée', tone: 'error' },
  archived: { label: 'Archivée', tone: 'neutral' },
};

const PANELS = [
  { panel: 'fiche', label: 'Fiche' },
  { panel: 'parcours', label: 'Parcours' },
  { panel: 'materiel', label: 'Matériel' },
] as const;

const NOTICES: Readonly<Record<string, string>> = {
  'epreuve-modifiee': 'Épreuve modifiée.',
  'epreuve-publiee': 'Épreuve publiée.',
  'edition-publiee': 'Édition publiée : publiez maintenant ses épreuves.',
  'edition-creee': 'Édition créée en brouillon. Vérifiez ses dates, puis publiez-la.',
  'trace-ajoutee': 'Trace déposée : PLUKA l’analyse.',
  'points-enregistres': 'Points de passage enregistrés. PLUKA recalcule le parcours.',
  'materiel-ajoute': 'Matériel ajouté.',
  'materiel-corrige': 'Matériel corrigé.',
  'epreuve-annulee': 'Épreuve annulée.',
  retiree: 'Matériel retiré : les coureurs ne le voient plus.',
  restauree: 'Matériel restauré.',
};

/** Ce que l'organisation a besoin de savoir, pas les étapes du traitement (AGENTS §88). */
const TRACE_STATES: Readonly<Record<RaceGpxImportStage, { label: string; tone: StatusTone }>> = {
  none: { label: 'Aucune trace', tone: 'neutral' },
  queued: { label: 'Analyse en cours', tone: 'warning' },
  running: { label: 'Analyse en cours', tone: 'warning' },
  failed: { label: 'Lecture impossible', tone: 'error' },
  preprocessing_pending: { label: 'Points de passage attendus', tone: 'warning' },
  blocked: { label: 'À corriger', tone: 'warning' },
  completed: { label: 'Trace prête', tone: 'success' },
};

const REQUIREMENT_LABELS: Readonly<Record<string, string>> = {
  mandatory: 'Obligatoire',
  conditional: 'Conditionnel',
  recommended: 'Recommandé',
};

function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

function kilometers(value: number): string {
  return `${value.toLocaleString('fr-FR')} km`;
}

/** La suite naturelle : l'année d'après, à la même date. Tout reste modifiable. */
function nextEdition(editions: OrganizerCourse['editions']) {
  const latest = editions[0];
  if (latest === undefined) return null;

  const year = latest.year + 1;
  return {
    sourceEditionId: latest.id,
    sourceYear: latest.year,
    year,
    startDate: `${String(year)}${latest.startDate.slice(4)}`,
    endDate: latest.endDate === null ? '' : `${String(year)}${latest.endDate.slice(4)}`,
  };
}

export default async function CourseRacesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly organizationId: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { organizationId } = await params;
  const query = await searchParams;
  const eventSlug = typeof query.evenement === 'string' ? query.evenement : undefined;
  const yearParam = typeof query.edition === 'string' ? Number(query.edition) : undefined;
  const year = Number.isInteger(yearParam) ? yearParam : undefined;
  const notice = typeof query.fait === 'string' ? NOTICES[query.fait] : undefined;
  const raceSlug = typeof query.epreuve === 'string' ? query.epreuve : undefined;

  const session = await requireSession(`/org/${organizationId}/course/epreuves`);
  const course = await getOrganizerCourse(sessionEventSiteContext(session), {
    organizationId,
    today: today(),
    ...(eventSlug === undefined ? {} : { eventSlug }),
    ...(year === undefined ? {} : { year }),
  });
  const { event, edition, editions, races, permissions } = course;

  const selection = new URLSearchParams({
    ...(event === null ? {} : { evenement: event.slug }),
    ...(edition === null ? {} : { edition: String(edition.year) }),
  }).toString();
  const race = races.find((candidate) => candidate.slug === raceSlug) ?? races[0] ?? null;
  // Trace et points de passage se lisent avec un rôle d'éditeur (0023, 0025) :
  // sans lui, le volet Parcours n'a rien à montrer.
  const panels = PANELS.filter((item) => item.panel !== 'parcours' || permissions.canEdit);
  const panel = panels.find((item) => item.panel === query.volet)?.panel ?? 'fiche';
  const raceSelection = new URLSearchParams({
    ...(event === null ? {} : { evenement: event.slug }),
    ...(edition === null ? {} : { edition: String(edition.year) }),
    ...(race === null ? {} : { epreuve: race.slug }),
    volet: panel,
  }).toString();
  const scope = { organizationId, selection: raceSelection };
  const editionScope = { organizationId, selection };
  const next = nextEdition(editions);

  const [trace, waypoints, equipment] =
    race === null
      ? [null, [], []]
      : await Promise.all([
          permissions.canEdit
            ? getRaceGpxImport(gpxImportContext(session), { raceId: race.id })
            : null,
          permissions.canEdit ? getRaceWaypoints(courseContext(session), { raceId: race.id }) : [],
          listRaceEquipment(factEditingContext(session), { raceId: race.id }),
        ]);
  const raceScope = race === null ? null : { organizationId, selection: raceSelection, raceId: race.id };
  const raceStart = race === null ? null : civilMoment(race.startDatetime, race.timezone);
  const analysing = trace?.stage === 'queued' || trace?.stage === 'running';
  const activeGear = equipment.filter((item) => !item.retired).length;
  // Le matériel en vigueur d'abord : un retrait ne doit pas s'intercaler.
  const orderedGear = [...equipment].sort((a, b) => Number(a.retired) - Number(b.retired));

  return (
    <CourseFrame
      organizationId={organizationId}
      screen="epreuves"
      course={course}
      body="Vos épreuves, leur parcours et leur matériel."
      footer={
        <span className="or-summary">
          {`${String(races.length)} ${races.length > 1 ? 'épreuves' : 'épreuve'}${
            edition === null ? '' : ` · Édition ${String(edition.year)}`
          }`}
        </span>
      }
    >
      {notice === undefined ? null : (
        <p className="pk-body st-notice" role="status">
          {notice}
        </p>
      )}

      {permissions.canEdit ? null : (
        <p className="pk-body st-readonly">
          Votre rôle permet de voir les épreuves, pas de les modifier.
        </p>
      )}

      {edition !== null && edition.status === 'draft' ? (
        <section className="or-card">
          <h2 className="pk-h2">Édition {edition.year} en brouillon</h2>
          <p className="pk-body">
            Personne ne la voit encore. Relisez ses épreuves, puis publiez-la : vous pourrez ensuite
            publier les épreuves une par une.
          </p>
          {permissions.canEdit ? (
            <PublishEditionForm scope={editionScope} editionId={edition.id} />
          ) : null}
        </section>
      ) : null}

      <AutoRefresh active={analysing} />

      {race === null || raceScope === null || raceStart === null ? (
        <p className="pk-body">Aucune épreuve dans cette édition pour l’instant.</p>
      ) : (
        <>
          <nav aria-label="Épreuves" className="st-events">
            {races.map((candidate) => (
              <Link
                key={candidate.id}
                href={courseHref(organizationId, 'epreuves', {
                  event: event?.slug,
                  year: edition?.year,
                  race: candidate.slug,
                  panel,
                })}
                className="st-event"
                aria-current={candidate.id === race.id ? 'page' : undefined}
              >
                {candidate.status === 'published'
                  ? candidate.name
                  : `${candidate.name} · ${STATES[candidate.status]?.label ?? ''}`}
              </Link>
            ))}
          </nav>

          <div className="st-panels">
            <header className="or-section-head">
              <div className="or-section-title">
                <div className="cr-fact-head">
                  <h2 className="pk-h2">{race.name}</h2>
                  {STATES[race.status] === undefined ? null : (
                    <StatusBadge tone={STATES[race.status]?.tone ?? 'neutral'}>
                      {STATES[race.status]?.label ?? ''}
                    </StatusBadge>
                  )}
                </div>
                <p className="or-row-meta">
                  {[
                    kilometers(race.distanceKm),
                    ...(race.elevationGainM === null
                      ? []
                      : [`${String(race.elevationGainM)} m D+`]),
                    raceStartLabel(race.startDatetime, race.timezone),
                    ...(race.startLocationName === null ? [] : [race.startLocationName]),
                  ].join(' · ')}
                </p>
              </div>
              {permissions.canEdit && race.status === 'draft' && edition?.status === 'published' ? (
                <PublishRaceForm scope={scope} raceId={race.id} label={race.name} />
              ) : null}
            </header>

            <NavTabs
              label={`Volets de ${race.name}`}
              className="or-subnav"
              tabs={panels.map((item) => ({
                href: courseHref(organizationId, 'epreuves', {
                  event: event?.slug,
                  year: edition?.year,
                  race: race.slug,
                  panel: item.panel,
                }),
                label:
                  item.panel === 'materiel' ? `${item.label} (${String(activeGear)})` : item.label,
                current: item.panel === panel,
              }))}
            />

            {panel !== 'fiche' || !permissions.canEdit ? null : (
              <>
                <section aria-labelledby="race-card" className="or-card">
                  <h3 id="race-card" className="pk-h2">
                    Informations de l’épreuve
                  </h3>
                  <UpdateRaceForm
                    scope={scope}
                    race={{
                      id: race.id,
                      name: race.name,
                      day: raceStart.day,
                      time: raceStart.time,
                      timezone: race.timezone,
                      distanceKm: race.distanceKm,
                      elevationGainM: race.elevationGainM,
                      startLocationName: race.startLocationName,
                    }}
                  />
                </section>
                {permissions.canPublish && race.status === 'published' ? (
                  <section aria-labelledby="race-cancel" className="or-card">
                    <h3 id="race-cancel" className="pk-label">
                      Geste définitif
                    </h3>
                    <details className="st-details or-danger">
                      <summary>Annuler l’épreuve</summary>
                      <CancelRaceForm scope={raceScope} raceName={race.name} />
                    </details>
                  </section>
                ) : permissions.canPublish && race.status === 'draft' ? (
                  <p className="pk-field-hint">
                    Une épreuve en brouillon ne s’annule pas : personne ne la voit encore.
                    L’annulation devient possible une fois l’épreuve publiée.
                  </p>
                ) : null}
              </>
            )}

            {panel !== 'parcours' || trace === null ? null : (
              <>
                <section aria-labelledby="race-trace" className="or-card">
                  <div className="cr-fact-head">
                    <h3 id="race-trace" className="pk-h2">
                      Trace GPX
                    </h3>
                    <StatusBadge tone={TRACE_STATES[trace.stage].tone}>
                      {TRACE_STATES[trace.stage].label}
                    </StatusBadge>
                  </div>
                  {trace.geometry === null ? null : (
                    <p className="pk-body">
                      {[
                        ...(trace.geometry.lengthMeters === null
                          ? []
                          : [`Mesuré : ${kilometers(trace.geometry.lengthMeters / 1000)}`]),
                        ...(trace.geometry.elevationGainMeters === null
                          ? []
                          : [`${String(trace.geometry.elevationGainMeters)} m D+`]),
                      ].join(' · ')}
                    </p>
                  )}
                  {trace.quality.length === 0 ? null : (
                    <ul className="st-blockers">
                      {trace.quality.map((finding) => (
                        <li key={finding.code}>{finding.message}</li>
                      ))}
                    </ul>
                  )}
                  <ImportGpxForm scope={raceScope} hasTrace={trace.stage !== 'none'} />
                </section>

                <section aria-labelledby="race-points" className="or-card">
                  <h3 id="race-points" className="pk-h2">
                    Points de passage et barrières
                  </h3>
                  <WaypointsForm
                    key={waypoints.map((waypoint) => waypoint.id).join('|')}
                    scope={raceScope}
                    startDay={raceStart.day}
                    waypoints={waypoints.map((waypoint) => {
                      const cutoff =
                        waypoint.cutoffAt === null
                          ? null
                          : civilMoment(waypoint.cutoffAt, race.timezone);
                      return {
                        id: waypoint.id,
                        name: waypoint.name,
                        waypointType: waypoint.waypointType,
                        distanceKm: waypoint.distanceKm,
                        cutoffDay:
                          cutoff === null
                            ? null
                            : Math.round(
                                (Date.parse(`${cutoff.day}T00:00:00Z`) -
                                  Date.parse(`${raceStart.day}T00:00:00Z`)) /
                                  86_400_000,
                              ),
                        cutoffTime: cutoff?.time ?? null,
                      };
                    })}
                  />
                </section>
              </>
            )}

            {panel !== 'materiel' ? null : (
              <section aria-labelledby="race-gear" className="or-card">
                <h3 id="race-gear" className="pk-h2">
                  Matériel
                </h3>
                {permissions.canEdit ? (
                  <details className="st-details or-add" open={equipment.length === 0}>
                    <summary className="pk-btn pk-button-secondary">Ajouter du matériel</summary>
                    <AddEquipmentForm scope={raceScope} />
                  </details>
                ) : null}
                {equipment.length === 0 ? (
                  <p className="pk-field-hint">Aucun matériel pour cette épreuve.</p>
                ) : (
                  <ul className="cr-facts">
                    {orderedGear.map((item) => (
                      <li key={item.factId} className="cr-fact or-line">
                        <div className="or-line-main">
                          <span className="cr-fact-value">{item.label}</span>
                          <span className="or-row-meta">
                            {[
                              item.retired
                                ? 'Retiré'
                                : (REQUIREMENT_LABELS[item.requirement ?? ''] ?? 'À préciser'),
                              ...(item.condition === null ? [] : [item.condition]),
                              ...(item.detail === null ? [] : [item.detail]),
                            ].join(' · ')}
                          </span>
                        </div>
                        <TrustBadge level={item.trustLevel} />
                        {!permissions.canEdit ? null : item.retired ? (
                          <RestoreFactForm
                            scope={scope}
                            factId={item.factId}
                            label={item.label}
                            screen="epreuves"
                          />
                        ) : (
                          <div className="cr-fact-actions">
                            <details className="st-details">
                              <summary>Corriger</summary>
                              <ReviseEquipmentForm scope={raceScope} item={item} />
                            </details>
                            <details className="st-details or-danger">
                              <summary>Retirer</summary>
                              <RetireFactForm
                                scope={scope}
                                factId={item.factId}
                                label={item.label}
                                screen="epreuves"
                              />
                            </details>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        </>
      )}

      {!permissions.canEdit || next === null || event === null ? null : (
        <section aria-labelledby="next-edition" className="or-card">
          <details className="st-details">
            <summary id="next-edition">Préparer l’édition {next.year}</summary>
            <p className="pk-body">
              PLUKA reprend les épreuves de {next.sourceYear} avec leurs distances, en brouillon. Les
              informations publiées, les traces et les liens d’inscription ne suivent pas : ils sont
              à redonner pour la nouvelle édition.
            </p>
            <DuplicateEditionForm
              scope={editionScope}
              eventSlug={event.slug}
              eventId={event.id}
              next={next}
            />
          </details>
        </section>
      )}
    </CourseFrame>
  );
}
