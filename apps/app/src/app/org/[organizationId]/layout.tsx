import { DomainError, getMyOrganization } from '@pluka/domain';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { SubTabs } from '@/components/sub-tabs';
import { requireSession } from '@/lib/session';
import { sessionTeamContext } from '@/lib/team';

/**
 * Cadre d'une organisation — `/org/[organizationId]` (05_ROUTES_FLOWS §6.1).
 *
 * Garde d'appartenance : un non-membre reçoit un 404, qui ne confirme pas que
 * l'organisation existe (03_PRIVACY_RLS §120). Un identifiant qui n'est pas un
 * UUID est traité de même.
 *
 * Les onglets ne nomment que ce qui a un écran : Analyse arrivera avec le sien. Un menu de liens morts serait pire
 * qu'un menu court. Site et Équipe sont des réglages (06_DESIGN_SYSTEM §68) : ils
 * restent atteignables d'un clic, à part de la navigation principale.
 */
export default async function OrganizationLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly organizationId: string }>;
}) {
  const { organizationId } = await params;
  const session = await requireSession(`/org/${organizationId}`);

  const organization = await getMyOrganization(sessionTeamContext(session), {
    organizationId,
  }).catch((error: unknown) => {
    if (
      error instanceof DomainError &&
      (error.code === 'not_found' || error.code === 'validation')
    ) {
      notFound();
    }
    throw error;
  });

  return (
    <div className="or-shell">
      <aside className="or-side">
        <div className="or-side-inner">
          <nav aria-label="Fil d’Ariane" className="or-side-org">
            <Link href="/org">Mes organisations</Link>
            <span aria-current="page">{organization.organizationName}</span>
          </nav>
          <SubTabs
            label="Organisation"
            tabs={[
              { href: `/org/${organizationId}`, label: 'Accueil' },
              {
                href: `/org/${organizationId}/course/informations`,
                label: 'Ma course',
                match: `/org/${organizationId}/course`,
              },
              { href: `/org/${organizationId}/participants`, label: 'Participants' },
            ]}
          />
          <div className="or-side-end">
            <SubTabs
              label="Réglages"
              tabs={[
                { href: `/org/${organizationId}/parametres/site`, label: 'Site' },
                { href: `/org/${organizationId}/parametres/equipe`, label: 'Équipe' },
              ]}
            />
          </div>
        </div>
      </aside>
      <main className="or-main">{children}</main>
    </div>
  );
}
