import { previewStaffInvitation } from '@pluka/domain';
import type { Metadata } from 'next';
import Link from 'next/link';

import { acceptStaffInvitationAction } from '@/app/staff-actions';
import { AdminPageHeader } from '@/components/admin-page';
import { anonymousStaffTeamContext } from '@/lib/admin';
import { getSession } from '@/lib/session';

import { staffRoleLabel } from '../../parametres/equipe/staff-roles';

/**
 * Invitation à rejoindre l'équipe PLUKA — migration 0036.
 *
 * Seule page de la console ouverte hors équipe : on y arrive avant d'en
 * faire partie. Le jeton est dans l'URL — page non indexée, sans referrer
 * (AGENTS §64).
 *
 * §116 : aperçu minimal sans session (le rôle et l'état du lien), connexion
 * avec retour, puis acceptation, que la base réserve à l'adresse invitée.
 */
export const metadata: Metadata = {
  title: 'Invitation à l’équipe PLUKA',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

const OUTCOMES: Readonly<Record<string, string>> = {
  'autre-adresse':
    'Cette invitation a été envoyée à une autre adresse. Connectez-vous avec l’adresse qui a reçu l’email.',
  impossible: 'Cette invitation ne peut plus être acceptée : demandez-en une nouvelle.',
  erreur: 'Une erreur est survenue. Réessayez dans un instant.',
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function StaffInvitationPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly token: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { token } = await params;
  const raw = (await searchParams).etat;
  const state = Array.isArray(raw) ? raw[0] : raw;
  const preview = await previewStaffInvitation(anonymousStaffTeamContext(), { token });

  if (state === 'rejoint') {
    return (
      <main className="ad-page">
        <AdminPageHeader
          title="Bienvenue dans l’équipe PLUKA"
          lede="Votre accès est actif. Le menu s’ajuste à votre rôle."
        />
        <p>
          <Link href="/" className="pk-btn pk-button-primary">
            Ouvrir la console
          </Link>
        </p>
      </main>
    );
  }

  if (preview.state !== 'valid') {
    const message =
      preview.state === 'expired'
        ? 'Ce lien a expiré. Demandez une nouvelle invitation à un super-admin.'
        : preview.state === 'closed'
          ? 'Ce lien a déjà été utilisé ou a été annulé.'
          : 'Ce lien d’invitation n’est pas valide.';

    return (
      <main className="ad-page">
        <AdminPageHeader title="Invitation indisponible" lede={message} />
      </main>
    );
  }

  const session = await getSession();
  const returnTo = `/invitation-equipe/${token}`;
  const outcome = state === undefined ? undefined : OUTCOMES[state];
  const role = preview.staffRole === null ? null : staffRoleLabel(preview.staffRole);

  return (
    <main className="ad-page">
      <AdminPageHeader
        title="Rejoindre l’équipe PLUKA"
        lede={`Vous êtes invité à rejoindre l’administration de PLUKA${role === null ? '' : `, avec le rôle ${role}`}.`}
      />

      {session === null ? (
        <>
          <p className="pk-body ad-measure">
            Connectez-vous avec l’adresse qui a reçu l’invitation : un lien de connexion vous est
            envoyé.
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
        <form action={acceptStaffInvitationAction}>
          <input type="hidden" name="token" value={token} />
          <p className="pk-body ad-measure">Connecté en tant que {session.email ?? 'vous'}.</p>
          <button type="submit" className="pk-btn pk-button-primary">
            Accepter l’invitation
          </button>
        </form>
      )}

      {outcome === undefined ? null : (
        <p className="pk-body ad-notice" role="alert">
          {outcome}
        </p>
      )}
    </main>
  );
}
