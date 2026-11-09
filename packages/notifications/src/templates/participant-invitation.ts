/**
 * Invitation d'un participant à activer PLUKA — 00_PRODUCT_SPEC §29.2, migration 0069.
 *
 * « L'invitation est personnalisée à l'événement. » Le message dit qui invite,
 * pour quelle course, ce qui l'attend, et avec quelle adresse se connecter.
 * Il ne porte ni dossard ni vague : ce qui est personnel attend la connexion.
 *
 * Le lien contient le jeton en clair : c'est le seul endroit où il existe.
 */

export interface ParticipantInvitationNotice {
  readonly recipientEmail: string;
  readonly recipientFirstName: string | null;
  readonly eventName: string;
  readonly raceName: string;
  /** Qui invite ; l'événement à défaut d'organisation. */
  readonly organizationName: string | null;
  /** Instant ISO 8601 du départ, qui borne aussi le lien. */
  readonly raceStart: string;
  /** Fuseau IANA de l'épreuve. */
  readonly raceTimezone: string;
  /** L'organisation offre l'accès premium à la course. */
  readonly included: boolean;
  readonly acceptUrl: string;
  /** La page où refuser d'être contacté, sans compte (0075). */
  readonly declineUrl: string;
  /** La politique de confidentialité du site public. */
  readonly privacyUrl: string;
}

export interface RenderedParticipantInvitation {
  readonly subject: string;
  readonly textBody: string;
}

function formatStart(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(new Date(instant));
}

export function renderParticipantInvitation(
  notice: ParticipantInvitationNotice,
): RenderedParticipantInvitation {
  const greeting =
    notice.recipientFirstName === null ? 'Bonjour,' : `Bonjour ${notice.recipientFirstName},`;
  const host = notice.organizationName ?? notice.eventName;
  const start = formatStart(notice.raceStart, notice.raceTimezone);

  const textBody = [
    greeting,
    '',
    `${host} t'invite à préparer ${notice.raceName} (${notice.eventName}) avec PLUKA.`,
    '',
    'Ton espace est déjà prêt avec les informations officielles de ta course : il te reste à choisir ton objectif pour obtenir ton Plan.',
    ...(notice.included
      ? ['', "L'accès complet à la préparation de cette course t'est offert par l'organisation."]
      : []),
    '',
    `Activer mon espace : ${notice.acceptUrl}`,
    '',
    `Ce lien est personnel et valable jusqu'au départ, le ${start}. Connecte-toi avec cette adresse (${notice.recipientEmail}) pour l'activer.`,
    '',
    "Si tu n'es pas inscrit à cette course, ignore ce message : rien ne se passera.",
    '',
    '— PLUKA',
    '',
    // D'où vient l'adresse, et comment ne plus être contacté : le minimum que
    // doit dire un premier e-mail envoyé à partir d'une liste transmise.
    `Tu reçois ce message parce que ${host} t'a inscrit à ${notice.raceName} et a transmis ton adresse à PLUKA, le service de préparation proposé aux participants de la course.`,
    `Tu ne souhaites pas être contacté : ${notice.declineUrl}`,
    `Tes données et tes droits : ${notice.privacyUrl}`,
  ].join('\n');

  return {
    subject: `${notice.eventName} : prépare ${notice.raceName} avec PLUKA`,
    textBody,
  };
}
