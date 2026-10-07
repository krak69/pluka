/**
 * Invitation à rejoindre l'équipe PLUKA — migration 0036.
 *
 * Ce que la personne doit savoir pour décider : qui l'invite, avec quel rôle,
 * jusqu'à quand. Le lien porte le jeton en clair — seul endroit où il existe.
 */

export const STAFF_ROLES = ['super_admin', 'admin', 'support'] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

const ROLE_COPY: Readonly<Record<StaffRole, { label: string; description: string }>> = {
  super_admin: {
    label: 'Super-admin',
    description: 'toute la console, les paramètres et l’équipe PLUKA',
  },
  admin: { label: 'Admin', description: 'toute la console d’administration, sauf les paramètres' },
  support: {
    label: 'Support',
    description: 'la console en lecture seule, sans aucune modification',
  },
};

export interface StaffInvitationNotice {
  readonly recipientEmail: string;
  readonly staffRole: StaffRole;
  readonly inviterName: string | null;
  /** Instant ISO 8601. */
  readonly expiresAt: string;
  readonly acceptUrl: string;
}

export function staffRoleLabel(role: StaffRole): string {
  return ROLE_COPY[role].label;
}

function formatExpiry(instant: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(new Date(instant));
}

export function renderStaffInvitation(notice: StaffInvitationNotice): {
  readonly subject: string;
  readonly textBody: string;
} {
  const copy = ROLE_COPY[notice.staffRole];
  const who =
    notice.inviterName === null ? 'Vous êtes invité' : `${notice.inviterName} vous invite`;

  const textBody = [
    'Bonjour,',
    '',
    `${who} à rejoindre l'équipe PLUKA, avec le rôle ${copy.label} : ${copy.description}.`,
    '',
    `Rejoindre l'équipe : ${notice.acceptUrl}`,
    '',
    `Ce lien est personnel et valable jusqu'au ${formatExpiry(notice.expiresAt)}. Connectez-vous avec cette adresse (${notice.recipientEmail}) pour l'accepter.`,
    '',
    "Si vous n'attendiez pas cette invitation, ignorez ce message : rien ne se passera.",
    '',
    '— PLUKA',
  ].join('\n');

  return { subject: 'Invitation à rejoindre l’équipe PLUKA', textBody };
}
