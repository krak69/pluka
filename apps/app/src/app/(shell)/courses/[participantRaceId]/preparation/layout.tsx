import type { ReactNode } from 'react';

import { SubTabs } from '@/components/sub-tabs';

/**
 * Préparation — trois onglets, trois routes (`05_ROUTES_FLOWS.md` §5.2).
 *
 * Le bandeau est construit dans le layout, qui connaît la participation par ses
 * propres paramètres : un layout reçoit les segments dynamiques au-dessus de
 * lui, pas ceux de ses enfants.
 */
export default async function PreparationLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly participantRaceId: string }>;
}) {
  const { participantRaceId } = await params;
  const base = `/courses/${participantRaceId}/preparation`;

  return (
    <div className="ap-page">
      <SubTabs
        label="Sections de la préparation"
        tabs={[
          { href: `${base}/materiel`, label: 'Matériel' },
          { href: `${base}/sacs`, label: 'Sacs' },
          { href: `${base}/todo`, label: 'À faire' },
        ]}
      />
      {children}
    </div>
  );
}
