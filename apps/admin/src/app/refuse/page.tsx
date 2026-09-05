import { MicroLabel } from '@pluka/ui';

import { signOutAction } from '@/app/actions';

/**
 * Refus d'accès.
 *
 * Volontairement muette : elle ne dit ni ce que l'écran demandé contenait, ni
 * quel rôle il aurait fallu avoir (03_PRIVACY_RLS §120).
 */
export default function ForbiddenPage() {
  return (
    <main
      style={{
        maxWidth: 'var(--content-reading)',
        margin: '0 auto',
        padding: 'var(--space-12) var(--space-6)',
      }}
    >
      <MicroLabel>Accès</MicroLabel>

      <h1 className="pk-h1" style={{ margin: 'var(--space-2) 0 var(--space-6)' }}>
        Espace réservé
      </h1>

      <p className="pk-body" style={{ color: 'var(--pk-text-secondary)' }}>
        Cet espace est réservé à l&apos;administration PLUKA.
      </p>

      <form action={signOutAction} style={{ marginTop: 'var(--space-6)' }}>
        <button type="submit" className="pk-btn pk-button-secondary">
          Se déconnecter
        </button>
      </form>
    </main>
  );
}
