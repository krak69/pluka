import { previewOrganizationInvitation } from '@pluka/domain';
import { MicroLabel } from '@pluka/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { acceptTeamInvitationAction } from '@/app/team-actions';
import { getSession } from '@/lib/session';
import { anonymousTeamContext } from '@/lib/team';

/**
 * Invitation à rejoindre l'équipe d'une organisation — migration 0033.
 *
 * Le jeton est dans l'URL : la page n'est pas indexée, et elle n'envoie pas de
 * referrer (AGENTS §64) — un clic sortant ne doit pas emporter le lien.
 *
 * Trois temps, comme §116 :
 *
 * 1. aperçu minimal, sans session : l'organisation, le rôle, l'état du lien ;
 * 2. connexion, avec retour ici ;
 * 3. acceptation, que la base n'accorde qu'à l'adresse invitée (§117).
 */
export const metadata: Metadata = {
  title: 'Invitation d’équipe',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

const ROLE_LABELS: Readonly<Record<string, string>> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  editor: 'Éditeur',
  viewer: 'Lecture seule',
};

const OUTCOMES: Readonly<Record<string, string>> = {
  'autre-adresse':
    'Cette invitation a été envoyée à une autre adresse. Connectez-vous avec l’adresse qui a reçu l’email.',
  impossible: 'Cette invitation ne peut plus être acceptée : demandez-en une nouvelle.',
  erreur: 'Une erreur est survenue. Réessayez dans un instant.',
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function Frame({ children }: { readonly children: React.ReactNode }) {
  return (
    <main
      style={{
        maxWidth: 'var(--content-reading)',
        margin: '0 auto',
        padding: 'var(--space-12) var(--space-6)',
      }}
    >
      <MicroLabel>Invitation d’équipe</MicroLabel>
      {children}
    </main>
  );
}

export default async function TeamInvitationPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly token: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { token } = await params;
  const state = first((await searchParams).etat);
  const preview = await previewOrganizationInvitation(anonymousTeamContext(), { token });

  if (state === 'rejoint') {
    return (
      <Frame>
        <h1 className="pk-h1" style={{ margin: 'var(--space-2) 0 var(--space-6)' }}>
          Vous avez rejoint {preview.organizationName ?? 'l’organisation'}
        </h1>
        <p className="pk-body">Votre accès est actif.</p>
        <p className="pk-body">
          <Link href="/org" className="pk-link">
            Ouvrir l’espace organisateur
          </Link>
        </p>
      </Frame>
    );
  }

  if (preview.state !== 'valid') {
    const message =
      preview.state === 'expired'
        ? 'Ce lien a expiré. Demandez à l’organisation de vous inviter à nouveau.'
        : preview.state === 'closed'
          ? 'Ce lien a déjà été utilisé ou a été annulé.'
          : 'Ce lien d’invitation n’est pas valide.';

    return (
      <Frame>
        <h1 className="pk-h1" style={{ margin: 'var(--space-2) 0 var(--space-6)' }}>
          Invitation indisponible
        </h1>
        <p className="pk-body">{message}</p>
      </Frame>
    );
  }

  const session = await getSession();
  const returnTo = `/invitation-equipe/${token}`;
  const outcome = state === undefined ? undefined : OUTCOMES[state];
  const role = preview.role === null ? null : (ROLE_LABELS[preview.role] ?? preview.role);

  return (
    <Frame>
      <h1 className="pk-h1" style={{ margin: 'var(--space-2) 0 var(--space-6)' }}>
        Rejoindre {preview.organizationName}
      </h1>

      <p className="pk-body">
        Vous êtes invité à rejoindre l’équipe de {preview.organizationName} sur PLUKA
        {role === null ? '' : `, avec le rôle ${role}`}.
      </p>

      {session === null ? (
        <>
          <p className="pk-body">
            Connectez-vous avec l’adresse qui a reçu l’invitation. Pas besoin de compte au préalable
            : un lien de connexion vous est envoyé.
          </p>
          <p>
            <Link
              href={`/connexion?returnTo=${encodeURIComponent(returnTo)}`}
              className="pk-btn pk-button-primary"
            >
              Se connecter pour accepter
            </Link>
          </p>
        </>
      ) : (
        <form action={acceptTeamInvitationAction}>
          <input type="hidden" name="token" value={token} />
          <p className="pk-body">Connecté en tant que {session.email ?? 'vous'}.</p>
          <button type="submit" className="pk-btn pk-button-primary">
            Accepter l’invitation
          </button>
        </form>
      )}

      {outcome === undefined ? null : (
        <p className="pk-body" role="alert" style={{ marginTop: 'var(--space-6)' }}>
          {outcome}
        </p>
      )}
    </Frame>
  );
}
