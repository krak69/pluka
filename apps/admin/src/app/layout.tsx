import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AdminChrome } from '@/components/admin-chrome';

import '@pluka/ui/styles.css';
import '@/app/admin.css';

/**
 * Administration interne — 01_ARCHITECTURE §4.3 : « jamais atteignable par
 * les clients ». Jamais indexée, comme `apps/app`.
 *
 * L'application n'avait aucune marque : ses écrans commençaient directement par
 * leur titre. Une barre unique porte désormais le logo officiel et dit de quel
 * espace il s'agit — se tromper d'onglet entre l'admin et l'espace coureur est
 * exactement le genre d'erreur qu'une marque visible évite.
 */
export const metadata: Metadata = {
  title: { default: 'Administration PLUKA', template: '%s — Administration PLUKA' },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="pk-surface-page">
        <AdminChrome />
        {children}
      </body>
    </html>
  );
}
