import {
  editionEquipmentRows,
  equipmentOf,
  equipmentProposals,
  getEditionAdministration,
  getEventAdministration,
  listCandidatesForReview,
  listRaceFactsForEditing,
} from '@pluka/domain';
import Link from 'next/link';

import { AdminEmpty } from '@/components/admin-page';
import { ConsoleNotice } from '@/components/console-action';
import {
  factEditingContext,
  factReviewContext,
  redirectOnDomainError,
  requireAdminContext,
} from '@/lib/admin';
import { consoleNotice, type ConsoleNoticeParams } from '@/lib/console-notice';
import { requireSession } from '@/lib/session';

import { EditionEquipmentPanel } from '../edition-equipment';
import { EventTabs } from '../event-tabs';
import { raceMeasures } from '../event-overview';

/**
 * L'onglet Matériel d'un événement — migrations 0045 à 0048.
 *
 * Le tableau du matériel d'une édition, seul sur sa page : c'est un outil de
 * travail, avec son brouillon et sa barre d'enregistrement. L'édition est la
 * plus récente, ou celle de `?edition=` ; l'édition qui la précède sert à
 * « Reprendre le matériel ».
 */
export const metadata = { title: 'Matériel' };

function detailOf(race: Parameters<typeof raceMeasures>[0]): string | null {
  return raceMeasures(race).split(' · ')[0] ?? null;
}

export default async function EventEquipmentPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly eventId: string }>;
  readonly searchParams: Promise<ConsoleNoticeParams & { readonly edition?: string }>;
}) {
  const { eventId } = await params;
  const query = await searchParams;
  const notice = consoleNotice(query);
  const returnTo = `/evenements/${eventId}/materiel`;

  const context = await requireAdminContext(returnTo);
  const { event, editions } = await getEventAdministration(context, { eventId }).catch(
    redirectOnDomainError,
  );

  const byYear = [...editions].sort((left, right) => right.year - left.year);
  const edition = byYear.find((candidate) => candidate.id === query.edition) ?? byYear[0];
  const latest = byYear[0];

  if (edition === undefined) {
    return (
      <main className="ad-page ad-org ad-event">
        <Link href="/" className="pk-link">
          Événements
        </Link>
        <header className="ad-event-head">
          <h1 className="ad-event-name">{event.name}</h1>
        </header>
        <EventTabs eventId={eventId} current="materiel" />
        <AdminEmpty icon="Files" title="Aucune édition.">
          <p>Le matériel se règle par édition : crée-la d’abord sur la vue d’ensemble.</p>
        </AdminEmpty>
      </main>
    );
  }

  const session = await requireSession(returnTo);
  const factContext = factEditingContext(session);
  const reviewContext = factReviewContext(session);
  const previousEdition = byYear[byYear.indexOf(edition) + 1];

  const [{ races }, previousRaces] = await Promise.all([
    getEditionAdministration(context, { editionId: edition.id }).catch(redirectOnDomainError),
    previousEdition === undefined
      ? Promise.resolve(null)
      : getEditionAdministration(context, { editionId: previousEdition.id })
          .then((administration) => administration.races)
          .catch(() => null),
  ]);

  const equipmentOfRace = (raceId: string) =>
    listRaceFactsForEditing(factContext, { raceId })
      .then((facts) => facts.filter((fact) => fact.category === 'equipment').map(equipmentOf))
      .catch(() => null);

  const [current, previous] = await Promise.all([
    Promise.all(
      races.map(async (race) => {
        const [items, candidates] = await Promise.all([
          equipmentOfRace(race.id),
          listCandidatesForReview(reviewContext, { raceId: race.id, limit: 200 }).catch(
            () => null,
          ),
        ]);
        return { race, items, candidates };
      }),
    ),
    previousRaces === null
      ? Promise.resolve(null)
      : Promise.all(
          previousRaces.map(async (race) => ({
            raceId: race.id,
            raceName: race.name,
            items: await equipmentOfRace(race.id),
          })),
        ),
  ]);

  const rows = current.every(({ items }) => items === null)
    ? null
    : editionEquipmentRows(
        current.map(({ race, items }) => ({ raceId: race.id, raceName: race.name, items })),
      );
  const proposals = equipmentProposals(
    current.map(({ race, candidates }) => ({ raceId: race.id, candidates })),
  );

  return (
    <main className="ad-page ad-org ad-event">
      <Link href="/" className="pk-link">
        Événements
      </Link>

      <header className="ad-event-head">
        <h1 className="ad-event-name">{event.name}</h1>
        <p className="ad-event-sub">
          Édition {edition.year} · {races.length} épreuve{races.length > 1 ? 's' : ''}
        </p>
        {byYear.length > 1 ? (
          <ul className="ad-event-pills" aria-label="Édition affichée">
            {byYear.map((candidate) => (
              <li key={candidate.id}>
                <Link
                  href={
                    candidate.id === latest?.id
                      ? `/evenements/${eventId}/materiel`
                      : `/evenements/${eventId}/materiel?edition=${candidate.id}`
                  }
                  className="ad-event-pill"
                  aria-current={candidate.id === edition.id ? 'page' : undefined}
                >
                  {candidate.year}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <EventTabs
        eventId={eventId}
        current="materiel"
        editionId={edition.id === latest?.id ? null : edition.id}
        equipmentPending={proposals.length}
      />

      <ConsoleNotice notice={notice} />

      <EditionEquipmentPanel
        eventId={eventId}
        editionId={edition.id}
        editionYear={edition.year}
        races={races.map((race) => ({ id: race.id, name: race.name, detail: detailOf(race) }))}
        rows={races.length === 0 ? [] : rows}
        proposals={proposals}
        previous={
          previousEdition === undefined || previousRaces === null || previous === null
            ? null
            : {
                year: previousEdition.year,
                races: previousRaces.map((race) => ({
                  id: race.id,
                  name: race.name,
                  detail: detailOf(race),
                })),
                rows: editionEquipmentRows(previous),
              }
        }
      />
    </main>
  );
}
