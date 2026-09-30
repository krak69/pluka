import { listAdminOrganizations } from '@pluka/domain';
import { EmptyState, SectionHeader, Table } from '@pluka/ui';

import { AdminStatus } from '@/components/admin-status';
import { day } from '@/lib/format';
import { redirectOnReadError, requireAdminConsoleContext } from '@/lib/admin';

/**
 * Organisations — `adminTab: 'organisations'`.
 *
 * Tous les statuts, y compris `prospect` et `archived` : la policy
 * `organizations__select__active` n'ouvre que les actives, et l'onglet
 * existerait à moitié sans les autres. C'est la raison d'être de
 * `admin_list_organizations`.
 *
 * Le prototype affiche une colonne « Contrat » — « PLUKA Event », « Pilote ».
 * Aucune colonne ne la porte en base : elle n'est pas rendue plutôt que
 * devinée depuis le statut, qui dit autre chose.
 */
export const metadata = { title: 'Organisations' };

export default async function OrganizationsPage() {
  const context = await requireAdminConsoleContext('/organisations');
  const organizations = await listAdminOrganizations(context, {}).catch(redirectOnReadError);

  return (
    <main className="ad-page">
      <SectionHeader eyebrow="Administration" title="Organisations" />

      {organizations.length === 0 ? (
        <EmptyState
          label="Organisations"
          title="Aucune organisation."
          detail="Tous les statuts sont interrogés, y compris les pilotes et les archivées."
        >
          <p>Une organisation apparaît ici dès sa création, avant même d’être active.</p>
        </EmptyState>
      ) : (
        <Table
          caption={`${organizations.length} organisation${organizations.length > 1 ? 's' : ''}, tous statuts`}
          columns={[
            { key: 'name', label: 'Organisation' },
            { key: 'status', label: 'Statut' },
            { key: 'eventsCount', label: 'Événements', align: 'numeric' },
            { key: 'racesCount', label: 'Épreuves', align: 'numeric' },
            { key: 'members', label: 'Membres', align: 'numeric' },
            { key: 'contact', label: 'Contact' },
            { key: 'created', label: 'Créée le' },
          ]}
          rows={organizations.map((organization) => ({
            key: organization.organizationId,
            cells: {
              name: (
                <>
                  <span>{organization.name}</span>
                  <span className="ad-sub ad-mono">{organization.slug}</span>
                </>
              ),
              status: <AdminStatus domain="organization" status={organization.status} />,
              eventsCount: organization.eventsCount,
              racesCount: organization.racesCount,
              members: organization.membersCount,
              /* Adresse d'organisation, pas de personne : §28 minimise
                 l'email participant, pas le contact d'un partenaire. */
              contact: organization.contactEmail ?? <span className="ad-muted">non renseigné</span>,
              created: day(organization.createdAt),
            },
          }))}
        />
      )}
    </main>
  );
}
