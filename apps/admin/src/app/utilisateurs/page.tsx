import { searchAdminUsers } from '@pluka/domain';
import Link from 'next/link';

import { AdminEmpty, AdminPageHeader, Chip } from '@/components/admin-page';
import { entitlementLabel } from '@/components/admin-status';
import { day, personName } from '@/lib/format';
import { redirectOnReadError, requireAdminConsoleContext } from '@/lib/admin';

/**
 * Utilisateurs — `adminUsers` du prototype.
 *
 * Un champ de recherche, puis une carte par compte : nom, « email · inscrit
 * le », le droit commercial en pastille, le nombre de courses. La carte ouvre
 * la fiche, dont la lecture est journalisée.
 *
 * Le formulaire est un GET : l'adresse porte la recherche, et la touche
 * Entrée suffit — le prototype n'a pas de bouton. Le libellé reste dans
 * l'arbre d'accessibilité, masqué à l'écran.
 *
 * Chaque recherche est inscrite au journal (migration 0028) : la phrase sous
 * le titre le dit, à côté de ce que l'écran n'affiche jamais.
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
      <AdminPageHeader
        title="Utilisateurs"
        lede="Informations nécessaires au support uniquement. Le contenu personnel d’un participant — plan, nutrition, sacs, notes — n’est pas accessible. Chaque recherche est inscrite au journal."
      />

      <form method="get" className="ad-user-search" role="search">
        <label htmlFor="user-search" className="ad-visually-hidden">
          Rechercher par nom ou email
        </label>
        <input
          id="user-search"
          name="q"
          type="search"
          className="pk-input"
          placeholder="Rechercher par nom ou email…"
          defaultValue={term}
        />
      </form>

      {users.length === 0 ? (
        <AdminEmpty icon="UserList" title={term === '' ? 'Aucun compte.' : 'Aucune correspondance.'}>
          <p>
            {term === ''
              ? 'La plateforme ne compte encore aucun utilisateur.'
              : `Rien ne correspond à « ${term} ». La recherche porte sur l’email, le prénom et le nom.`}
          </p>
        </AdminEmpty>
      ) : (
        <ul
          className="ad-cards"
          aria-label={
            term === ''
              ? `${users.length} compte${users.length > 1 ? 's' : ''} les plus récents`
              : `${users.length} correspondance${users.length > 1 ? 's' : ''}`
          }
        >
          {users.map((user) => (
            <li key={user.userId}>
              <Link href={`/utilisateurs/${user.userId}`} className="ad-card">
                <span className="ad-card-main">
                  <span className="ad-card-title">
                    {personName(user.firstName, user.lastName, user.email)}
                  </span>
                  <span className="ad-card-meta">
                    {user.email} · inscrit le {day(user.createdAt)}
                  </span>
                </span>

                <Chip tone="glacier">{entitlementLabel(user.entitlementLevel)}</Chip>
                <span className="ad-card-side">
                  {user.racesCount} course{user.racesCount > 1 ? 's' : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
