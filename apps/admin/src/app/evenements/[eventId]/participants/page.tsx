import { getEventAdministration, listEditionParticipants } from '@pluka/domain';
import { Table } from '@pluka/ui';
import Link from 'next/link';

import { AdminEmpty, AdminPageHeader } from '@/components/admin-page';
import {
  participantListContext,
  redirectOnDomainError,
  redirectOnReadError,
  requireAdminContext,
} from '@/lib/admin';
import { civilDay } from '@/lib/format';
import { requireSession } from '@/lib/session';

import { EventTabs } from '../event-tabs';

/**
 * Les participants d'une édition, pour le support (décision du 2026-11-12).
 *
 * Ce que l'organisation voit de sa liste, plus l'origine de la date
 * d'inscription : c'est elle qui décide du tarif early bird (§6.5.3). La
 * lecture est nominative, la base l'inscrit au journal d'audit (0084). Rien
 * de la préparation des coureurs n'y figure (§104).
 */
export const metadata = { title: 'Participants' };

function fullName(participant: {
  readonly firstName: string | null;
  readonly lastName: string | null;
}): string {
  const name = [participant.firstName, participant.lastName]
    .filter((part) => part !== null && part !== '')
    .join(' ');
  return name === '' ? '—' : name;
}

export default async function EventParticipantsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly eventId: string }>;
  readonly searchParams: Promise<{ readonly edition?: string }>;
}) {
  const { eventId } = await params;
  const { edition: editionParam } = await searchParams;
  const returnTo = `/evenements/${eventId}/participants`;

  const course = await requireAdminContext(returnTo);
  const { event, editions } = await getEventAdministration(course, { eventId }).catch(
    redirectOnDomainError,
  );

  const byYear = [...editions].sort((left, right) => right.year - left.year);
  const latestId = byYear[0]?.id ?? null;
  const edition = editions.find((candidate) => candidate.id === editionParam) ?? byYear[0];

  if (edition === undefined) {
    return (
      <main className="ad-page ad-org">
        <Link href={`/evenements/${eventId}`} className="pk-link">
          {event.name}
        </Link>
        <AdminPageHeader title="Participants" />
        <AdminEmpty icon="UserList" title="Aucune édition.">
          <p>Les participants se rattachent à une édition : crée-la d’abord sur la fiche.</p>
        </AdminEmpty>
      </main>
    );
  }

  const list = await listEditionParticipants(
    participantListContext(await requireSession(returnTo)),
    { editionId: edition.id },
  ).catch(redirectOnReadError);

  const verified = list.participants.filter(
    (participant) => participant.registration.origin === 'verified',
  ).length;

  return (
    <main className="ad-page ad-org">
      <Link href={`/evenements/${eventId}`} className="pk-link">
        {event.name}
      </Link>
      <AdminPageHeader
        title="Participants"
        lede={`Édition ${String(edition.year)} · ${String(list.total)} participant${
          list.total > 1 ? 's' : ''
        } · ${String(verified)} date${verified > 1 ? 's' : ''} d’inscription transmise${
          verified > 1 ? 's' : ''
        } par l’organisation.`}
      />
      <EventTabs
        eventId={eventId}
        current="participants"
        editionId={edition.id === latestId ? null : edition.id}
      />

      <p className="pk-body ad-notice">Cette consultation est inscrite au journal d’audit.</p>

      {byYear.length > 1 ? (
        <nav aria-label="Éditions" className="ad-event-edition-links">
          {byYear.map((candidate) => (
            <Link
              key={candidate.id}
              href={`${returnTo}?edition=${candidate.id}`}
              className="pk-link"
              aria-current={candidate.id === edition.id ? 'page' : undefined}
            >
              {String(candidate.year)}
            </Link>
          ))}
        </nav>
      ) : null}

      <p className="pk-body ad-measure">
        La date d’inscription fonde le tarif early bird (00_PRODUCT_SPEC §6.5.3) : « vérifiée »
        quand l’organisation l’a transmise par son fichier, « déclarée » sinon — c’est alors le
        jour d’arrivée du participant sur PLUKA.
      </p>

      {list.participants.length === 0 ? (
        <AdminEmpty icon="UserList" title="Aucun participant.">
          <p>L’organisation n’a encore importé personne, et aucun coureur n’a rejoint l’édition.</p>
        </AdminEmpty>
      ) : (
        <Table
          caption={
            list.participants.length < list.total
              ? `${String(list.participants.length)} premiers sur ${String(list.total)}`
              : `${String(list.total)} participant${list.total > 1 ? 's' : ''}`
          }
          columns={[
            { key: 'name', label: 'Participant' },
            { key: 'email', label: 'E-mail' },
            { key: 'race', label: 'Épreuve' },
            { key: 'bib', label: 'Dossard' },
            { key: 'registered', label: 'Inscrit le' },
            { key: 'state', label: 'État' },
          ]}
          rows={list.participants.map((participant) => ({
            key: participant.id,
            cells: {
              name: fullName(participant),
              email: participant.email ?? '—',
              race: participant.raceName,
              bib: participant.bib ?? '—',
              registered: `${civilDay(participant.registration.day)} · ${
                participant.registration.origin === 'verified' ? 'vérifiée' : 'déclarée'
              }`,
              state: participant.activated ? 'Sur PLUKA' : 'Importé',
            },
          }))}
        />
      )}
    </main>
  );
}
