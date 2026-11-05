'use client';

import { NavTabs } from '@pluka/ui';
import { usePathname } from 'next/navigation';

/**
 * Bandeau d'onglets secondaires.
 *
 * `05_ROUTES_FLOWS.md` §1.2 fait de chaque onglet une route : ces onglets sont
 * des liens, et l'actif se déduit du chemin. C'est le seul motif pour lequel ce
 * composant est client.
 */
export interface SubTabsProps {
  readonly label: string;
  readonly tabs: readonly {
    readonly href: string;
    readonly label: string;
    /** Un onglet qui porte des sous-écrans reste actif sur tout ce préfixe. */
    readonly match?: string;
  }[];
}

export function SubTabs({ label, tabs }: SubTabsProps) {
  const pathname = usePathname();

  return (
    <NavTabs
      label={label}
      tabs={tabs.map((tab) => ({
        href: tab.href,
        label: tab.label,
        current: tab.match === undefined ? pathname === tab.href : pathname.startsWith(tab.match),
      }))}
    />
  );
}
