/**
 * Invitation à rejoindre l'équipe d'une organisation — migration 0033.
 *
 * Le message ne porte que ce que la personne invitée doit savoir pour
 * décider : qui l'invite, dans quelle organisation, avec quel rôle, et
 * jusqu'à quand. Rien sur l'équipe en place ni sur les participants.
 *
 * Le lien contient le jeton en clair : c'est le seul endroit où il existe.
 */

export const ORGANIZATION_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

/** Libellés et descriptions de l'`orgTeam` du prototype. */
const ROLE_COPY: Readonly<Record<OrganizationRole, { label: string; description: string }>> = {
  owner: {
    label: 'Propriétaire',
    description: 'gère tout, y compris l’organisation et l’équipe',
  },
  admin: {
    label: 'Administrateur',
    description: 'gère l’événement, les sources et les participants',
  },
  editor: {
    label: 'Éditeur',
    description: 'modifie les contenus et valide les informations',
  },
  viewer: { label: 'Lecture seule', description: 'consulte sans modifier' },
};

export interface OrganizationInvitationNotice {
  readonly recipientEmail: string;
  readonly organizationName: string;
  readonly role: OrganizationRole;
  /** Nom de la personne qui invite ; `null` quand le compte n'en porte pas. */
  readonly inviterName: string | null;
  /** Instant ISO 8601. */
  readonly expiresAt: string;
  readonly acceptUrl: string;
}

export interface RenderedInvitation {
  readonly subject: string;
  readonly textBody: string;
}

/**
 * Date d'expiration en français. Le fuseau est celui de l'équipe PLUKA : le
 * destinataire n'en a pas encore, puisqu'il n'a peut-être pas de compte.
 */
function formatExpiry(instant: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(new Date(instant));
}

export function roleLabel(role: OrganizationRole): string {
  return ROLE_COPY[role].label;
}

export function renderOrganizationInvitation(
  notice: OrganizationInvitationNotice,
): RenderedInvitation {
  const copy = ROLE_COPY[notice.role];
  const who =
    notice.inviterName === null ? 'Vous êtes invité' : `${notice.inviterName} vous invite`;

  const textBody = [
    'Bonjour,',
    '',
    `${who} à rejoindre l'équipe de ${notice.organizationName} sur PLUKA, avec le rôle ${copy.label} : ${copy.description}.`,
    '',
    `Rejoindre l'équipe : ${notice.acceptUrl}`,
    '',
    `Ce lien est personnel et valable jusqu'au ${formatExpiry(notice.expiresAt)}. Connectez-vous avec cette adresse (${notice.recipientEmail}) pour l'accepter.`,
    '',
    "Si vous n'attendiez pas cette invitation, ignorez ce message : rien ne se passera.",
    '',
    '— PLUKA',
  ].join('\n');

  return {
    subject: `Invitation à rejoindre ${notice.organizationName} sur PLUKA`,
    textBody,
  };
}
