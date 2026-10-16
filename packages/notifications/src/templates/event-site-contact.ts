/**
 * Message reçu par le formulaire de contact d'un site — EVENT_SITE §6.
 *
 * Il part à l'adresse de contact de l'événement. Répondre répond au coureur :
 * son adresse est en `Reply-To`. Le message est rendu en texte brut, tel que
 * le coureur l'a écrit — aucun HTML ne le traverse.
 */

export interface EventSiteContactNotice {
  readonly recipientEmail: string;
  readonly eventName: string;
  /** L'épreuve que le coureur a désignée, s'il l'a fait. */
  readonly raceName: string | null;
  readonly senderName: string;
  readonly senderEmail: string;
  readonly body: string;
}

/* Un nom ou un nom d'épreuve n'a rien à faire sur deux lignes d'un objet de mail. */
function oneLine(value: string): string {
  return value.replace(/[\r\n\t]+/gu, ' ').trim();
}

export function renderEventSiteContact(notice: EventSiteContactNotice): {
  readonly subject: string;
  readonly textBody: string;
} {
  const sender = oneLine(notice.senderName);
  const race = notice.raceName === null ? null : oneLine(notice.raceName);

  const textBody = [
    `${sender} vous écrit depuis le site de ${oneLine(notice.eventName)}.`,
    race === null ? null : `Épreuve concernée : ${race}`,
    '',
    notice.body.trim(),
    '',
    '—',
    `Répondez directement à ce message : la réponse part à ${notice.senderEmail}.`,
    'PLUKA a transmis ce message sans le conserver.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return {
    subject: `Message de ${sender}${race === null ? '' : ` · ${race}`} — ${oneLine(notice.eventName)}`,
    textBody,
  };
}
