import { DbError } from '@pluka/db';
import { DomainError, getAdminPlatformCounters, getMyStaffRole } from '@pluka/domain';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { signOutAction } from '@/app/actions';
import { AdminShell } from '@/components/admin-shell';
import { adminConsoleContext, staffTeamContext } from '@/lib/admin';
import { publicEnv } from '@/lib/env';
import { getSession, type Session } from '@/lib/session';

import '@pluka/ui/styles.css';
import '@/app/admin.css';

/**
 * Administration interne — 01_ARCHITECTURE §4.3 : « jamais atteignable par
 * les clients ». Jamais indexée, comme `apps/app`.
 */
export const metadata: Metadata = {
  title: { default: 'Administration PLUKA', template: '%s — Administration PLUKA' },
  robots: { index: false, follow: false },
};

/**
 * Badge de « Validation » : les extractions à examiner.
 *
 * Le layout enveloppe aussi `/connexion` et `/refuse` : il ne redirige donc
 * jamais. Sans session, ou pour un compte qui n'est pas `pluka_admin` — la
 * fonction de 0028 lève alors `42501` —, il n'y a pas de badge. Toute autre
 * erreur remonte : la masquer ferait passer une panne pour « rien à
 * examiner ».
 *
 * C'est la lecture des compteurs de 0028 : aucune donnée personnelle, et non
 * journalisée (décision du lot 4a).
 */
async function pendingValidation(session: Session | null): Promise<number | null> {
  if (session === null) return null;

  try {
    const counters = await getAdminPlatformCounters(adminConsoleContext(session));

    return counters.candidatesPending;
  } catch (error) {
    if (error instanceof DbError && error.code === 'permission_denied') return null;
    if (error instanceof DomainError && error.code === 'forbidden') return null;

    throw error;
  }
}

export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  const session = await getSession();
  // Le rôle compose le menu (0035) ; il n'autorise rien.
  const staffRole = session === null ? null : await getMyStaffRole(staffTeamContext(session));

  return (
    <html lang="fr">
      <body className="pk-surface-page">
        <AdminShell
          pendingValidation={await pendingValidation(session)}
          appUrl={publicEnv().NEXT_PUBLIC_APP_URL}
          signOut={session === null ? null : signOutAction}
          staffRole={staffRole}
        >
          {children}
        </AdminShell>
      </body>
    </html>
  );
}
