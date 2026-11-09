import { previewParticipantInvitation } from '@pluka/domain';
import { MicroLabel } from '@pluka/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { acceptParticipantInvitationAction } from '@/app/participant-actions';
import {
  anonymousParticipantInvitationContext,
  participantInvitationsEnabled,
} from '@/lib/participant-invitations';
import { getSession } from '@/lib/session';

/**
 * Invitation d'un participant — 05_ROUTES_FLOWS §4.2, migration 0069.
 *
 * Le jeton est dans l'URL : la page n'est pas indexée et n'envoie pas de
 * referrer (AGENTS §64). Trois temps, comme 03_PRIVACY_RLS §116 :
 *
 * 1. aperçu minimal, sans session : l'événement, l'épreuve, l'adresse masquée ;
 * 2. connexion, avec retour ici ;
 * 3. activation, que la base n'accorde qu'à l'adresse invitée (§117).
 *
 * Ensuite, l'onboarding court de §7.3 : l'objectif, puis le Plan. Pas de prix
 * quand l'organisation offre l'accès (04_ENTITLEMENTS §13).
 */
export const metadata: Metadata = {
  title: 'Invitation',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

const OUTCOMES: Readonly<Record<string, string>> = {
  'autre-adresse':
    'Cette invitation a été envoyée à une autre adresse. Connecte-toi avec l’adresse qui a reçu l’email.',
  impossible:
    'Cette invitation ne peut plus être activée : demande à l’organisation de te la renvoyer.',
  erreur: 'Une erreur est survenue. Réessaie dans un instant.',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function startLabel(instant: string | null, timeZone: string | null): string | null {
  if (instant === null) return null;
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timeZone ?? 'Europe/Paris',
  }).format(new Date(instant));
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
      <MicroLabel>Invitation</MicroLabel>
      {children}
    </main>
  );
}

export default async function ParticipantInvitationPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly token: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  if (!participantInvitationsEnabled()) notFound();

  const { token } = await params;
  const query = await searchParams;
  const state = first(query.etat);
  const participation = first(query.participation);

  if (state === 'activee' && participation !== undefined && UUID.test(participation)) {
    return (
      <Frame>
        <h1 className="pk-h1" style={{ margin: 'var(--space-2) 0 var(--space-6)' }}>
          Ton espace est activé
        </h1>
        <p className="pk-body">
          Les informations officielles de ta course sont déjà là. Choisis ton objectif : PLUKA
          construit ton Plan autour de lui.
        </p>
        <p>
          <Link href={`/courses/${participation}/objectif`} className="pk-btn pk-button-primary">
            Choisir mon objectif
          </Link>
        </p>
        <p className="pk-body">
          <Link href={`/courses/${participation}`} className="pk-link">
            Voir ma course
          </Link>
        </p>
      </Frame>
    );
  }

  const preview = await previewParticipantInvitation(anonymousParticipantInvitationContext(), {
    token,
  });

  if (preview.state !== 'valid') {
    const message =
      preview.state === 'expired'
        ? 'Ce lien a expiré : le départ de la course est passé.'
        : preview.state === 'closed'
          ? 'Ce lien a déjà été utilisé ou a été remplacé par un plus récent.'
          : 'Ce lien d’invitation n’est pas valide.';

    return (
      <Frame>
        <h1 className="pk-h1" style={{ margin: 'var(--space-2) 0 var(--space-6)' }}>
          Invitation indisponible
        </h1>
        <p className="pk-body">{message}</p>
        {preview.state === 'closed' ? (
          <p className="pk-body">
            Tu as déjà activé ton espace ?{' '}
            <Link href="/" className="pk-link">
              Retrouve ta course
            </Link>
          </p>
        ) : null}
      </Frame>
    );
  }

  const session = await getSession();
  const returnTo = `/invitation/${token}`;
  const outcome = state === undefined ? undefined : OUTCOMES[state];
  const host = preview.organizationName ?? preview.eventName ?? 'L’organisation';
  const start = startLabel(preview.raceStart, preview.raceTimezone);

  return (
    <Frame>
      <h1 className="pk-h1" style={{ margin: 'var(--space-2) 0 var(--space-6)' }}>
        Prépare {preview.raceName}
      </h1>

      <p className="pk-body">
        {host} t’invite à préparer {preview.raceName}
        {preview.eventName === null ? '' : ` (${preview.eventName})`} avec PLUKA
        {start === null ? '' : `, au départ le ${start}`}.
      </p>
      <p className="pk-body">
        Ton espace est déjà prérempli avec les informations officielles de la course.
        {preview.included
          ? ' L’accès complet à la préparation de cette course t’est offert par l’organisation.'
          : ''}
      </p>

      {session === null ? (
        <>
          <p className="pk-body">
            Connecte-toi avec l’adresse qui a reçu l’invitation
            {preview.maskedEmail === null ? '' : ` (${preview.maskedEmail})`}. Pas besoin de compte
            au préalable : un lien de connexion t’est envoyé.
          </p>
          <p>
            <Link
              href={`/connexion?returnTo=${encodeURIComponent(returnTo)}`}
              className="pk-btn pk-button-primary"
            >
              Me connecter pour activer
            </Link>
          </p>
        </>
      ) : (
        <form action={acceptParticipantInvitationAction}>
          <input type="hidden" name="token" value={token} />
          <p className="pk-body">
            Connecté en tant que {session.email ?? 'toi'}
            {preview.maskedEmail === null ? '' : ` · invitation envoyée à ${preview.maskedEmail}`}.
          </p>
          <button type="submit" className="pk-btn pk-button-primary">
            Activer mon espace
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
