import {
  allowedEditionTransitions,
  allowedEventTransitions,
  getEditionAdministration,
  getEventAdministration,
} from '@pluka/domain';
import { Badge, DataValue, Divider, MicroLabel } from '@pluka/ui';
import Link from 'next/link';

import {
  CreateEditionForm,
  CreateRaceForm,
  EditionStatusPanel,
  EventStatusPanel,
} from '@/app/evenements/[eventId]/forms';
import { StatusHistory } from '@/app/status-history';
import { redirectOnDomainError, requireAdminContext } from '@/lib/admin';

/**
 * Détail d'un événement : ses éditions et, pour chacune, ses épreuves.
 *
 * Les lectures passent par `getEventAdministration` puis
 * `getEditionAdministration` — un aller-retour par édition. C'est assumé pour
 * un écran d'administration : la jointure exigerait soit une requête depuis
 * l'application, soit un use case taillé pour une seule vue.
 *
 * L'écran porte aussi les transitions de statut de §4.1, pour l'événement et
 * pour chacune de ses éditions. Sans elles, la chaîne restait impubliable :
 * une épreuve ne se publie que sous une édition diffusée, elle-même sous un
 * événement publié.
 */
export default async function EventPage({
  params,
}: {
  readonly params: Promise<{ readonly eventId: string }>;
}) {
  const { eventId } = await params;
  const context = await requireAdminContext(`/evenements/${eventId}`);

  const { event, editions, history } = await getEventAdministration(context, { eventId }).catch(
    redirectOnDomainError,
  );

  const editionsWithRaces = await Promise.all(
    editions.map((edition) =>
      getEditionAdministration(context, { editionId: edition.id }).catch(redirectOnDomainError),
    ),
  );

  return (
    <main
      style={{
        maxWidth: 'var(--content-main)',
        margin: '0 auto',
        padding: 'var(--space-8) var(--space-6)',
      }}
    >
      <Link href="/" className="pk-link">
        Événements
      </Link>

      <MicroLabel>Événement</MicroLabel>
      <h1 className="pk-h1" style={{ margin: 'var(--space-2) 0 var(--space-6)' }}>
        {event.name}
      </h1>

      <div style={{ display: 'flex', gap: 'var(--space-10)', flexWrap: 'wrap' }}>
        <DataValue label="Slug" value={event.slug} />
        <DataValue label="Statut" value={event.status} />
        <DataValue label="Organisation" value={event.organizationId ?? 'maintenu par PLUKA'} />
      </div>

      <Divider spaced />

      <h2 className="pk-h2" style={{ marginBottom: 'var(--space-4)' }}>
        Statut
      </h2>

      <EventStatusPanel
        eventId={event.id}
        status={event.status}
        transitions={allowedEventTransitions(event.status)}
      />

      <h3 className="pk-label" style={{ margin: 'var(--space-6) 0 var(--space-2)' }}>
        Historique
      </h3>
      <StatusHistory entries={history} />

      <Divider spaced />

      <h2 className="pk-h2">Éditions</h2>

      {editionsWithRaces.length === 0 ? (
        <p className="pk-body" style={{ color: 'var(--pk-text-muted)' }}>
          Aucune édition.
        </p>
      ) : (
        editionsWithRaces.map(({ edition, races, history: editionHistory }) => (
          <section key={edition.id} style={{ marginTop: 'var(--space-6)' }}>
            <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'baseline' }}>
              <h3 className="pk-h2" style={{ fontSize: '20px' }}>
                {edition.year}
              </h3>
              <Badge tone={edition.status === 'published' ? 'glacier' : 'neutral'}>
                {edition.status}
              </Badge>
              <span className="pk-label">{edition.startDate}</span>
            </div>

            {races.length === 0 ? (
              <p className="pk-body" style={{ color: 'var(--pk-text-muted)' }}>
                Aucune épreuve.
              </p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 'var(--space-3) 0 0', padding: 0 }}>
                {races.map((race) => (
                  <li key={race.id} style={{ borderTop: '1px solid var(--pk-hairline)' }}>
                    <Link
                      href={`/courses/${race.id}`}
                      className="pk-link pk-link-standalone"
                      style={{
                        display: 'flex',
                        gap: 'var(--space-4)',
                        alignItems: 'center',
                        padding: 'var(--space-3) 0',
                      }}
                    >
                      <span style={{ flex: 1 }}>{race.name}</span>
                      <DataValue value={race.distanceKm} unit="km" />
                      <Badge tone={race.status === 'published' ? 'glacier' : 'neutral'}>
                        {race.status}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            <details style={{ marginTop: 'var(--space-4)' }}>
              <summary className="pk-label" style={{ cursor: 'pointer' }}>
                Statut de l’édition
              </summary>
              <div style={{ marginTop: 'var(--space-4)' }}>
                <EditionStatusPanel
                  editionId={edition.id}
                  status={edition.status}
                  transitions={allowedEditionTransitions(edition.status)}
                />

                <h4 className="pk-label" style={{ margin: 'var(--space-6) 0 var(--space-2)' }}>
                  Historique
                </h4>
                <StatusHistory entries={editionHistory} />
              </div>
            </details>

            <details style={{ marginTop: 'var(--space-4)' }}>
              <summary className="pk-label" style={{ cursor: 'pointer' }}>
                Nouvelle épreuve
              </summary>
              <div style={{ marginTop: 'var(--space-4)' }}>
                <CreateRaceForm editionId={edition.id} eventId={event.id} />
              </div>
            </details>
          </section>
        ))
      )}

      <Divider spaced />

      <h2 className="pk-h2" style={{ marginBottom: 'var(--space-4)' }}>
        Nouvelle édition
      </h2>

      <CreateEditionForm eventId={event.id} />
    </main>
  );
}
