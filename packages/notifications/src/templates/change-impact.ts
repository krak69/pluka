/**
 * Notification « un changement officiel concerne ta préparation » — §46.
 *
 * « Même si l'organisateur publie une nouvelle barrière : le RaceFact courant
 * change ; le Plan existant est marqué potentiellement impacté ; **le coureur
 * est informé** ; le recalcul se fait selon le workflow produit. »
 *
 * Ce gabarit informe. Il ne décide de rien, ne recalcule rien, et ne demande
 * rien d'irréversible : il dit ce qui a changé et où le revoir. §46 place la
 * décision chez le coureur, et un email qui annoncerait « ton Plan a été mis à
 * jour » mentirait.
 *
 * CE QUE LE CONTENU NE CONTIENT JAMAIS
 *
 * Aucune donnée d'un autre coureur. Ce n'est pas une consigne de rédaction
 * mais une propriété de la signature : `ChangeImpactNotice` ne porte que le
 * destinataire et de l'information de course — laquelle est publique pour qui
 * lit la page de l'épreuve. Il n'existe aucun champ où un tiers pourrait
 * entrer.
 *
 * Aucune adresse d'organisation non plus : `to` ne prend qu'un destinataire, et
 * le gabarit n'expose ni copie ni copie cachée. `00_PRODUCT_SPEC` §37 interdit
 * à l'organisation de connaître la préparation d'un coureur nommé ; recevoir
 * copie de cet email le lui apprendrait.
 */

/** Modules de préparation qu'un changement peut concerner — §44. */
export const IMPACTED_MODULES = [
  'plan',
  'preparation',
  'nutrition',
  'assistance',
  'course',
  'conditions',
] as const;

export type ImpactedModule = (typeof IMPACTED_MODULES)[number];

/**
 * Libellés, en français.
 *
 * Le produit est francophone (`users.locale` vaut `fr-FR` par défaut) et
 * aucune infrastructure de traduction n'existe encore : afficher une clé
 * technique — « plan », « conditions » — dans un email serait pire qu'un
 * libellé non traduit.
 */
const MODULE_LABEL: Readonly<Record<ImpactedModule, string>> = {
  plan: 'ton Plan',
  preparation: 'ta préparation',
  nutrition: 'ta stratégie Nutrition',
  assistance: 'ton Assistance',
  course: 'les informations de course',
  conditions: 'tes Conditions',
};

export const CHANGE_SEVERITIES = ['info', 'important', 'critical'] as const;

export type ChangeSeverity = (typeof CHANGE_SEVERITIES)[number];

/**
 * Ce qu'il faut pour écrire la notification, et rien de plus.
 *
 * Chaque champ est soit le destinataire lui-même, soit une information de
 * course. Il n'y a délibérément aucun champ libre : un gabarit qui accepterait
 * du texte arbitraire pourrait, un jour, recevoir le contenu d'un autre
 * coureur.
 */
export interface ChangeImpactNotice {
  readonly recipientEmail: string;
  readonly recipientFirstName: string | null;
  readonly eventName: string;
  readonly raceName: string;
  /** Titre du changement : la clé logique du fact, une information de course. */
  readonly changeTitle: string;
  readonly severity: ChangeSeverity;
  readonly modules: readonly ImpactedModule[];
  /** Lien vers la course dans l'application. */
  readonly raceUrl: string;
}

export interface RenderedNotice {
  readonly subject: string;
  readonly textBody: string;
}

/**
 * Énumération lisible : « ton Plan, ta préparation et tes Conditions ».
 *
 * Les doublons sont écartés et l'ordre est celui de `IMPACTED_MODULES`, pour
 * que deux notifications portant les mêmes modules produisent exactement le
 * même texte — donc la même empreinte, si un jour on la calcule.
 */
export function listModules(modules: readonly ImpactedModule[]): string {
  const ordered = IMPACTED_MODULES.filter((module) => modules.includes(module)).map(
    (module) => MODULE_LABEL[module],
  );

  if (ordered.length === 0) return 'ta préparation';
  if (ordered.length === 1) return ordered[0] as string;

  return `${ordered.slice(0, -1).join(', ')} et ${ordered[ordered.length - 1] as string}`;
}

/**
 * Objet du message.
 *
 * La sévérité change le ton, jamais le fond. §46 veut que le coureur soit
 * informé, pas alarmé : « critical » au sens de §43 signifie « à fort impact »,
 * pas « urgence vitale ».
 */
function subjectFor(notice: ChangeImpactNotice): string {
  const prefix = notice.severity === 'critical' ? 'Changement important' : 'Mise à jour';

  return `${prefix} — ${notice.raceName}`;
}

export function renderChangeImpactNotice(notice: ChangeImpactNotice): RenderedNotice {
  const greeting =
    notice.recipientFirstName === null ? 'Bonjour,' : `Bonjour ${notice.recipientFirstName},`;

  const textBody = [
    greeting,
    '',
    `L'organisation a publié une information officielle sur ${notice.raceName} (${notice.eventName}).`,
    '',
    `Élément concerné : ${notice.changeTitle}`,
    '',
    // §46 : « le recalcul se fait selon le workflow produit ». Le verbe est
    // « revoir », jamais « nous avons mis à jour ».
    `Cela peut concerner ${listModules(notice.modules)}. Rien n'a été modifié à ta place : tu décides de ce que tu ajustes.`,
    '',
    `Revoir la course : ${notice.raceUrl}`,
    '',
    '— PLUKA',
  ].join('\n');

  return { subject: subjectFor(notice), textBody };
}
