import { listAdminOrganizations } from '@pluka/domain';
import Link from 'next/link';

import { CreateEventForm } from '@/app/create-event-form';
import { AdminPageHeader } from '@/components/admin-page';
import { redirectOnReadError, requireAdminConsoleContext } from '@/lib/admin';

/**
 * Création d'un événement — page à part, ouverte par « Créer un événement »
 * depuis la liste (`adminNewEvent` du prototype).
 *
 * Le segment fixe `nouveau` passe avant `[eventId]` : Next résout toujours un
 * segment statique avant un segment dynamique.
 *
 * La lecture des organisations sert de garde : elle lève `42501` pour un
 * compte qui n'est pas `pluka_admin`, et l'écran renvoie vers `/refuse` avant
 * d'afficher le formulaire. `createEvent` revérifie le droit à l'envoi.
 */
export const metadata = { title: 'Créer un événement' };

export default async function NewEventPage() {
  const context = await requireAdminConsoleContext('/evenements/nouveau');
  const organizations = await listAdminOrganizations(context, { limit: 500 }).catch(
    redirectOnReadError,
  );

  return (
    <main className="ad-page">
      <Link href="/" className="pk-link">
        Événements
      </Link>

      <AdminPageHeader title="Créer un événement" />

      <CreateEventForm
        organizations={organizations.map((organization) => ({
          id: organization.organizationId,
          name: organization.name,
        }))}
      />
    </main>
  );
}
