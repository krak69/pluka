import { DomainError, getMyOrganization } from '@pluka/domain';
import { Logo } from '@pluka/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { Icon } from '@/components/icon';
import { OrgSideNav } from '@/components/org-side-nav';
import { requireSession } from '@/lib/session';
import { sessionTeamContext } from '@/lib/team';

/**
 * Cadre d'une organisation — `/org/[organizationId]` (05_ROUTES_FLOWS §6.1).
 *
 * Garde d'appartenance : un non-membre reçoit un 404, qui ne confirme pas que
 * l'organisation existe (03_PRIVACY_RLS §120). Un identifiant qui n'est pas un
 * UUID est traité de même.
 *
 * Habillage du prototype (`screen: 'org'`) : une colonne claire sur toute la
 * hauteur — l'organisation, la navigation canonique (Accueil, Ma course,
 * Analyse, Participants), les paramètres à part (06_DESIGN_SYSTEM §68) — et un
 * en-tête au-dessus d'un contenu en pleine largeur.
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

  const base = `/org/${organizationId}`;

  return (
    <div className="os-shell">
      <aside className="os-side">
        <div className="os-org">
          <Link href="/org" className="os-org-back">
            Mes organisations
          </Link>
          <p className="os-org-name">{organization.organizationName}</p>
          <p className="os-org-sub">Espace organisateur</p>
          <p className="os-powered">
            powered by <Logo variant="mark" tone="foret" height={16} />
          </p>
        </div>

        <OrgSideNav
          label="Organisation"
          items={[
            { href: base, label: 'Accueil', icon: 'House', exact: true },
            {
              href: `${base}/course/informations`,
              label: 'Ma course',
              icon: 'BookOpenText',
              match: `${base}/course`,
            },
            { href: `${base}/analyse`, label: 'Analyse', icon: 'ChartLineUp' },
            { href: `${base}/participants`, label: 'Participants', icon: 'UsersThree' },
          ]}
        />

        <div className="os-side-group">
          <p className="pk-label os-side-label">Paramètres</p>
          <OrgSideNav
            label="Paramètres"
            items={[
              { href: `${base}/parametres/site`, label: 'Site', icon: 'GlobeSimple' },
              { href: `${base}/parametres/equipe`, label: 'Équipe', icon: 'UserList' },
            ]}
          />
        </div>

        <div className="os-side-foot">
          <Link href="/" className="os-side-back">
            <Icon name="ArrowLeft" size={16} />
            Espace coureur
          </Link>
        </div>
      </aside>

      <div className="os-frame">
        <header className="os-header">
          <span className="os-header-title">Espace organisateur</span>
          <span className="os-header-org">{organization.organizationName}</span>
        </header>
        <main className="or-main os-main">{children}</main>
      </div>
    </div>
  );
}
