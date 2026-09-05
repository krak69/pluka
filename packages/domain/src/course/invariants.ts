import type { EditionRecord, EventRecord, RaceRecord } from '@pluka/db';

import { isPubliclyReadableStatus } from './lifecycle.js';

/**
 * Invariants Event / Edition / Race.
 *
 * Fonctions pures : mêmes entrées, mêmes sorties, aucune I/O, aucune horloge
 * implicite. Elles rendent un verdict ; la traduction en erreur appartient
 * aux use cases.
 */

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Forme d'un slug.
 *
 * Le schéma impose l'unicité — `(event_id, slug)` pour une édition,
 * `(edition_id, slug)` pour une épreuve — mais pas le format. Convention
 * d'implémentation : minuscules, chiffres et tirets simples, pour que l'URL
 * publique d'une course reste stable et lisible.
 */
export function isValidSlug(value: string): boolean {
  return value.length > 0 && value.length <= 80 && SLUG_PATTERN.test(value);
}

/**
 * Hiérarchie Organization → Event → Edition → Race (02_DATA_MODEL §3.1).
 *
 * Deux éditions d'un même événement sont deux périmètres distincts, deux
 * distances d'une même édition deux Race distinctes : un objet enfant
 * appartient à un seul parent et n'en change pas.
 */
export function belongsToEdition(race: RaceRecord, editionId: string): boolean {
  return race.editionId === editionId;
}

export function belongsToEvent(edition: EditionRecord, eventId: string): boolean {
  return edition.eventId === eventId;
}

export interface RaceSchedule {
  readonly startDatetime: string;
  readonly cutoffDatetime: string | null;
  readonly timezone: string;
}

export type ScheduleVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        'start_invalid' | 'cutoff_invalid' | 'cutoff_before_start' | 'timezone_unknown';
    };

function isValidInstant(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function isKnownTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Cohérence temporelle d'une épreuve.
 *
 * La barrière finale suit le départ — le schéma porte la même contrainte,
 * mais la refuser ici donne une erreur métier lisible plutôt qu'une violation
 * SQL. La timezone IANA est obligatoire (02_DATA_MODEL §6.4) : les heures de
 * passage, les Conditions et l'Assistance en dépendent, et un ultra
 * multi-jour interdit de raisonner en durée seule.
 */
export function checkRaceSchedule(schedule: RaceSchedule): ScheduleVerdict {
  if (!isValidInstant(schedule.startDatetime)) return { ok: false, reason: 'start_invalid' };

  if (!isKnownTimeZone(schedule.timezone)) return { ok: false, reason: 'timezone_unknown' };

  if (schedule.cutoffDatetime !== null) {
    if (!isValidInstant(schedule.cutoffDatetime)) return { ok: false, reason: 'cutoff_invalid' };

    if (Date.parse(schedule.cutoffDatetime) <= Date.parse(schedule.startDatetime)) {
      return { ok: false, reason: 'cutoff_before_start' };
    }
  }

  return { ok: true };
}

/** Statuts d'édition considérés comme diffusés. */
const READABLE_EDITION_STATUSES: readonly EditionRecord['status'][] = ['published', 'completed'];

export function isEditionReadable(edition: EditionRecord): boolean {
  return READABLE_EDITION_STATUSES.includes(edition.status);
}

export function isEventReadable(event: EventRecord): boolean {
  return event.status === 'published';
}

/**
 * Lisibilité publique d'une Race — §4.1, invariants 1 et 2.
 *
 * « Une Race n'est publiquement lisible que si elle est `published`,
 * `cancelled`, `completed` ou `archived`, **et** que son Edition est
 * diffusée, **et** que son Event l'est aussi. »
 *
 * La chaîne entière compte : une course publiée sous une édition en
 * brouillon n'est pas lisible. La visibilité `public` s'y ajoute, une course
 * `unlisted` restant atteignable par lien direct mais jamais listable
 * (03_PRIVACY_RLS §17).
 */
export function isRacePubliclyReadable(
  race: RaceRecord,
  edition: EditionRecord,
  event: EventRecord,
): boolean {
  return (
    isPubliclyReadableStatus(race.status) &&
    race.publicVisibility === 'public' &&
    isEditionReadable(edition) &&
    isEventReadable(event)
  );
}

export type PublicationVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'event_not_published' | 'edition_not_published' | 'race_not_draft';
    };

/**
 * Conditions de publication d'une épreuve.
 *
 * Publier une Race sous une édition ou un événement non diffusés produirait
 * une course inatteignable : la lecture publique remonte toute la chaîne. La
 * transition part toujours de `draft` — les autres statuts ne sont pas des
 * états de travail.
 */
export function checkRacePublication(
  race: RaceRecord,
  edition: EditionRecord,
  event: EventRecord,
): PublicationVerdict {
  if (!isEventReadable(event)) return { ok: false, reason: 'event_not_published' };
  if (!isEditionReadable(edition)) return { ok: false, reason: 'edition_not_published' };
  if (race.status !== 'draft') return { ok: false, reason: 'race_not_draft' };

  return { ok: true };
}
