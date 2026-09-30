import { selectColumns, unwrapMaybe } from '@pluka/db';
import { DataValue, Divider, MicroLabel } from '@pluka/ui';

import { signOut } from '@/app/actions';
import { requireSession } from '@/lib/session';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Accueil authentifié — squelette.
 *
 * Server Component (01_ARCHITECTURE §6.1). Aucune fonctionnalité métier : la
 * page prouve la chaîne complète cookie → jeton validé → client typé
 * `@pluka/db` → RLS, en lisant la seule ligne que l'utilisateur a le droit de
 * lire, la sienne.
 *
 * Cette lecture directe sous RLS est le cas que §6.3 autorise explicitement :
 * prévue, triviale, et vérifiée par la suite pgTAP. Toute mutation, elle,
 * passera par une Server Action et un use case de `@pluka/domain`.
 */
export default async function HomePage() {
  const session = await requireSession('/');
  const db = createDataClient(session.accessToken);

  // Projection explicite : jamais `select *`. Le type de `profile` est déduit
  // des colonnes demandées, sans annotation.
  const profile = unwrapMaybe(
    await db
      .from('users')
      .select(selectColumns('users', ['id', 'first_name', 'last_name', 'created_at']))
      .eq('id', session.userId)
      .maybeSingle(),
    'users.findSelf',
  );

  return (
    <main
      style={{
        maxWidth: 'var(--content-main)',
        margin: '0 auto',
        padding: 'var(--space-8) var(--space-6)',
      }}
    >
      <MicroLabel>Session</MicroLabel>

      <h1 className="pk-h1" style={{ margin: 'var(--space-2) 0 var(--space-6)' }}>
        Vous êtes connecté.
      </h1>

      <Divider spaced />

      <div style={{ display: 'flex', gap: 'var(--space-10)', flexWrap: 'wrap' }}>
        <DataValue label="Identifiant" value={session.userId} />
        <DataValue label="Adresse" value={session.email ?? 'inconnue'} />
        <DataValue
          label="Profil applicatif"
          value={profile === null ? 'en cours de création' : (profile.first_name ?? 'sans prénom')}
        />
      </div>

      <Divider spaced />

      <p className="pk-body" style={{ color: 'var(--pk-text-muted)' }}>
        Cette lecture passe par la RLS : elle ne retourne que la ligne de l&apos;utilisateur
        courant. Aucune fonctionnalité métier n&apos;est branchée à ce stade.
      </p>

      <form action={signOut} style={{ marginTop: 'var(--space-6)' }}>
        <button type="submit" className="pk-btn pk-button-secondary">
          Se déconnecter
        </button>
      </form>
    </main>
  );
}
