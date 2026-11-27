import {
  COMMUNITY_CATEGORIES,
  COMMUNITY_REPORT_REASONS,
  type CommunityCategory,
  type CommunitySummary,
} from '@pluka/domain';

/**
 * Libellés et dates de la Communauté — prototype `commVals` ; 06_DESIGN_SYSTEM
 * §36.2 (« Communautaire »). L'écran ne parle ni d'enum ni de statut SQL.
 */

/** Les catégories du prototype, dans l'ordre de ses puces. */
export const COMMUNITY_CATEGORY_LABELS: Readonly<Record<CommunityCategory, string>> = {
  other: 'Questions',
  preparation: 'Préparation',
  race: 'Parcours',
  logistics: 'Logistique',
  equipment_nutrition: 'Matériel & nutrition',
  assistance: 'Assistance',
  review: 'Retours de course',
};

export type CommunityReportReason = (typeof COMMUNITY_REPORT_REASONS)[number];

export const COMMUNITY_REPORT_REASON_LABELS: Readonly<Record<CommunityReportReason, string>> = {
  spam: 'Publicité ou spam',
  abuse: 'Propos blessants',
  misinformation: 'Information fausse ou dangereuse',
  privacy: 'Données personnelles exposées',
  other: 'Autre raison',
};

export function isCommunityCategory(value: string | undefined): value is CommunityCategory {
  return (COMMUNITY_CATEGORIES as readonly string[]).includes(value ?? '');
}

/** « Les Clochers 2027 » : le nom de l'édition, pour le titre et le sélecteur. */
export function communityName(community: Pick<CommunitySummary, 'eventName' | 'year'>): string {
  return `${community.eventName} ${community.year}`;
}

export function discussionCount(count: number): string {
  return count === 1 ? '1 discussion' : `${count} discussions`;
}

export function replyCount(count: number): string {
  if (count === 0) return 'Aucune réponse';
  return count === 1 ? '1 réponse' : `${count} réponses`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Quand un message a été écrit : relatif sur la journée, puis la date à
 * l'heure de l'épreuve. Une horloge en avance d'un poste ne fait pas écrire
 * « dans 2 min » : tout ce qui n'est pas passé est « à l'instant ».
 */
export function communityWhen(isoInstant: string, now: Date, timeZone: string): string {
  const at = new Date(isoInstant);
  const elapsed = now.getTime() - at.getTime();

  if (elapsed < MINUTE) return 'à l’instant';
  if (elapsed < HOUR) return `il y a ${Math.floor(elapsed / MINUTE)} min`;
  if (elapsed < DAY) return `il y a ${Math.floor(elapsed / HOUR)} h`;

  const year = (date: Date) =>
    new Intl.DateTimeFormat('fr-FR', { year: 'numeric', timeZone }).format(date);
  const sameYear = year(at) === year(now);

  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone,
  }).format(at);
}
