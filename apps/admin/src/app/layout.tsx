import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '@pluka/ui/styles.css';

/**
 * Administration interne — 01_ARCHITECTURE §4.3 : « jamais atteignable par
 * les clients ». Jamais indexée, comme `apps/app`.
 */
export const metadata: Metadata = {
  title: { default: 'Administration PLUKA', template: '%s — Administration PLUKA' },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="pk-surface-page">{children}</body>
    </html>
  );
}
