/**
 * « Ton heure de départ change » — migration 0082.
 *
 * Une vague décide de l'heure de départ (PLAN_ENGINE §5.2). Quand
 * l'organisation change le coureur de vague, change l'heure de sa vague ou la
 * supprime, il l'apprend ici, avec l'avant et l'après. L'e-mail informe : il ne
 * recalcule rien, le coureur décide (AGENTS §15). Aucun champ libre, aucune
 * donnée d'un autre coureur.
 */

export interface StartChangedNotice {
  readonly recipientEmail: string;
  readonly recipientFirstName: string | null;
  readonly eventName: string;
  readonly raceName: string;
  readonly timezone: string;
  /** Nul : le départ de l'épreuve, sans vague. */
  readonly previousWaveName: string | null;
  readonly newWaveName: string | null;
  readonly previousStartAt: string;
  readonly newStartAt: string;
  readonly hasPlan: boolean;
  /** Lien vers le Plan de la course dans l'application. */
  readonly planUrl: string;
}

export interface RenderedStartChangedNotice {
  readonly subject: string;
  readonly textBody: string;
}

function moment(instant: string, timeZone: string): string {
  const date = new Date(instant);
  const day = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone }).format(
    date,
  );
  const time = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(date);
  return `le ${day} à ${time.replace(':', ' h ')}`;
}

function waveOf(name: string | null): string {
  return name === null ? "départ de l'épreuve" : `vague ${name}`;
}

export function renderStartChangedNotice(notice: StartChangedNotice): RenderedStartChangedNotice {
  const waveChanged = notice.previousWaveName !== notice.newWaveName;
  const lead = waveChanged
    ? `L'organisation de ${notice.eventName} a changé ta vague de départ pour ${notice.raceName}.`
    : `L'organisation de ${notice.eventName} a changé l'heure de départ de ta vague pour ${notice.raceName}.`;

  return {
    subject: `Ton heure de départ change — ${notice.raceName}`,
    textBody: [
      notice.recipientFirstName === null ? 'Bonjour,' : `Bonjour ${notice.recipientFirstName},`,
      '',
      lead,
      '',
      `Avant : ${waveOf(notice.previousWaveName)}, ${moment(notice.previousStartAt, notice.timezone)}.`,
      `Désormais : ${waveOf(notice.newWaveName)}, ${moment(notice.newStartAt, notice.timezone)}.`,
      '',
      notice.hasPlan
        ? "Ton Plan est encore calé sur l'ancienne heure : ouvre-le pour le mettre à jour. Rien ne change sans toi."
        : 'Ton Plan partira de cette nouvelle heure.',
      '',
      `Voir mon Plan : ${notice.planUrl}`,
      '',
      '— PLUKA',
    ].join('\n'),
  };
}
