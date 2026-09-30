import { searchAdminUsers } from '@pluka/domain';
import { Button, EmptyState, Input, SectionHeader, Table } from '@pluka/ui';
import Link from 'next/link';

import { entitlementLabel, platformRoleLabel } from '@/components/admin-status';
import { day, personName } from '@/lib/format';
import { redirectOnReadError, requireAdminConsoleContext } from '@/lib/admin';

/**
 * Utilisateurs — `adminTab: 'utilisateurs'`.
 *
 * Le strict nécessaire, et rien d'autre : identité, niveau de droit, nombre de
 * courses. Aucune donnée de Plan, de Nutrition ou d'Assistance, même pour un
 * administrateur — 03_PRIVACY_RLS §104 ne les autorise nulle part, et la suite
 * pgTAP 17 le rejoue sur ces fonctions.
 *
 * `racesCount` est un compteur, jamais la liste : savoir combien de courses une
 * personne prépare est une information de support ; savoir lesquelles n'en est
 * pas une.
 *
 * La recherche est un formulaire `GET` : l'adresse porte le terme, donc la
 * recherche se partage et se recharge. Chaque exécution écrit `user.search` au
 * journal, avec le terme et le nombre de correspondances — jamais les personnes
 * trouvées.
 */
export const metadata = { title: 'Utilisateurs' };

export default async function UsersPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly q?: string }>;
}) {
  const { q } = await searchParams;
  const term = q ?? '';

  const context = await requireAdminConsoleContext('/utilisateurs');
  const users = await searchAdminUsers(context, { query: term === '' ? null : term }).catch(
    redirectOnReadError,
  );

  return (
    <main className="ad-page">
      <SectionHeader eyebrow="Administration" title="Utilisateurs" />

      <p className="pk-body ad-notice">
        Chaque recherche est inscrite au journal d’audit. Cet écran n’affiche ni Plan, ni Nutrition,
        ni Assistance : ces données ne sont lisibles par personne d’autre que leur propriétaire.
      </p>

      <form method="get" className="ad-search">
        <Input
          id="user-search"
          name="q"
          label="Rechercher"
          type="search"
          defaultValue={term}
          hint="Adresse email, prénom ou nom. Vide : les comptes les plus récents."
        />
        <Button type="submit" variant="secondary">
          Rechercher
        </Button>
      </form>

      {users.length === 0 ? (
        <EmptyState
          label="Utilisateurs"
          title={term === '' ? 'Aucun compte.' : 'Aucune correspondance.'}
          detail={
            term === ''
              ? 'La plateforme ne compte encore aucun utilisateur.'
              : `Rien ne correspond à « ${term} ».`
          }
        >
          <p>La recherche porte sur l’adresse email, le prénom et le nom.</p>
        </EmptyState>
      ) : (
        <Table
          caption={
            term === ''
              ? `${users.length} compte${users.length > 1 ? 's' : ''} les plus récents`
              : `${users.length} correspondance${users.length > 1 ? 's' : ''}`
          }
          columns={[
            { key: 'person', label: 'Personne' },
            { key: 'role', label: 'Rôle' },
            { key: 'entitlement', label: 'Droit' },
            { key: 'racesCount', label: 'Courses', align: 'numeric' },
            { key: 'created', label: 'Inscrit le' },
            { key: 'open', label: '' },
          ]}
          rows={users.map((user) => ({
            key: user.userId,
            cells: {
              person: (
                <>
                  <span>{personName(user.firstName, user.lastName, user.email)}</span>
                  <span className="ad-sub">{user.email}</span>
                </>
              ),
              role: platformRoleLabel(user.platformRole),
              entitlement: entitlementLabel(user.entitlementLevel),
              racesCount: user.racesCount,
              created: day(user.createdAt),
              open: (
                <Link href={`/utilisateurs/${user.userId}`} className="pk-link">
                  Ouvrir
                </Link>
              ),
            },
          }))}
        />
      )}
    </main>
  );
}
