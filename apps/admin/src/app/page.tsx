import { listAdminOrganizations, listEventsForAdministration } from '@pluka/domain';
import Link from 'next/link';

import { AdminIcon } from '@/components/admin-icon';
import { AdminEmpty, AdminPageHeader, Chip } from '@/components/admin-page';
import { AdminStatus, managementStatusLabel } from '@/components/admin-status';
import {
  adminConsoleContext,
  courseContext,
  redirectOnDomainError,
  redirectOnReadError,
} from '@/lib/admin';
import { requireSession } from '@/lib/session';

/**
 * Événements — `adminTab: 'events'` du prototype, 00_PRODUCT_SPEC §3.5.
 *
 * Titre et « Créer un événement » sur une ligne, puis une carte par
 * événement : nom, organisation gestionnaire, type, statut. La création vit
 * sur sa propre page, `/evenements/nouveau`.
 *
 * Le **type** se lit sur `management_status` (voir `managementStatusLabel`),
 * la ligne d'organisation sur `organization_id` : les deux restent
 * indépendants à l'écran comme en base.
 *
 * La **date** du prototype n'est pas rendue : elle appartient à l'édition,
 * pas à l'événement, et la liste ne lit que les événements.
 */
export const metadata = { title: 'Événements' };

export default async function EventsPage() {
  const session = await requireSession('/');

  const [events, organizations] = await Promise.all([
    listEventsForAdministration(courseContext(session), {}).catch(redirectOnDomainError),
    listAdminOrganizations(adminConsoleContext(session), { limit: 500 }).catch(redirectOnReadError),
  ]);

  const organizationName = new Map(
    organizations.map((organization) => [organization.organizationId, organization.name]),
  );

  return (
    <main className="ad-page">
      <AdminPageHeader
        title="Événements"
        aside={
          <Link href="/evenements/nouveau" className="pk-btn pk-button-primary">
            <AdminIcon name="Plus" size={16} />
            Créer un événement
          </Link>
        }
      />

      {events.length === 0 ? (
        <AdminEmpty icon="CalendarDots" title="Aucun événement.">
          <p>Le premier événement se crée avec « Créer un événement ».</p>
          <p>Un événement porte ses éditions, et chaque édition ses épreuves.</p>
        </AdminEmpty>
      ) : (
        <ul className="ad-cards" aria-label={`${events.length} événement${events.length > 1 ? 's' : ''}`}>
          {events.map((event) => (
            <li key={event.id}>
              <Link href={`/evenements/${event.id}`} className="ad-card">
                <span className="ad-card-main">
                  <span className="ad-card-title">{event.name}</span>
                  <span className="ad-card-meta">
                    {/* §4.1 : sans organisation gestionnaire, seul pluka_admin administre l'événement.
                        Le libellé ne dit rien du type, que porte la pastille. */}
                    {event.organizationId === null
                      ? 'Sans organisation gestionnaire'
                      : (organizationName.get(event.organizationId) ?? 'Organisation introuvable')}
                  </span>
                </span>

                <Chip tone="neutral" plain>
                  {managementStatusLabel(event.managementStatus)}
                </Chip>
                <AdminStatus domain="event" status={event.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
