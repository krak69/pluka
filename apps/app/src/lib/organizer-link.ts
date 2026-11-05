import { listMyOrganizations } from '@pluka/domain';

import type { Session } from '@/lib/session';
import { sessionTeamContext } from '@/lib/team';

/**
 * Le chemin de l'espace organisateur pour un compte — 05_ROUTES_FLOWS §8.
 *
 * Nul pour qui n'est membre d'aucune organisation : le lien n'a pas à exister
 * pour un coureur. Une seule organisation : on y va tout droit, la liste
 * n'apporterait qu'un clic.
 */
export function organizerPath(organizationIds: readonly string[]): string | null {
  const [only, ...others] = organizationIds;
  if (only === undefined) return null;
  return others.length === 0 ? `/org/${only}` : '/org';
}

/**
 * Le lien d'un compte. Une lecture en échec ne doit pas priver un coureur de
 * son espace (AGENTS §37) : le lien manque, le reste s'affiche.
 */
export async function organizerPathOf(session: Session): Promise<string | null> {
  try {
    const organizations = await listMyOrganizations(sessionTeamContext(session));
    return organizerPath(organizations.map((organization) => organization.organizationId));
  } catch (error) {
    console.error('espace organisateur : appartenances illisibles', {
      name: error instanceof Error ? error.name : 'inconnu',
    });
    return null;
  }
}
