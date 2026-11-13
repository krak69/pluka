import type { ReactNode } from 'react';

import { getPlusOffer, getRacePassOffer } from '@pluka/domain';

import { AppShell, type ShellPlan } from '@/components/app-shell';
import { activeBetaAccess } from '@/lib/beta';
import { billingContext } from '@/lib/billing';
import { organizerPathOf } from '@/lib/organizer-link';
import { listMyRaces } from '@/lib/participations';
import { requireSession } from '@/lib/session';

/**
 * Layout du shell coureur — 06_DESIGN_SYSTEM.md §69, §70.
 *
 * Server Component : il valide la session et lit les courses du coureur, puis
 * confie le chrome à `AppShell`. Le groupe de routes `(shell)` existe pour que
 * `/connexion` reste hors de ce layout : une page de connexion enveloppée d'une
 * navigation authentifiée n'a pas de sens, et un enfant ne peut pas retirer le
 * layout de son parent.
 *
 * La garde est ici plutôt que dans chaque page : toute route du groupe est
 * authentifiée, et l'oubli d'une garde sur une page serait une faille. Le
 * `returnTo` est la racine du shell ; chaque page qui a besoin du sien précis
 * le redemande.
 */
export default async function ShellLayout({
  children,
  drawer,
}: {
  readonly children: ReactNode;
  /** Tiroir ouvert par une route interceptée (`@drawer`), par-dessus l'écran. */
  readonly drawer: ReactNode;
}) {
  const session = await requireSession('/');
  const [races, organizerHref, beta] = await Promise.all([
    listMyRaces(session),
    organizerPathOf(session),
    activeBetaAccess(session),
  ]);
  const plans = await shellPlans(session, races, beta !== null);

  return (
    <AppShell races={races} organizerHref={organizerHref} plans={plans}>
      {children}
      {drawer}
    </AppShell>
  );
}

/**
 * La formule de chaque course, pour l'encart du bas de la barre latérale
 * (prototype, `tierInfo`). Elle se lit en base, comme sur l'écran d'offre ; un
 * échec de lecture n'empêche pas d'afficher le shell, l'encart se tait.
 */
async function shellPlans(
  session: Awaited<ReturnType<typeof requireSession>>,
  races: Awaited<ReturnType<typeof listMyRaces>>,
  beta: boolean,
): Promise<Readonly<Record<string, ShellPlan>>> {
  const context = billingContext(session);
  const now = new Date().toISOString();
  const plus = await getPlusOffer(context).catch(() => null);

  const entries = await Promise.all(
    races.map(async (race): Promise<[string, ShellPlan]> => {
      if (beta) return [race.participantRaceId, 'beta'];
      if (plus?.state === 'active') return [race.participantRaceId, 'plus'];
      const offer = await getRacePassOffer(
        context,
        { participantRaceId: race.participantRaceId },
        now,
      ).catch(() => null);
      if (offer === null) return [race.participantRaceId, 'unknown'];
      return [race.participantRaceId, offer.state === 'covered' ? offer.coverage : 'free'];
    }),
  );
  return Object.fromEntries(entries);
}
