import { Divider, MicroLabel } from '@pluka/ui';

import { publicEnv } from '@/lib/env';

/**
 * Accueil public — squelette.
 *
 * Server Component, comme tout ce qui est lecture (01_ARCHITECTURE §6.1).
 * Aucune fonctionnalité métier : la page établit la surface publique et le
 * lien vers l'application authentifiée, rien de plus.
 *
 * Aucune donnée privée n'entre ici, et aucun client Supabase n'y est
 * construit : `apps/www` ne lit pas la base (§4.1).
 */
export default function HomePage() {
  const env = publicEnv();

  return (
    <main
      style={{
        maxWidth: 'var(--content-reading)',
        margin: '0 auto',
        padding: 'var(--space-12) var(--space-6)',
      }}
    >
      <MicroLabel>Site public</MicroLabel>

      <h1 className="pk-h1" style={{ margin: 'var(--space-2) 0 var(--space-6)' }}>
        Le terrain est la structure.
      </h1>

      <p className="pk-body" style={{ color: 'var(--pk-text-secondary)' }}>
        PLUKA prépare une course de trail : plan de course, nutrition, matériel, assistance. Cette
        page est le squelette du site public — aucune fonctionnalité n&apos;y est branchée.
      </p>

      <Divider spaced />

      <a className="pk-btn pk-button-primary" href={env.NEXT_PUBLIC_APP_URL}>
        Ouvrir l&apos;application
      </a>
    </main>
  );
}
