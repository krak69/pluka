import { getAdminUser } from '@pluka/domain';
import { DataValue, Divider, EmptyState, SectionHeader, Table } from '@pluka/ui';
import Link from 'next/link';

import { entitlementLabel, platformRoleLabel } from '@/components/admin-status';
import { day, personName } from '@/lib/format';
import { redirectOnReadError, requireAdminConsoleContext } from '@/lib/admin';

/**
 * Fiche d'un utilisateur — lecture journalisée.
 *
 * Ce que l'écran montre : identité, réglages d'affichage, droits commerciaux,
 * nombre de courses.
 *
 * Ce qu'il ne montre pas, et ne montrera pas : Plan, Nutrition, Assistance,
 * sorties, profil trailer. §104 les réserve à leur propriétaire, sans exception
 * pour `pluka_admin` — « le support passe par des use cases audités, pas par
 * une lecture directe », et aucun écran du prototype ne les demande.
 *
 * Changer un rôle est une écriture : lot 4b.
 */
export const metadata = { title: 'Utilisateur' };

export default async function UserPage({
  params,
}: {
  readonly params: Promise<{ readonly userId: string }>;
}) {
  const { userId } = await params;
  const context = await requireAdminConsoleContext(`/utilisateurs/${userId}`);

  const user = await getAdminUser(context, { userId }).catch(redirectOnReadError);

  return (
    <main className="ad-page">
      <Link href="/utilisateurs" className="pk-link">
        Utilisateurs
      </Link>

      <SectionHeader
        eyebrow="Utilisateur"
        title={personName(user.firstName, user.lastName, user.email)}
      />

      <p className="pk-body ad-notice">Cette consultation est inscrite au journal d’audit.</p>

      <div className="ad-facts">
        <DataValue label="Email" value={user.email} />
        <DataValue label="Rôle plateforme" value={platformRoleLabel(user.platformRole)} />
        <DataValue label="Droit résolu" value={entitlementLabel(user.entitlementLevel)} />
        <DataValue label="Courses préparées" value={user.racesCount} />
        <DataValue label="Langue" value={user.locale} />
        <DataValue label="Fuseau" value={user.timezone} />
        <DataValue label="Inscrit le" value={day(user.createdAt)} />
      </div>

      <Divider spaced />

      <h2 className="pk-h2 ad-section-title">Droits</h2>

      <p className="pk-body ad-measure">
        Le droit résolu ci-dessus est celui que la base tranche par priorité — 04_ENTITLEMENTS §21,
        « le droit le plus large gagne ». Le détail ci-dessous dit d’où il vient.
      </p>

      {user.entitlements.length === 0 ? (
        <EmptyState
          label="Droits"
          title="Aucun droit enregistré."
          detail="Ce compte est au niveau gratuit : rien n’a été acheté ni offert."
        >
          <p>Un achat, un pass course ou une inclusion organisateur créerait une ligne ici.</p>
        </EmptyState>
      ) : (
        <Table
          caption={`${user.entitlements.length} droit${user.entitlements.length > 1 ? 's' : ''}`}
          columns={[
            { key: 'kind', label: 'Nature' },
            { key: 'source', label: 'Origine' },
            { key: 'status', label: 'État' },
            { key: 'starts', label: 'Début' },
            { key: 'ends', label: 'Fin' },
          ]}
          rows={user.entitlements.map((entitlement, index) => ({
            key: `${entitlement.kind}-${entitlement.source}-${index}`,
            cells: {
              kind: entitlement.kind,
              source: entitlement.source,
              status: entitlement.status,
              starts: day(entitlement.startsAt),
              ends: entitlement.endsAt === null ? 'sans terme' : day(entitlement.endsAt),
            },
          }))}
        />
      )}

      <Divider spaced />

      <h2 className="pk-h2 ad-section-title">Ce qui n’est pas lisible ici</h2>

      <p className="pk-body ad-measure">
        Plan, Nutrition, Assistance, sorties et profil trailer appartiennent à leur propriétaire.
        Aucun rôle de plateforme n’y donne accès, et cet écran ne les demande pas.
      </p>
    </main>
  );
}
