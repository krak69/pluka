import { listEventsForAdministration } from '@pluka/domain';
import { Badge, Divider, MicroLabel } from '@pluka/ui';
import Link from 'next/link';

import { CreateEventForm } from '@/app/create-event-form';
import { redirectOnDomainError, requireAdminContext } from '@/lib/admin';
import { signOutAction } from '@/app/actions';

/**
 * Liste des événements — 00_PRODUCT_SPEC §3.5.
 *
 * Server Component : la lecture passe par le use case, qui relit
 * `users.platform_role` en base et refuse un non-administrateur. Aucune
 * requête n'est construite ici.
 */
export default async function EventsPage() {
  const context = await requireAdminContext('/');

  const events = await listEventsForAdministration(context, {}).catch(redirectOnDomainError);

  return (
    <main
      style={{
        maxWidth: 'var(--content-main)',
        margin: '0 auto',
        padding: 'var(--space-8) var(--space-6)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <MicroLabel>Base courses</MicroLabel>
          <h1 className="pk-h1" style={{ margin: 'var(--space-2) 0' }}>
            Événements
          </h1>
        </div>

        <form action={signOutAction}>
          <button type="submit" className="pk-btn pk-button-secondary">
            Se déconnecter
          </button>
        </form>
      </div>

      <Divider spaced />

      {events.length === 0 ? (
        <p className="pk-body" style={{ color: 'var(--pk-text-muted)' }}>
          Aucun événement pour l’instant.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {events.map((event) => (
            <li key={event.id} style={{ borderTop: '1px solid var(--pk-hairline)' }}>
              <Link
                href={`/evenements/${event.id}`}
                className="pk-link pk-link-standalone"
                style={{
                  display: 'flex',
                  gap: 'var(--space-4)',
                  alignItems: 'center',
                  padding: 'var(--space-4) 0',
                }}
              >
                <span style={{ flex: 1 }}>{event.name}</span>

                <Badge tone={event.status === 'published' ? 'glacier' : 'neutral'}>
                  {event.status}
                </Badge>

                {/* §4.1 : un événement sans organisation n'est administrable que par pluka_admin. */}
                {event.organizationId === null ? <Badge tone="neutral">PLUKA</Badge> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Divider spaced />

      <h2 className="pk-h2" style={{ marginBottom: 'var(--space-4)' }}>
        Nouvel événement
      </h2>

      <CreateEventForm />
    </main>
  );
}
