import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '@pluka/ui/styles.css';

/**
 * Site public, indexable — 01_ARCHITECTURE.md §4.1.
 *
 * Les polices ne sont pas chargées ici : `@pluka/ui` déclare les piles avec
 * repli système, et leur chargement par `next/font` viendra avec la première
 * page qui en a réellement besoin (06_DESIGN_SYSTEM §114).
 */
export const metadata: Metadata = {
  title: { default: 'PLUKA', template: '%s — PLUKA' },
  description: 'Préparer une course de trail, sans rien laisser au hasard.',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="pk-surface-page">{children}</body>
    </html>
  );
}
