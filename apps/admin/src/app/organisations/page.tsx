import { listAdminOrganizations } from '@pluka/domain';
import Link from 'next/link';

import { AdminIcon } from '@/components/admin-icon';
import { AdminEmpty, AdminPageHeader } from '@/components/admin-page';
import { AdminStatus } from '@/components/admin-status';
import { ConsoleNotice } from '@/components/console-action';
import { consoleNotice, type ConsoleNoticeParams } from '@/lib/console-notice';
import { day } from '@/lib/format';
import { isSupportSession, redirectOnReadError, requireAdminConsoleContext } from '@/lib/admin';
import { requireSession } from '@/lib/session';

/**
 * Organisations — `adminOrgs` du prototype.
 *
 * Tous les statuts, y compris `prospect` et `archived` : la policy
 * `organizations__select__active` n'ouvre que les actives, et l'onglet
 * existerait à moitié sans les autres. C'est la raison d'être de
 * `admin_list_organizations`.
 *
 * Une carte par organisation : nom et statut, puis « N événements · N
 * utilisateurs ». Deux éléments du prototype ne sont pas rendus, plutôt que
 * devinés :
 *
 * - le **contrat** (« PLUKA Event », « Pilote ») : aucune colonne ne le porte ;
 * - la **dernière activité** : rien ne la date — la date affichée est celle de
 *   création, et elle le dit ;
 *
 * « Ouvrir » mène à la fiche, où l'organisation s'édite (migration 0031).
 *
 * « Créer une organisation » n'est pas dans le prototype : il vient de
 * 00_PRODUCT_SPEC §3.5 et suit « Créer un événement » (migration 0030).
 */
export const metadata = { title: 'Organisations' };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export default async function OrganizationsPage({
  searchParams,
}: {
  readonly searchParams: Promise<ConsoleNoticeParams>;
}) {
  const context = await requireAdminConsoleContext('/organisations');
  const organizations = await listAdminOrganizations(context, {}).catch(redirectOnReadError);
  const notice = consoleNotice(await searchParams);
  // Support lit la liste sans le geste de création (0035).
  const readOnly = await isSupportSession(await requireSession('/organisations'));

  return (
    <main className="ad-page">
      <AdminPageHeader
        title="Organisations"
        {...(readOnly
          ? {}
          : {
              aside: (
                <Link href="/organisations/nouvelle" className="pk-btn pk-button-primary">
                  <AdminIcon name="Plus" size={16} />
                  Créer une organisation
                </Link>
              ),
            })}
      />

      <ConsoleNotice notice={notice} />

      {organizations.length === 0 ? (
        <AdminEmpty icon="Buildings" title="Aucune organisation.">
          <p>La première se crée avec « Créer une organisation ».</p>
        </AdminEmpty>
      ) : (
        <ul
          className="ad-cards"
          aria-label={`${organizations.length} organisation${organizations.length > 1 ? 's' : ''}, tous statuts`}
        >
          {organizations.map((organization) => (
            <li key={organization.organizationId} className="ad-card">
              <div className="ad-card-main">
                <div className="ad-card-line">
                  <span className="ad-card-title ad-card-title-strong">{organization.name}</span>
                  <AdminStatus domain="organization" status={organization.status} />
                </div>
                <span className="ad-card-meta">
                  {plural(organization.eventsCount, 'événement', 'événements')} ·{' '}
                  {plural(organization.racesCount, 'épreuve', 'épreuves')} ·{' '}
                  {plural(organization.membersCount, 'utilisateur', 'utilisateurs')}
                </span>
              </div>

              {/* Adresse d'organisation, pas de personne : §28 minimise
                  l'email participant, pas le contact d'un partenaire. */}
              {organization.contactEmail === null ? null : (
                <span className="ad-card-side">{organization.contactEmail}</span>
              )}
              <span className="ad-card-side">Créée le {day(organization.createdAt)}</span>
              <Link
                href={`/organisations/${organization.organizationId}`}
                className="pk-btn pk-button-secondary"
                aria-label={`Ouvrir ${organization.name}`}
              >
                Ouvrir
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
