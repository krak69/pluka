import { listMyOrganizations } from '@pluka/domain';
import { TerrainBand } from '@pluka/ui';
import Link from 'next/link';

import { publicEnv } from '@/lib/env';
import { requireSession } from '@/lib/session';
import { sessionTeamContext } from '@/lib/team';
import { teamRoleLabel } from '@/lib/team-roles';

/**
 * Mes organisations — `/org` (05_ROUTES_FLOWS §6.1).
 *
 * Une ligne par organisation dont le compte est membre, avec son rôle. Lue
 * sous RLS : la liste ne peut contenir que ses propres appartenances.
 */
export const metadata = { title: 'Mes organisations' };

export default async function MyOrganizationsPage() {
  const session = await requireSession('/org');
  const organizations = await listMyOrganizations(sessionTeamContext(session));

  return (
    <main className="or-main">
      <TerrainBand
        tone="dark"
        topo
        eyebrow="Espace organisateur"
        title="Mes organisations"
        body="Choisissez l’organisation sur laquelle travailler."
      />

      {organizations.length === 0 ? (
        <div className="or-card">
          <p className="pk-body">
            Votre compte ne fait partie d’aucune organisation. Une organisation vous y donne accès en
            vous invitant par email.
          </p>
          <p className="pk-body">
            Vous organisez une course ?{' '}
            <a href={`${publicEnv().NEXT_PUBLIC_SITE_URL}/organisateurs`} className="pk-link">
              Découvrir PLUKA pour les organisateurs
            </a>
          </p>
        </div>
      ) : (
        <ul className="or-cards" aria-label={`${organizations.length} organisation(s)`}>
          {organizations.map((organization) => (
            <li key={organization.organizationId}>
              <Link
                href={`/org/${organization.organizationId}`}
                className="or-card-link"
                aria-label={`Ouvrir ${organization.organizationName}`}
              >
                <span className="or-card-name">{organization.organizationName}</span>
                <span className="or-row-meta">{teamRoleLabel(organization.role)}</span>
                <span className="or-card-go" aria-hidden="true">
                  Ouvrir →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
