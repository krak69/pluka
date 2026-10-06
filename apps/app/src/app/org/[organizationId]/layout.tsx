import { DomainError, getMyOrganization } from '@pluka/domain';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { requireSession } from '@/lib/session';
import { sessionTeamContext } from '@/lib/team';

/**
 * Cadre d'une organisation — `/org/[organizationId]` (05_ROUTES_FLOWS §6.1).
 *
 * Garde d'appartenance : un non-membre reçoit un 404, qui ne confirme pas que
 * l'organisation existe (03_PRIVACY_RLS §120). Un identifiant qui n'est pas un
 * UUID est traité de même.
 *
 * Pas de navigation d'onglets : Accueil, Ma course, Analyse et Participants
 * n'ont pas encore d'écran, et un menu de liens morts serait pire qu'aucun.
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
    <main className="or-main">
      <div>
        <p className="or-row-meta">{organization.organizationName}</p>
      </div>
      {children}
    </main>
  );
}
