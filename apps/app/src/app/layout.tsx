import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '@pluka/ui/styles.css';

/**
 * Application authentifiée : jamais indexée (01_ARCHITECTURE §6).
 *
 * L'en-tête `X-Robots-Tag` de `next.config.ts` couvre en plus les Route
 * Handlers, que cette métadonnée n'atteint pas.
 */
export const metadata: Metadata = {
  title: { default: 'PLUKA', template: '%s — PLUKA' },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="pk-surface-page">{children}</body>
    </html>
  );
}
