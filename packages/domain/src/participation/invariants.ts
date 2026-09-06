import type { EditionRecord, EventRecord, RaceRecord } from '@pluka/db';

import { isEditionReadable, isEventReadable } from '../course/invariants.js';
import { isPubliclyReadableStatus } from '../course/lifecycle.js';

/**
 * Invariants du rattachement d'un coureur à une course.
 *
 * Fonctions pures : mêmes entrées, mêmes sorties, aucune I/O, aucune horloge
 * implicite. Elles rendent un verdict ; la traduction en erreur appartient aux
 * use cases.
 */

/**
 * Une course qu'un coureur peut atteindre de lui-même.
 *
 * `public` est listable, `unlisted` accessible par lien direct ou invitation
 * (03_PRIVACY_RLS §17). `private` ne l'est pas : les participations d'une
 * course privée naissent d'un import ou d'une invitation organisateur, jamais
 * d'un rattachement spontané.
 */
const REACHABLE_VISIBILITIES: readonly RaceRecord['publicVisibility'][] = ['public', 'unlisted'];

export function isRaceReachableByRunner(
  race: RaceRecord,
  edition: EditionRecord,
  event: EventRecord,
): boolean {
  return (
    isPubliclyReadableStatus(race.status) &&
    REACHABLE_VISIBILITIES.includes(race.publicVisibility) &&
    isEditionReadable(edition) &&
    isEventReadable(event)
  );
}

export type AttachmentVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'race_unreachable' | 'race_cancelled' | 'race_not_open';
    };

/**
 * Conditions d'une **nouvelle** participation — 00_PRODUCT_SPEC §4.1,
 * 02_DATA_MODEL §9.4.
 *
 * Le tableau des statuts ne décrit qu'une seule épreuve comme « visible et
 * **préparable** » : `published`. Une course en brouillon n'est pas lisible,
 * une course terminée ou archivée appartient au passé.
 *
 * « Une course `cancelled` n'accepte aucune nouvelle participation. » Le refus
 * garde sa propre branche parce qu'il mérite son propre message : une course
 * annulée est visible, et répondre « n'accepte pas de rattachement » sans dire
 * pourquoi laisserait le coureur chercher.
 *
 * Ce verdict ne gouverne que la création. Il n'est jamais consulté par
 * `claimParticipantRace` : §9.4 autorise explicitement la réclamation d'une
 * invitation envoyée avant l'annulation, et §4.1 protège l'accès du coureur à
 * sa propre préparation.
 */
export function checkRaceAttachment(
  race: RaceRecord,
  edition: EditionRecord,
  event: EventRecord,
): AttachmentVerdict {
  if (!isRaceReachableByRunner(race, edition, event)) {
    return { ok: false, reason: 'race_unreachable' };
  }

  if (race.status === 'cancelled') return { ok: false, reason: 'race_cancelled' };
  if (race.status !== 'published') return { ok: false, reason: 'race_not_open' };

  return { ok: true };
}
