import type { PublicEventSite } from '@pluka/domain';

import { civilDayKey, fullDayLabel, raceTimeLabel } from '@/app/site/format';

/**
 * Le programme d'un site, jour par jour — EVENT_SITE §3.9.
 *
 * Les départs viennent des épreuves publiques : un horaire n'existe qu'une
 * fois. Seuls, ils n'ajoutent rien aux cartes d'épreuves : sans ligne écrite par
 * l'organisation, il n'y a pas de programme.
 */

/**
 * Masqué depuis le 2026-11-05 : ni l'éditeur ni le site ne le montrent, et les
 * lignes déjà enregistrées sont conservées. Le passer à `true` le fait revenir.
 */
export const SITE_PROGRAM_VISIBLE: boolean = false;

export interface ProgramEntry {
  readonly key: string;
  readonly time: string;
  readonly title: string;
  readonly location: string | null;
  /** La fiche de l'épreuve, pour un départ. */
  readonly href: string | null;
}

export interface ProgramDay {
  readonly key: string;
  readonly label: string;
  readonly entries: readonly ProgramEntry[];
}

interface Dated extends ProgramEntry {
  readonly startsAt: string;
  readonly timezone: string;
}

export function siteProgram(
  items: PublicEventSite['program'],
  races: PublicEventSite['races'],
): readonly ProgramDay[] {
  if (items.length === 0) return [];

  const entries: readonly Dated[] = [
    ...items.map((item) => ({
      key: `${item.startsAt}-${item.title}`,
      startsAt: item.startsAt,
      timezone: item.timezone,
      time: raceTimeLabel(item.startsAt, item.timezone),
      title: item.title,
      location: item.location,
      href: null,
    })),
    ...races.map((race) => ({
      key: `race-${race.id}`,
      startsAt: race.startDatetime,
      timezone: race.timezone,
      time: raceTimeLabel(race.startDatetime, race.timezone),
      title: `Départ · ${race.name}`,
      location: race.startLocationName,
      href: `/epreuves/${race.slug}`,
    })),
  ];

  const days = new Map<string, { label: string; entries: ProgramEntry[] }>();
  for (const entry of [...entries].sort(
    (left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime(),
  )) {
    const key = civilDayKey(entry.startsAt, entry.timezone);
    const day = days.get(key) ?? {
      label: fullDayLabel(entry.startsAt, entry.timezone),
      entries: [],
    };
    day.entries.push({
      key: entry.key,
      time: entry.time,
      title: entry.title,
      location: entry.location,
      href: entry.href,
    });
    days.set(key, day);
  }

  return [...days].map(([key, day]) => ({ key, ...day }));
}
