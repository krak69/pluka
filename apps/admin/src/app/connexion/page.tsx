import { Input, MicroLabel } from '@pluka/ui';
import { redirect } from 'next/navigation';

import { requestSignInLinkAction } from '@/app/actions';
import { safeReturnTo } from '@/lib/return-to';
import { getSession } from '@/lib/session';

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Messages d'état.
 *
 * `lien-envoye` ne confirme pas l'existence du compte — même formulation que
 * l'adresse soit connue ou non.
 */
const MESSAGES: Readonly<Record<string, string>> = {
  'lien-envoye':
    'Si un compte correspond à cette adresse, un lien de connexion vient d’être envoyé.',
  'email-invalide': 'Cette adresse email n’est pas valide.',
  'envoi-impossible': 'L’envoi a échoué. Réessayez dans un instant.',
  'lien-invalide': 'Ce lien de connexion est expiré ou déjà utilisé.',
  deconnecte: 'Vous êtes déconnecté.',
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Connexion — squelette.
 *
 * Server Component : le formulaire poste vers une Server Action, il n'y a
 * donc aucun composant client ni client Supabase dans le navigateur
 * (01_ARCHITECTURE §6.1, §6.3).
 */
export default async function SignInPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const returnTo = safeReturnTo(firstValue(params.returnTo));

  // Déjà connecté : inutile de redemander un lien.
  if ((await getSession()) !== null) {
    redirect(returnTo);
  }

  const state = firstValue(params.etat);
  const message = state === undefined ? undefined : MESSAGES[state];

  return (
    <main
      style={{
        maxWidth: 'var(--content-reading)',
        margin: '0 auto',
        padding: 'var(--space-12) var(--space-6)',
      }}
    >
      <MicroLabel>Administration</MicroLabel>

      <h1 className="pk-h1" style={{ margin: 'var(--space-2) 0 var(--space-6)' }}>
        Recevoir un lien de connexion
      </h1>

      <form action={requestSignInLinkAction} style={{ display: 'grid', gap: 'var(--space-6)' }}>
        {/* Réassaini côté serveur avant toute redirection. */}
        <input type="hidden" name="returnTo" value={returnTo} />

        <Input
          id="email"
          name="email"
          label="Adresse email"
          type="email"
          autoComplete="email"
          required
          hint="Aucun mot de passe : vous recevez un lien à usage unique."
        />

        <div>
          <button type="submit" className="pk-btn pk-button-primary">
            Envoyer le lien
          </button>
        </div>
      </form>

      {message === undefined ? null : (
        <p className="pk-body" style={{ marginTop: 'var(--space-6)' }} role="status">
          {message}
        </p>
      )}
    </main>
  );
}
