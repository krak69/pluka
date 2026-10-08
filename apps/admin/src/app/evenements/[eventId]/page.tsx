import {
  allowedEditionTransitions,
  allowedEventTransitions,
  eventReadiness,
  getAdminOrganization,
  getEditionAdministration,
  getEventAdministration,
  getEventInventory,
  getMyStaffRole,
  getRaceGpxImport,
  getRaceWaypoints,
  isRaceVisibleToRunners,
  listAdminOrganizations,
  listEditionDocuments,
  listRaceFactsForEditing,
  type ReadinessTodo,
} from '@pluka/domain';
import { ActionList, ActivityFeed, Checklist, StatTiles, TerrainBand } from '@pluka/ui';
import Link from 'next/link';

import { changeEditionStatusAction, changeEventStatusAction } from '@/app/actions';
import {
  CreateEditionForm,
  CreateRaceForm,
  EditionStatusPanel,
  EventStatusPanel,
} from '@/app/evenements/[eventId]/forms';
import { StatusHistory } from '@/app/status-history';
import { AdminIcon } from '@/components/admin-icon';
import { Chip } from '@/components/admin-page';
import {
  AdminStatus,
  managementStatusLabel,
  raceVisibilityLabel,
  statusLabel,
} from '@/components/admin-status';
import { ConsoleAction, ConsoleNotice } from '@/components/console-action';
import {
  adminConsoleContext,
  eventDiscoveryContext,
  factEditingContext,
  gpxImportContext,
  redirectOnDomainError,
  requireAdminContext,
  staffTeamContext,
} from '@/lib/admin';
import { consoleNotice, type ConsoleNoticeParams } from '@/lib/console-notice';
import { dateTime } from '@/lib/format';
import { requireSession } from '@/lib/session';

import { EventOrganizationForm } from './event-organization-form';
import {
  activityOf,
  editionDates,
  headlineOf,
  pointsLine,
  raceMeasures,
  raceStart,
} from './event-overview';

/**
 * Fiche d'un événement — dans la grammaire de l'Accueil organisateur du
 * prototype (`orgOverview`), avec ce que seule la console porte en plus :
 *
 * 1. **l'en-tête** : nom, édition courante, épreuves en pastilles ;
 * 2. **une bande de terrain** : l'état en une phrase, le nombre de points en
 *    Aube, une seule action Lichen — les documents de course ;
 * 3. **« À faire »**, dont les deux premiers maillons se font d'ici ;
 * 4. **des tuiles** — sources, informations, épreuves, publication ;
 * 5. **« Préparation de l'événement »** et **« Activité récente »** ;
 * 6. **les éditions** et leurs épreuves ; à côté, le statut de l'événement et
 *    son organisation — gestes propres à la console.
 *
 * Ce qui est à faire, fait ou visible vient d'`eventReadiness`
 * (`@pluka/domain`), la même lecture que l'espace organisateur. Les lectures
 * d'appoint (organisation, site, documents, GPX, informations) rendent `null`
 * en cas de panne : le point devient « inconnu », la fiche reste.
 */
export const metadata = { title: 'Événement' };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Le geste d'une ligne « À faire » : direct quand il tient en un clic, une ancre sinon. */
function TodoAction({ todo, eventId }: { readonly todo: ReadinessTodo; readonly eventId: string }) {
  switch (todo.kind) {
    case 'first-edition':
      return (
        <a href="#nouvelle-edition" className="pk-btn pk-button-secondary">
          Créer l’édition
        </a>
      );
    // Les deux premiers maillons se font d'ici, en un clic : la transition
    // est celle de §4.1, et le use case refuse si l'ordre n'est pas respecté.
    case 'publish-event':
      return (
        <ConsoleAction
          action={changeEventStatusAction}
          fields={{ eventId, status: 'published' }}
          label="Publier l’événement"
        />
      );
    case 'publish-edition':
      return (
        <ConsoleAction
          action={changeEditionStatusAction}
          fields={{ editionId: todo.editionId ?? '', status: 'published' }}
          label="Diffuser l’édition"
        />
      );
    case 'add-race':
      return (
        <a href={`#edition-${todo.editionId}-epreuve`} className="pk-btn pk-button-secondary">
          Ajouter une épreuve
        </a>
      );
    case 'publish-races':
    case 'open-races':
      return todo.raceId === undefined ? (
        <a href={`#edition-${todo.editionId}`} className="pk-btn pk-button-secondary">
          Voir les épreuves
        </a>
      ) : (
        <Link href={`/courses/${todo.raceId}#visibilite`} className="pk-btn pk-button-secondary">
          Ouvrir l’épreuve
        </Link>
      );
    case 'review':
      return (
        <Link href="/validation" className="pk-btn pk-button-secondary">
          Vérifier
        </Link>
      );
  }
}

export default async function EventPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly eventId: string }>;
  readonly searchParams: Promise<ConsoleNoticeParams>;
}) {
  const { eventId } = await params;
  const notice = consoleNotice(await searchParams);
  const returnTo = `/evenements/${eventId}`;
  const context = await requireAdminContext(returnTo);

  const { event, editions, history } = await getEventAdministration(context, { eventId }).catch(
    redirectOnDomainError,
  );

  const editionsWithRaces = (
    await Promise.all(
      editions.map((edition) =>
        getEditionAdministration(context, { editionId: edition.id }).catch(redirectOnDomainError),
      ),
    )
  ).sort((left, right) => right.edition.year - left.edition.year);

  // La plus récente : c'est elle que l'état suit.
  const current = editionsWithRaces[0];
  const session = await requireSession(returnTo);
  const discoveryContext = eventDiscoveryContext(session);
  // Changer l'organisation est réservé au super-admin (0044) : le menu n'est
  // lu que pour lui. La base revérifie de toute façon.
  const isSuperAdmin = (await getMyStaffRole(staffTeamContext(session))) === 'super_admin';

  // Lectures d'appoint : `null` plutôt qu'un écran d'erreur.
  const [organization, inventory, documents, organizations] = await Promise.all([
    event.organizationId === null
      ? Promise.resolve(null)
      : getAdminOrganization(adminConsoleContext(session), {
          organizationId: event.organizationId,
        }).catch(() => null),
    getEventInventory(discoveryContext, { eventId }).catch(() => null),
    current === undefined
      ? Promise.resolve(null)
      : listEditionDocuments(discoveryContext, { editionId: current.edition.id }).catch(() => null),
    isSuperAdmin
      ? listAdminOrganizations(adminConsoleContext(session), { limit: 500 }).catch(() => null)
      : Promise.resolve(null),
  ]);

  // Par épreuve de l'édition courante : GPX, référentiel de parcours et
  // informations publiées — les trois sources de « Préparation ».
  const gpx = gpxImportContext(session);
  const factContext = factEditingContext(session);
  const currentRaces = await Promise.all(
    (current?.races ?? []).map(async (race) => {
      const [gpxImport, waypoints, facts] = await Promise.all([
        getRaceGpxImport(gpx, { raceId: race.id }).catch(() => null),
        getRaceWaypoints(context, { raceId: race.id }).catch(() => null),
        listRaceFactsForEditing(factContext, { raceId: race.id }).catch(() => null),
      ]);
      const live = facts?.filter((fact) => fact.archivedAt === null) ?? null;
      const courseReference =
        waypoints === null
          ? null
          : {
              cutoffs: waypoints.filter((waypoint) => waypoint.cutoffAt !== null).length,
              aidStations: waypoints.filter((waypoint) => waypoint.waypointType === 'aid_station')
                .length,
            };
      return { race, gpxStage: gpxImport?.stage ?? null, courseReference, facts: live };
    }),
  );

  const pendingReview =
    documents === null
      ? null
      : documents.pendingByCategory.reduce((sum, entry) => sum + entry.count, 0);

  const readiness = eventReadiness({
    event,
    editions: editionsWithRaces.map(({ edition, races }) => ({
      edition,
      races:
        edition.id === current?.edition.id
          ? currentRaces.map(({ race, gpxStage, courseReference, facts }) => ({
              race,
              gpxStage,
              courseReference,
              publishedCategories:
                facts === null ? null : new Set(facts.map((fact) => fact.category)),
            }))
          : races.map((race) => ({ race, gpxStage: null, publishedCategories: null })),
    })),
    pendingReview,
  });

  const factsRead = currentRaces.every(({ facts }) => facts !== null);
  const publishedFacts = currentRaces.reduce((sum, { facts }) => sum + (facts?.length ?? 0), 0);
  const failedDocuments =
    documents?.documents.filter((document) => document.state === 'failed').length ?? 0;
  const workingDocuments =
    documents?.documents.filter(
      (document) => document.state === 'queued' || document.state === 'reading',
    ).length ?? 0;

  const activity = activityOf({
    eventHistory: history,
    editions: editionsWithRaces.map(({ edition, history: editionHistory }) => ({
      year: edition.year,
      history: editionHistory,
    })),
    facts: currentRaces.flatMap(({ race, facts }) =>
      (facts ?? []).map((fact) => ({
        raceName: race.name,
        category: fact.category,
        publishedAt: fact.publishedAt,
      })),
    ),
  });

  const siteUrl = inventory?.finalUrl ?? inventory?.siteUrl ?? null;
  const documentsHref = `/evenements/${event.id}/documents`;

  return (
    <main className="ad-page ad-org ad-event">
      <Link href="/" className="pk-link">
        Événements
      </Link>

      <header className="ad-event-head">
        <h1 className="ad-event-name">{event.name}</h1>
        <p className="ad-event-sub">
          {current === undefined
            ? 'Aucune édition'
            : `Édition ${current.edition.year} · ${editionDates(current.edition)}`}
          {' · '}
          {organization === null
            ? managementStatusLabel(event.managementStatus)
            : `${organization.name} · ${managementStatusLabel(event.managementStatus)}`}
        </p>
        {current === undefined || current.races.length === 0 ? null : (
          <ul className="ad-event-pills" aria-label="Épreuves de l’édition">
            {current.races.map((race) => (
              <li key={race.id}>
                <Link href={`/courses/${race.id}`} className="ad-event-pill">
                  {race.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </header>

      <TerrainBand
        tone="dark"
        topo
        level={2}
        className="ad-event-band"
        eyebrow={
          current === undefined
            ? `${event.name} · ${statusLabel('event', event.status)}`
            : `${event.name} ${current.edition.year} · ${statusLabel('event', event.status)}`
        }
        title={headlineOf(readiness)}
        body={
          <p className={readiness.todos.length > 0 ? 'ad-org-next ad-org-next-due' : 'ad-org-next'}>
            {pointsLine(readiness)}
          </p>
        }
        footer={
          <span className="ad-event-band-footer">
            <span className="ad-mono">{event.slug}</span>
            {siteUrl === null ? null : (
              <>
                <span aria-hidden="true">·</span>
                <a href={siteUrl} target="_blank" rel="noreferrer">
                  {hostOf(siteUrl)}
                </a>
              </>
            )}
          </span>
        }
        {...(current === undefined
          ? {}
          : {
              primaryAction: (
                <Link href={documentsHref} className="pk-btn pk-button-primary">
                  Documents de course
                </Link>
              ),
            })}
      />

      <ConsoleNotice notice={notice} />

      <ActionList
        items={readiness.todos.map((todo) => ({
          key: `${todo.kind}-${todo.editionId ?? ''}`,
          title: todo.title,
          detail: todo.detail,
          action: <TodoAction todo={todo} eventId={event.id} />,
        }))}
      />

      <StatTiles
        tiles={[
          {
            key: 'tile-sources',
            label: 'Sources',
            value:
              documents === null
                ? '—'
                : plural(documents.documents.length, 'document', 'documents'),
            meta:
              documents === null
                ? 'Non lu'
                : failedDocuments > 0
                  ? `${failedDocuments} en erreur`
                  : workingDocuments > 0
                    ? `${workingDocuments} en cours d’analyse`
                    : documents.documents.length === 0
                      ? 'Aucun document déposé'
                      : 'Tous analysés',
            due: failedDocuments > 0,
          },
          {
            key: 'tile-facts',
            label: 'Informations',
            value: factsRead ? plural(publishedFacts, 'publiée', 'publiées') : '—',
            meta:
              pendingReview === null
                ? 'Non lu'
                : pendingReview === 0
                  ? 'Rien à vérifier'
                  : `${pendingReview} à vérifier`,
            due: pendingReview !== null && pendingReview > 0,
          },
          {
            key: 'tile-races',
            label: 'Épreuves',
            value:
              readiness.totalRaces === 0
                ? 'Aucune'
                : plural(readiness.totalRaces, 'épreuve', 'épreuves'),
            meta: `${readiness.visibleRaces} visible${readiness.visibleRaces > 1 ? 's' : ''} des coureurs`,
            due: readiness.totalRaces > 0 && readiness.visibleRaces < readiness.totalRaces,
          },
          {
            key: 'tile-publication',
            label: 'Publication',
            value: statusLabel('event', event.status),
            meta:
              current === undefined
                ? 'Aucune édition'
                : `Édition ${current.edition.year} · ${statusLabel('edition', current.edition.status)}`,
            due: event.status !== 'published' || current?.edition.status === 'draft',
          },
        ]}
      />

      <div className="ad-event-overview">
        <Checklist
          title="Préparation de l’événement"
          items={readiness.checklist.map((item) => ({
            key: item.key,
            label: item.label,
            state: item.state,
            ...(item.detail === null ? {} : { detail: item.detail }),
          }))}
        />
        <ActivityFeed
          title="Activité récente"
          empty="Aucun changement de statut ni information publiée pour l’instant."
          items={activity.map((entry) => ({
            key: entry.key,
            text: entry.text,
            meta: dateTime(entry.at),
          }))}
        />
      </div>

      <h2 className="ad-event-section">Éditions et épreuves</h2>

      <div className="ad-org-grid">
        <div className="ad-event-editions">
          {editionsWithRaces.length === 0 ? (
            <section className="ad-org-panel" aria-labelledby="no-edition-title">
              <h3 id="no-edition-title" className="ad-org-panel-title">
                Éditions
              </h3>
              <p className="ad-org-panel-lede">
                Aucune édition. Crée la première ci-dessous : ses épreuves et ses documents s’y
                rattacheront.
              </p>
            </section>
          ) : (
            editionsWithRaces.map(({ edition, races: editionRaces, history: editionHistory }) => (
              <section
                key={edition.id}
                id={`edition-${edition.id}`}
                className="ad-org-panel ad-event-edition"
                aria-labelledby={`edition-${edition.id}-title`}
              >
                <header className="ad-event-edition-head">
                  <div className="ad-event-edition-heading">
                    <h3 id={`edition-${edition.id}-title`} className="ad-event-edition-title">
                      Édition {edition.year}
                    </h3>
                    <AdminStatus domain="edition" status={edition.status} />
                  </div>
                  <span className="ad-row-meta">
                    <AdminIcon name="CalendarDots" size={14} /> {editionDates(edition)}
                  </span>
                </header>

                {editionRaces.length === 0 ? (
                  <p className="ad-org-panel-lede">Aucune épreuve pour cette édition.</p>
                ) : (
                  <ul className="ad-rows" aria-label={`Épreuves de l’édition ${edition.year}`}>
                    {editionRaces.map((race) => {
                      const shown = isRaceVisibleToRunners(event, edition, race);
                      return (
                        <li key={race.id} className="ad-row ad-event-race">
                          <div className="ad-row-main">
                            <Link href={`/courses/${race.id}`} className="ad-event-race-name">
                              {race.name}
                            </Link>
                            <span className="ad-row-meta">
                              {raceMeasures(race)} · départ {raceStart(race)}
                            </span>
                          </div>
                          <div className="ad-event-race-chips">
                            {race.publicVisibility === 'public' ? null : (
                              <Chip tone="neutral" plain>
                                {raceVisibilityLabel(race.publicVisibility)}
                              </Chip>
                            )}
                            <AdminStatus domain="race" status={race.status} />
                            <span
                              className={
                                shown
                                  ? 'ad-event-visibility'
                                  : 'ad-event-visibility ad-event-hidden'
                              }
                            >
                              <AdminIcon name={shown ? 'Eye' : 'EyeSlash'} size={14} />
                              {shown ? 'Visible' : 'Non visible'}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="ad-event-edition-links">
                  <Link href={`${documentsHref}?edition=${edition.id}`} className="pk-link">
                    <AdminIcon name="Files" size={14} /> Documents de l’édition
                  </Link>
                </div>

                <details
                  className="ad-advanced"
                  id={`edition-${edition.id}-epreuve`}
                  open={editionRaces.length === 0}
                >
                  <summary>Ajouter une épreuve</summary>
                  <CreateRaceForm
                    editionId={edition.id}
                    eventId={event.id}
                    defaultDate={edition.startDate}
                  />
                </details>

                <div className="ad-event-status" id={`edition-${edition.id}-statut`}>
                  <h4 className="ad-org-subtitle">
                    Statut de l’édition — {statusLabel('edition', edition.status)}
                  </h4>
                  {edition.status === 'draft' && event.status !== 'published' ? (
                    <p className="ad-org-panel-lede">
                      Publie d’abord l’événement : une édition ne se diffuse que sous un événement
                      publié.
                    </p>
                  ) : null}
                  <EditionStatusPanel
                    editionId={edition.id}
                    status={edition.status}
                    transitions={allowedEditionTransitions(edition.status)}
                  />
                  <details className="ad-advanced">
                    <summary>Historique de l’édition</summary>
                    <StatusHistory entries={editionHistory} domain="edition" />
                  </details>
                </div>
              </section>
            ))
          )}

          <section
            className="ad-org-panel ad-org-panel-quiet"
            id="nouvelle-edition"
            aria-labelledby="new-edition-title"
          >
            <h3 id="new-edition-title" className="ad-org-panel-title">
              Nouvelle édition
            </h3>
            <p className="ad-org-panel-lede">
              Une édition par année. Ses épreuves s’ajoutent ensuite depuis son panneau.
            </p>
            <details className="ad-advanced" open={editionsWithRaces.length === 0}>
              <summary>Créer une édition</summary>
              <CreateEditionForm
                eventId={event.id}
                defaultYear={
                  current === undefined ? new Date().getFullYear() : current.edition.year + 1
                }
              />
            </details>
          </section>
        </div>

        <div className="ad-event-editions">
          <section className="ad-org-panel" id="statut" aria-labelledby="event-status-title">
            <h3 id="event-status-title" className="ad-org-panel-title">
              Statut de l’événement
            </h3>
            <p className="ad-org-panel-lede">
              Une épreuve n’est visible des coureurs que publiée, sous une édition diffusée, sous un
              événement publié.
            </p>
            <EventStatusPanel
              eventId={event.id}
              status={event.status}
              transitions={allowedEventTransitions(event.status)}
            />
            <details className="ad-advanced">
              <summary>Historique de l’événement</summary>
              <StatusHistory entries={history} domain="event" />
            </details>
          </section>

          <section
            className="ad-org-panel"
            id="organisation"
            aria-labelledby="event-organization-title"
          >
            <h3 id="event-organization-title" className="ad-org-panel-title">
              Organisation
            </h3>
            <dl className="ad-org-facts">
              <dt>Gérée par</dt>
              <dd>
                {organization === null ? (
                  event.organizationId === null ? (
                    'Aucune organisation'
                  ) : (
                    'Organisation rattachée'
                  )
                ) : (
                  <Link href={`/organisations/${organization.organizationId}`} className="pk-link">
                    {organization.name}
                  </Link>
                )}
              </dd>
              <dt>Type</dt>
              <dd>{managementStatusLabel(event.managementStatus)}</dd>
            </dl>
            {isSuperAdmin ? (
              organizations === null ? (
                <p className="ad-org-panel-lede">
                  La liste des organisations n’a pas pu être lue : réessaie dans un instant.
                </p>
              ) : (
                <details className="ad-advanced">
                  <summary>Changer l’organisation</summary>
                  <EventOrganizationForm
                    eventId={event.id}
                    currentOrganizationId={event.organizationId}
                    organizations={organizations.map((candidate) => ({
                      id: candidate.organizationId,
                      name: candidate.name,
                    }))}
                  />
                </details>
              )
            ) : (
              <p className="ad-org-panel-lede">
                Seul un super-admin PLUKA peut changer l’organisation qui gère l’événement.
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
