import { civilMoment, getOrganizerCourse, type OrganizerCourse } from '@pluka/domain';
import { StatusBadge, type StatusTone } from '@pluka/ui';

import { raceStartLabel } from '@/app/site/format';
import { DuplicateEditionForm, PublishEditionForm, PublishRaceForm, UpdateRaceForm } from '@/components/course-forms';
import { CourseFrame } from '@/components/course-frame';
import { sessionEventSiteContext } from '@/lib/event-site-editing';
import { requireSession } from '@/lib/session';

/**
 * Ma course · Épreuves — 00_PRODUCT_SPEC §28.
 *
 * Les épreuves d'une édition, et l'édition suivante. Une édition dupliquée
 * naît en brouillon : elle se relit, ses dates se règlent, puis elle se publie.
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

const NOTICES: Readonly<Record<string, string>> = {
  'epreuve-modifiee': 'Épreuve modifiée.',
  'epreuve-publiee': 'Épreuve publiée.',
  'edition-publiee': 'Édition publiée : publiez maintenant ses épreuves.',
  'edition-creee': 'Édition créée en brouillon. Vérifiez ses dates, puis publiez-la.',
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
  const scope = { organizationId, selection };
  const next = nextEdition(editions);

  return (
    <CourseFrame
      organizationId={organizationId}
      screen="epreuves"
      course={course}
      body="Vos épreuves, leurs horaires, et l’édition suivante."
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
          {permissions.canEdit ? <PublishEditionForm scope={scope} editionId={edition.id} /> : null}
        </section>
      ) : null}

      {races.length === 0 ? (
        <section className="or-card">
          <p className="pk-body">Aucune épreuve dans cette édition pour l’instant.</p>
        </section>
      ) : (
        <ul className="cr-races">
          {races.map((race) => {
            const state = STATES[race.status];
            const start = civilMoment(race.startDatetime, race.timezone);
            return (
              <li key={race.id} className="or-card">
                <div className="cr-fact-head">
                  <h2 className="pk-h2">{race.name}</h2>
                  {state === undefined ? null : (
                    <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                  )}
                </div>
                <p className="or-row-meta">
                  {[
                    kilometers(race.distanceKm),
                    ...(race.elevationGainM === null ? [] : [`${String(race.elevationGainM)} m D+`]),
                    raceStartLabel(race.startDatetime, race.timezone),
                    ...(race.startLocationName === null ? [] : [race.startLocationName]),
                  ].join(' · ')}
                </p>
                {!permissions.canEdit ? null : (
                  <div className="cr-fact-actions">
                    {race.status === 'draft' && edition?.status === 'published' ? (
                      <PublishRaceForm scope={scope} raceId={race.id} label={race.name} />
                    ) : null}
                    <details className="st-details">
                      <summary>Modifier</summary>
                      <UpdateRaceForm
                        scope={scope}
                        race={{
                          id: race.id,
                          name: race.name,
                          day: start.day,
                          time: start.time,
                          timezone: race.timezone,
                          distanceKm: race.distanceKm,
                          elevationGainM: race.elevationGainM,
                          startLocationName: race.startLocationName,
                        }}
                      />
                    </details>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!permissions.canEdit || next === null || event === null ? null : (
        <section aria-labelledby="next-edition" className="or-card">
          <h2 id="next-edition" className="pk-h2">
            Préparer l’édition {next.year}
          </h2>
          <p className="pk-body">
            PLUKA reprend les épreuves de {next.sourceYear} avec leurs distances, en brouillon. Les
            informations publiées, les traces et les liens d’inscription ne suivent pas : ils sont à
            redonner pour la nouvelle édition.
          </p>
          <DuplicateEditionForm
            scope={scope}
            eventSlug={event.slug}
            eventId={event.id}
            next={next}
          />
        </section>
      )}
    </CourseFrame>
  );
}
