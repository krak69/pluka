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
 * Conditions d'un nouveau rattachement — 00_PRODUCT_SPEC §4.1.
 *
 * Le tableau des statuts ne décrit qu'une seule épreuve comme « visible et
 * **préparable** » : `published`. Une course en brouillon n'est pas lisible,
 * une course terminée ou archivée appartient au passé.
 *
 * `race_cancelled` est distingué volontairement. §4.1 laisse la question
 * ouverte :
 *
 * > « Point ouvert. Une course annulée reste-t-elle inscriptible ? La réponse
 * > évidente est non, mais le mécanisme d'inscription n'est pas encore
 * > spécifié — à trancher au lot B2B. »
 *
 * Le refus suit ici la réponse « évidente » du document, et il est isolé dans
 * sa propre branche : le jour où le lot B2B tranche, une seule ligne change,
 * et le test qui la couvre nomme la décision.
 *
 * Ce verdict ne porte que sur la *création*. Une participation existante n'est
 * jamais dégradée par une annulation : §4.1 est explicite — « les données
 * personnelles rattachées restent accessibles et modifiables ».
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
