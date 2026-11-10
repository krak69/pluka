/**
 * Avertissement avant la suppression d'un compte inactif — migration 0079.
 *
 * La politique annonce la suppression après 3 ans sans connexion. Cet e-mail
 * la rend visible 30 jours avant : un effacement ne doit jamais être silencieux
 * (AGENTS §102). Il dit la date, comment garder le compte, et comment
 * récupérer ses données d'abord.
 */

export interface AccountInactivityNotice {
  readonly recipientEmail: string;
  readonly recipientFirstName: string | null;
  /** Instant à partir duquel la purge de la nuit peut effacer le compte. */
  readonly purgeAfter: string;
  readonly signInUrl: string;
  readonly exportUrl: string;
  readonly privacyUrl: string;
}

export interface RenderedAccountInactivityNotice {
  readonly subject: string;
  readonly textBody: string;
}

function dayOf(instant: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(new Date(instant));
}

export function renderAccountInactivityNotice(
  notice: AccountInactivityNotice,
): RenderedAccountInactivityNotice {
  const day = dayOf(notice.purgeAfter);

  return {
    subject: `Ton compte PLUKA sera supprimé le ${day}`,
    textBody: [
      notice.recipientFirstName === null ? 'Bonjour,' : `Bonjour ${notice.recipientFirstName},`,
      '',
      "Tu ne t'es pas connecté à PLUKA depuis bientôt 3 ans. Comme l'annonce notre politique de confidentialité, ton compte et tes données seront supprimés à partir du " +
        `${day}.`,
      '',
      `Pour garder ton compte, il suffit de te connecter avant cette date : ${notice.signInUrl}`,
      '',
      `Pour garder une copie de tes données, connecte-toi et télécharge-les : ${notice.exportUrl}`,
      '',
      'Si tu ne fais rien, le compte, tes Plans, ta Nutrition, tes sorties et ton assistance seront effacés. Une course venue d’une organisation lui reste, sans ta préparation.',
      '',
      `Tes données et tes droits : ${notice.privacyUrl}`,
      '',
      '— PLUKA',
    ].join('\n'),
  };
}
