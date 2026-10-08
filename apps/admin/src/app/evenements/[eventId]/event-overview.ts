import type { EditionRecord, RaceRecord } from '@pluka/db';
import type { EventReadiness, ReadinessTodo } from '@pluka/domain';

import { factCategoryLabel, statusLabel } from '@/components/admin-status';

/**
 * Présentation de la fiche événement de la console.
 *
 * Les règles — ce qui est à faire, fait, visible — viennent de
 * `eventReadiness` (`@pluka/domain`), partagé avec l'espace organisateur.
 * Ce module ne garde que ce qui appartient à cet écran : ses formats, la
 * phrase du bandeau, l'activité récente. Hors de `page.tsx` parce qu'une page
 * Next n'exporte pas d'aide, et que ces aides se testent.
 */

/**
 * La phrase du bandeau — l'état de l'événement dit en une ligne, d'après le
 * premier point à reprendre. Le vocabulaire est celui de l'équipe PLUKA ;
 * l'espace organisateur aura le sien sur la même lecture.
 */
const HEADLINES: Readonly<Record<ReadinessTodo['kind'], string>> = {
  'first-edition': 'Créez une première édition pour commencer.',
  'publish-event': 'L’événement est en préparation : publiez-le pour ouvrir ses éditions.',
  'publish-edition': 'L’édition attend sa diffusion.',
  'add-race': 'Ajoutez une première épreuve à l’édition.',
  'publish-races': 'Les épreuves ne sont pas encore visibles des coureurs.',
  'open-races': 'Des épreuves diffusées restent invisibles des coureurs.',
  review: 'Des informations extraites attendent une validation.',
};

export function headlineOf(readiness: Pick<EventReadiness, 'todos'>): string {
  const first = readiness.todos[0];
  return first === undefined
    ? 'Tout est publié : les coureurs voient l’événement.'
    : HEADLINES[first.kind];
}

/** La ligne Aube du bandeau : le nombre de points, ou rien à reprendre. */
export function pointsLine(readiness: Pick<EventReadiness, 'todos'>): string {
  const count = readiness.todos.length;
  if (count === 0) return 'Rien à reprendre';
  return `${count} point${count > 1 ? 's' : ''} à reprendre`;
}

// ------------------------------------------------------------
// Activité récente
// ------------------------------------------------------------

export interface StatusEntry {
  readonly id: string;
  readonly fromStatus: string;
  readonly toStatus: string;
  readonly createdAt: string;
}

export interface PublishedFact {
  readonly raceName: string;
  readonly category: string;
  readonly publishedAt: string | null;
}

export interface Activity {
  readonly key: string;
  readonly text: string;
  readonly at: string;
}

/**
 * Ce qui s'est passé, le plus récent d'abord : les changements de statut de
 * l'événement et de ses éditions, et les informations publiées — une ligne par
 * épreuve et catégorie, à la date de la dernière publication. Rien n'est
 * déduit : chaque ligne vient d'un horodatage lu en base.
 */
export function activityOf(input: {
  readonly eventHistory: readonly StatusEntry[];
  readonly editions: readonly {
    readonly year: number;
    readonly history: readonly StatusEntry[];
  }[];
  readonly facts: readonly PublishedFact[];
  readonly limit?: number;
}): readonly Activity[] {
  const activities: Activity[] = [
    ...input.eventHistory.map((entry) => ({
      key: `event-${entry.id}`,
      text: `Événement : ${statusLabel('event', entry.fromStatus)} → ${statusLabel('event', entry.toStatus)}`,
      at: entry.createdAt,
    })),
    ...input.editions.flatMap(({ year, history }) =>
      history.map((entry) => ({
        key: `edition-${entry.id}`,
        text: `Édition ${year} : ${statusLabel('edition', entry.fromStatus)} → ${statusLabel('edition', entry.toStatus)}`,
        at: entry.createdAt,
      })),
    ),
  ];

  const latest = new Map<string, PublishedFact & { readonly publishedAt: string }>();
  for (const fact of input.facts) {
    if (fact.publishedAt === null) continue;
    const key = `${fact.raceName}|${fact.category}`;
    const known = latest.get(key);
    if (known === undefined || known.publishedAt < fact.publishedAt) {
      latest.set(key, { ...fact, publishedAt: fact.publishedAt });
    }
  }
  for (const [key, fact] of latest) {
    activities.push({
      key: `fact-${key}`,
      text: `Information publiée : ${factCategoryLabel(fact.category)} — ${fact.raceName}`,
      at: fact.publishedAt,
    });
  }

  return activities
    .sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0))
    .slice(0, input.limit ?? 6);
}

// ------------------------------------------------------------
// Formats
// ------------------------------------------------------------

/** « 82,5 km · 4 500 m D+ » : la distance toujours, le dénivelé quand il est connu. */
export function raceMeasures(
  race: Pick<RaceRecord, 'distanceKm' | 'elevationGainM' | 'elevationLossM'>,
): string {
  const number = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
  return [
    `${number.format(race.distanceKm)} km`,
    race.elevationGainM === null ? null : `${number.format(race.elevationGainM)} m D+`,
    race.elevationLossM === null ? null : `${number.format(race.elevationLossM)} m D-`,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

/**
 * Le départ à l'heure de la ligne de départ — c'est l'heure du règlement, pas
 * celle de l'écran. Un fuseau illisible n'est pas réparé : l'instant brut
 * s'affiche, pour que l'erreur se voie.
 */
export function raceStart(race: Pick<RaceRecord, 'startDatetime' | 'timezone'>): string {
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: race.timezone,
    }).format(new Date(race.startDatetime));
  } catch {
    return race.startDatetime;
  }
}

const DAY = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** « 12 juin 2027 », ou « 12 juin 2027 → 14 juin 2027 » : des dates civiles, sans fuseau. */
export function editionDates(edition: Pick<EditionRecord, 'startDate' | 'endDate'>): string {
  const format = (date: string): string => {
    const parsed = new Date(`${date}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? date : DAY.format(parsed);
  };
  return edition.endDate === null || edition.endDate === edition.startDate
    ? format(edition.startDate)
    : `${format(edition.startDate)} → ${format(edition.endDate)}`;
}
