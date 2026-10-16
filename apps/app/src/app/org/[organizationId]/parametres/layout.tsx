import type { ReactNode } from 'react';

import { SubTabs } from '@/components/sub-tabs';

/**
 * Paramètres de l'organisation — 05_ROUTES_FLOWS §6.1.
 *
 * Seuls les onglets qui ont un écran sont listés : Événement et Partenaires
 * viendront avec leurs pages, pas avant.
 */
export default async function SettingsLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly organizationId: string }>;
}) {
  const { organizationId } = await params;
  const base = `/org/${organizationId}/parametres`;

  return (
    <>
      <SubTabs
        label="Paramètres"
        tabs={[
          { href: `${base}/site`, label: 'Site' },
          { href: `${base}/equipe`, label: 'Équipe' },
        ]}
      />
      {children}
    </>
  );
}
