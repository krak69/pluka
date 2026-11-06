/**
 * Notifications d'annulation et de rétablissement — 00_PRODUCT_SPEC §4.1.
 *
 * Elles informent et ne promettent rien : ni remboursement, ni report, qui
 * relèvent de l'organisation. La préparation du coureur ne bouge pas. Même
 * garantie que le changement officiel : la signature ne porte que le
 * destinataire et de l'information de course, sans champ libre.
 */

export interface RaceStatusNotice {
  readonly recipientEmail: string;
  readonly recipientFirstName: string | null;
  readonly eventName: string;
  readonly raceName: string;
  /** Lien vers la course dans l'application. */
  readonly raceUrl: string;
}

export interface RenderedRaceStatusNotice {
  readonly subject: string;
  readonly textBody: string;
}

function greetingOf(notice: RaceStatusNotice): string {
  return notice.recipientFirstName === null ? 'Bonjour,' : `Bonjour ${notice.recipientFirstName},`;
}

export function renderRaceCancelledNotice(notice: RaceStatusNotice): RenderedRaceStatusNotice {
  return {
    subject: `Épreuve annulée — ${notice.raceName}`,
    textBody: [
      greetingOf(notice),
      '',
      `L'organisation a annulé ${notice.raceName} (${notice.eventName}).`,
      '',
      "Ta préparation reste accessible : rien n'a été supprimé.",
      "Pour toute question sur ton inscription, contacte l'organisation.",
      '',
      `Revoir la course : ${notice.raceUrl}`,
      '',
      '— PLUKA',
    ].join('\n'),
  };
}

export function renderRaceReinstatedNotice(notice: RaceStatusNotice): RenderedRaceStatusNotice {
  return {
    subject: `Annulation levée — ${notice.raceName}`,
    textBody: [
      greetingOf(notice),
      '',
      `L'organisation a rétabli ${notice.raceName} (${notice.eventName}) : l'annulation est levée.`,
      '',
      "Ta préparation est restée en place : rien n'a été modifié.",
      '',
      `Revoir la course : ${notice.raceUrl}`,
      '',
      '— PLUKA',
    ].join('\n'),
  };
}
