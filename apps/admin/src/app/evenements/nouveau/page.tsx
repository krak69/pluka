import { listAdminOrganizations } from '@pluka/domain';

import { redirectOnReadError, requireAdminConsoleContext } from '@/lib/admin';

import { EventWizard } from './event-wizard';

/**
 * Créer un événement — `adminNewEvent` du prototype, un écran par étape
 * (décisions produit du 2026-10-07) : événement, édition, épreuves,
 * vérification, puis documents. L'étape vient de l'adresse (`?etape=2`).
 *
 * Plein écran (`isFocusMode`) : la barre latérale reste, le bandeau du haut
 * s'efface, l'écran prend toute la hauteur et porte sa sortie.
 *
 * La lecture des organisations sert de garde : elle lève `42501` pour un
 * compte hors de l'administration, et l'écran renvoie vers `/refuse` avant
 * d'afficher le formulaire. La création revérifie le droit à l'envoi.
 *
 * Le segment fixe `nouveau` passe avant `[eventId]` : Next résout toujours un
 * segment statique avant un segment dynamique.
 */
export const metadata = { title: 'Créer un événement' };

export default async function NewEventPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly etape?: string }>;
}) {
  const { etape } = await searchParams;
  const step = Number.parseInt(etape ?? '1', 10);
  const context = await requireAdminConsoleContext('/evenements/nouveau');
  const organizations = await listAdminOrganizations(context, { limit: 500 }).catch(
    redirectOnReadError,
  );

  return (
    <main className="ad-wizard-page">
      <EventWizard
        step={Number.isNaN(step) ? 1 : step}
        organizations={organizations.map((organization) => ({
          id: organization.organizationId,
          name: organization.name,
        }))}
      />
    </main>
  );
}
