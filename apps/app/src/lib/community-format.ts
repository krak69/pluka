import {
  COMMUNITY_CATEGORIES,
  COMMUNITY_REPORT_REASONS,
  type CommunityCategory,
  type CommunitySummary,
  type ParticipationCommunity,
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

/** Ce que l'en-tête dit de la communauté : des comptes, rien de personnel. */
export function communityFigures(
  threads: readonly { readonly replyCount: number; readonly waypointId: string | null }[],
): string {
  const replies = threads.reduce((total, thread) => total + thread.replyCount, 0);
  const points = new Set(
    threads.flatMap((thread) => (thread.waypointId === null ? [] : [thread.waypointId])),
  ).size;
  return [
    discussionCount(threads.length),
    replies === 1 ? '1 réponse' : `${replies} réponses`,
    ...(points === 0
      ? []
      : [points === 1 ? '1 point du parcours' : `${points} points du parcours`]),
  ].join(' · ');
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

// ── Liens ───────────────────────────────────────────────────────────────

/** La liste d'une communauté, filtrée au besoin par catégorie ou par point. */
export function communityListHref(
  editionId: string,
  filter: {
    readonly category?: CommunityCategory | undefined;
    readonly point?: string | undefined;
  } = {},
): string {
  const params = new URLSearchParams({ edition: editionId });
  if (filter.category !== undefined) params.set('categorie', filter.category);
  if (filter.point !== undefined) params.set('point', filter.point);
  return `/communaute?${params.toString()}`;
}

/** Créer un sujet, prérempli d'une catégorie, d'une course ou d'un point. */
export function communityNewHref(
  editionId: string,
  prefill: {
    readonly category?: CommunityCategory | undefined;
    readonly race?: string | undefined;
    readonly point?: string | undefined;
  } = {},
): string {
  const params = new URLSearchParams({ edition: editionId });
  if (prefill.category !== undefined) params.set('categorie', prefill.category);
  if (prefill.race !== undefined) params.set('course', prefill.race);
  if (prefill.point !== undefined) params.set('point', prefill.point);
  return `/communaute/nouveau?${params.toString()}`;
}

export function communityThreadHref(threadId: string): string {
  return `/communaute/sujets/${threadId}`;
}

// ── Un point du parcours, vu depuis le Plan ou La course ───────────────

/** Ce que le Plan montre de la Communauté à un point — prototype `pointDrawer.threads`. */
export interface PointCommunity {
  readonly count: number;
  readonly listHref: string;
  readonly askHref: string;
  /** Les plus actifs d'abord, trois au plus. */
  readonly threads: readonly {
    readonly id: string;
    readonly title: string;
    readonly replies: string;
    readonly href: string;
  }[];
}

export const POINT_THREADS_SHOWN = 3;

/**
 * Un résumé par point de la course, même sans discussion : le lien « Poser une
 * question » existe partout. La base rend les sujets par activité récente.
 */
export function pointCommunities(
  community: ParticipationCommunity,
  waypointIds: readonly string[],
): Readonly<Record<string, PointCommunity>> {
  return Object.fromEntries(
    waypointIds.map((waypointId) => {
      const threads = community.pointThreads.filter((thread) => thread.waypointId === waypointId);
      return [
        waypointId,
        {
          count: threads.length,
          listHref: communityListHref(community.editionId, { point: waypointId }),
          askHref: communityNewHref(community.editionId, {
            race: community.raceId,
            point: waypointId,
          }),
          threads: threads.slice(0, POINT_THREADS_SHOWN).map((thread) => ({
            id: thread.id,
            title: thread.title,
            replies: replyCount(thread.replyCount),
            href: communityThreadHref(thread.id),
          })),
        },
      ];
    }),
  );
}
