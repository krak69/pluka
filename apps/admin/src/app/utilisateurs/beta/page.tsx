import { listBetaAccess } from '@pluka/domain';
import Link from 'next/link';

import { cancelBetaReservationAction, revokeBetaAccessAction } from '@/app/beta-actions';
import { AdminEmpty, AdminPageHeader, Chip } from '@/components/admin-page';
import { ConsoleAction } from '@/components/console-action';
import { betaAccessContext, redirectOnReadError } from '@/lib/admin';
import { day, personName } from '@/lib/format';
import { requireSession } from '@/lib/session';

import { GrantBetaForm } from './grant-form';

/**
 * Testeurs bêta — 04_ENTITLEMENTS §14, §61 · migration 0073.
 *
 * Un accès bêta est global et temporaire : le testeur a tout, sur toutes ses
 * courses, jusqu'à la date de fin. À expiration, les droits reviennent seuls au
 * niveau normal. La source reste `beta`, pour lire les droits après le test.
 */
export const metadata = { title: 'Testeurs bêta' };

const STATUS: Readonly<
  Record<
    string,
    { readonly label: string; readonly tone: 'success' | 'neutral' | 'warning' | 'glacier' }
  >
> = {
  active: { label: 'Ouvert', tone: 'success' },
  reserved: { label: 'Réservé', tone: 'glacier' },
  expired: { label: 'Terminé', tone: 'neutral' },
  revoked: { label: 'Retiré', tone: 'warning' },
  pending: { label: 'À venir', tone: 'neutral' },
};

/** Trois mois plus tard, en date civile : la durée d'une bêta, à ajuster. */
function inThreeMonths(): string {
  const date = new Date();
  date.setMonth(date.getMonth() + 3);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(date);
}

export default async function BetaPage() {
  const session = await requireSession('/utilisateurs/beta');
  const access = await listBetaAccess(betaAccessContext(session)).catch(redirectOnReadError);
  const open = access.filter((item) => item.status === 'active' || item.status === 'reserved');
  const closed = access.filter((item) => item.status !== 'active' && item.status !== 'reserved');

  return (
    <main className="ad-page">
      <Link href="/utilisateurs" className="pk-link">
        Utilisateurs
      </Link>

      <AdminPageHeader
        title="Testeurs bêta"
        lede="Un testeur a tout PLUKA, sur toutes ses courses, jusqu’à la date de fin. Ensuite, ses droits reviennent seuls au niveau normal. Chaque geste est inscrit au journal."
      />

      <section className="ad-org-panel" aria-labelledby="beta-grant">
        <h2 id="beta-grant" className="ad-org-panel-title">
          Ouvrir l’accès
        </h2>
        <GrantBetaForm defaultEndsOn={inThreeMonths()} />
      </section>

      <section className="ad-org-panel" aria-labelledby="beta-open">
        <h2 id="beta-open" className="ad-org-panel-title">
          En cours · {open.length}
        </h2>
        {open.length === 0 ? (
          <AdminEmpty icon="UserList" title="Aucun testeur pour l’instant.">
            <p>Colle les adresses de tes testeurs ci-dessus pour leur ouvrir tout PLUKA.</p>
          </AdminEmpty>
        ) : (
          <ul className="ad-rows">
            {open.map((item) => (
              <li key={item.grantId ?? item.email} className="ad-row">
                <div className="ad-row-main">
                  <span>{personName(item.firstName, item.lastName, item.email)}</span>
                  <span className="ad-row-meta">
                    {item.email}
                    {item.endsAt === null ? '' : ` · jusqu’au ${day(item.endsAt)}`}
                    {item.reason === null ? '' : ` · ${item.reason}`}
                  </span>
                </div>
                <Chip tone={STATUS[item.status]?.tone ?? 'neutral'}>
                  {STATUS[item.status]?.label ?? item.status}
                </Chip>
                {item.reserved ? (
                  <ConsoleAction
                    action={cancelBetaReservationAction}
                    fields={{ email: item.email }}
                    label="Annuler la réservation"
                  />
                ) : item.grantId === null ? null : (
                  <ConsoleAction
                    action={revokeBetaAccessAction}
                    fields={{ grantId: item.grantId }}
                    label="Retirer"
                    variant="destructive"
                    confirm="Les droits de ce testeur reviennent au niveau normal dès maintenant. Sa préparation reste la sienne."
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {closed.length === 0 ? null : (
        <section className="ad-org-panel ad-org-panel-quiet" aria-labelledby="beta-closed">
          <h2 id="beta-closed" className="ad-org-panel-title">
            Terminés ou retirés · {closed.length}
          </h2>
          <ul className="ad-rows">
            {closed.map((item) => (
              <li key={item.grantId ?? item.email} className="ad-row">
                <div className="ad-row-main">
                  <span>{personName(item.firstName, item.lastName, item.email)}</span>
                  <span className="ad-row-meta">
                    {item.email}
                    {item.endsAt === null ? '' : ` · fin prévue le ${day(item.endsAt)}`}
                  </span>
                </div>
                <Chip tone={STATUS[item.status]?.tone ?? 'neutral'}>
                  {STATUS[item.status]?.label ?? item.status}
                </Chip>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
