import Link from 'next/link';
import type { ReactNode } from 'react';

import { requireSession } from '@/lib/session';

/**
 * Espace organisateur — 05_ROUTES_FLOWS §1.1, §6.1.
 *
 * Toute route sous `/org` est authentifiée : la garde est ici, pas dans chaque
 * page. L'appartenance à une organisation est vérifiée un cran plus bas, par
 * `/org/[organizationId]/layout.tsx`.
 *
 * Le shell coureur n'enveloppe pas cet espace : le prototype présente
 * l'organisateur dans son propre cadre (`screen: 'org'`).
 */
export const metadata = { title: { default: 'Organisateur', template: '%s · Organisateur' } };

export default async function OrganizerLayout({ children }: { readonly children: ReactNode }) {
  await requireSession('/org');

  return (
    <>
      <header className="or-band">
        <Link href="/org" className="or-band-title">
          PLUKA Organisateur
        </Link>
        <Link href="/" className="pk-link pk-link-on-dark">
          Espace coureur
        </Link>
      </header>
      {children}
    </>
  );
}
