import { allowedRaceTransitions, getRaceAdministration } from '@pluka/domain';
import { Badge, DataValue, Divider, MicroLabel } from '@pluka/ui';
import Link from 'next/link';

import { RaceStatusPanel, UpdateRaceForm } from '@/app/courses/[raceId]/forms';
import { redirectOnDomainError, requireAdminContext } from '@/lib/admin';

/**
 * Écran d'édition d'une épreuve, et transitions de statut de §4.1.
 *
 * Les transitions proposées viennent de `allowedRaceTransitions`, la table
 * pure du domaine : l'écran n'en connaît aucune de son côté et ne peut donc
 * pas en inventer une. L'autorité requise est affichée telle que la table la
 * déclare, et c'est `changeRaceStatus` qui refusera si l'acteur ne l'a pas.
 */
export default async function RacePage({
  params,
}: {
  readonly params: Promise<{ readonly raceId: string }>;
}) {
  const { raceId } = await params;
  const context = await requireAdminContext(`/courses/${raceId}`);

  const { race, edition, event, history } = await getRaceAdministration(context, { raceId }).catch(
    redirectOnDomainError,
  );
  const transitions = allowedRaceTransitions(race.status);

  return (
    <main
      style={{
        maxWidth: 'var(--content-main)',
        margin: '0 auto',
        padding: 'var(--space-8) var(--space-6)',
      }}
    >
      <Link href={`/evenements/${event.id}`} className="pk-link">
        {event.name}
      </Link>

      <MicroLabel>Épreuve</MicroLabel>
      <h1 className="pk-h1" style={{ margin: 'var(--space-2) 0 var(--space-6)' }}>
        {race.name}
      </h1>

      <div style={{ display: 'flex', gap: 'var(--space-10)', flexWrap: 'wrap' }}>
        <DataValue label="Édition" value={edition.year} />
        <DataValue label="Distance" value={race.distanceKm} unit="km" />
        <DataValue label="Statut" value={race.status} />
        <DataValue label="Visibilité" value={race.publicVisibility} />
      </div>

      <Divider spaced />

      <h2 className="pk-h2" style={{ marginBottom: 'var(--space-2)' }}>
        Revue des candidats
      </h2>
      <p className="pk-body" style={{ color: 'var(--pk-text-muted)' }}>
        Les informations extraites des sources attendent une décision humaine avant publication
        (SOURCES_EXTRACTION §30).
      </p>
      <Link href={`/courses/${race.id}/revue`} className="pk-link">
        Ouvrir la revue
      </Link>

      <Divider spaced />

      <h2 className="pk-h2" style={{ marginBottom: 'var(--space-4)' }}>
        Statut
      </h2>

      <RaceStatusPanel raceId={race.id} status={race.status} transitions={transitions} />

      <Divider spaced />

      <h2 className="pk-h2" style={{ marginBottom: 'var(--space-4)' }}>
        Historique
      </h2>

      {history.length === 0 ? (
        <p className="pk-body" style={{ color: 'var(--pk-text-muted)' }}>
          Aucun changement de statut journalisé.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {history.map((entry) => (
            <li
              key={entry.id}
              style={{
                display: 'flex',
                gap: 'var(--space-4)',
                alignItems: 'center',
                padding: 'var(--space-3) 0',
                borderTop: '1px solid var(--pk-hairline)',
              }}
            >
              <Badge tone="neutral">{entry.fromStatus}</Badge>
              <span aria-hidden="true">→</span>
              <Badge tone="glacier">{entry.toStatus}</Badge>
              <span className="pk-label" style={{ marginLeft: 'auto' }}>
                {entry.createdAt}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Divider spaced />

      <h2 className="pk-h2" style={{ marginBottom: 'var(--space-4)' }}>
        Informations
      </h2>

      <UpdateRaceForm race={race} />
    </main>
  );
}
