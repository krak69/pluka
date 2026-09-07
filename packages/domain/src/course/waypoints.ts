import type { RaceCutoffRecord, RaceWaypointRecord, SetRaceWaypointsResult } from '@pluka/db';
import { z } from 'zod';

import { assertOrganizationRole } from '../authorization/organization-role.js';
import { parseCommand, validationError } from '../errors.js';
import type { CourseContext } from './use-cases.js';
import { loadRaceScope } from './use-cases.js';

/**
 * Référentiel de parcours d'une épreuve — PLAN_ENGINE §7, §8.1.
 *
 * Sans lui, le prétraitement s'arrête en `skipped` : le worker le dit
 * lui-même — « un GPX déposé avant ses waypoints est un ordre d'import
 * légitime […] le prétraitement reste `pending` et attend que quelqu'un le
 * relance ». Aucun micro-segment, donc aucun Plan.
 *
 * La chaîne se réécrit d'un bloc. Ce n'est pas une commodité d'écran : §7
 * exige que les waypoints soient ordonnés de façon monotone et que les
 * segments forment une chaîne cohérente. Ces deux propriétés portent sur
 * l'ensemble, pas sur une ligne — les valider ligne à ligne ne voudrait rien
 * dire, et les écrire ligne à ligne laisserait le référentiel incohérent entre
 * deux requêtes.
 *
 * Les segments ne sont pas saisis : ce sont les intervalles entre waypoints
 * consécutifs, et `set_race_waypoints` les dérive (migration 0025).
 */

/** Rôle minimum pour écrire du contenu de course, aligné sur `MIN_WRITE_ROLE`. */
const MIN_WAYPOINT_ROLE = 'editor';

/**
 * Types de waypoints proposés à la saisie.
 *
 * Sous-ensemble de l'enum `waypoint_type` : ceux qu'un référentiel de course
 * nomme couramment, et que 00_PRODUCT_SPEC cite. Les autres — `summit`,
 * `pass`, `water`, `other` — restent acceptés par la base, mais un écran qui
 * les proposerait tous ferait de la saisie un questionnaire.
 */
export const AUTHORED_WAYPOINT_TYPES = [
  'start',
  'aid_station',
  'assistance',
  'checkpoint',
  'cutoff',
  'finish',
] as const;

export type AuthoredWaypointType = (typeof AUTHORED_WAYPOINT_TYPES)[number];

const waypointSchema = z.object({
  /** Absent pour un waypoint ajouté : la base lui donnera son identité. */
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(200),
  waypointType: z.enum(AUTHORED_WAYPOINT_TYPES),
  /** Kilomètre annoncé par l'organisation. Le GPX mesuré peut en différer (§9). */
  distanceKm: z.number().min(0).max(1000),
  /** Barrière horaire, quand l'épreuve en pose une à ce point. */
  cutoffAt: z.iso.datetime({ offset: true }).nullable().default(null),
});

export type RaceWaypointCommandEntry = z.infer<typeof waypointSchema>;

export const setRaceWaypointsCommandSchema = z.object({
  raceId: z.uuid(),
  /**
   * Au moins un départ et une arrivée : `validateInput` du moteur refuse
   * `waypoints.length < 2`, et un parcours d'un seul point n'a aucun segment.
   */
  waypoints: z.array(waypointSchema).min(2, { error: 'un départ et une arrivée au minimum' }),
});

export type SetRaceWaypointsCommand = z.infer<typeof setRaceWaypointsCommandSchema>;

export const getRaceWaypointsQuerySchema = z.object({ raceId: z.uuid() });
export type GetRaceWaypointsQuery = z.infer<typeof getRaceWaypointsQuerySchema>;

/**
 * Cohérence de la chaîne — PLAN_ENGINE §7.4, §7.5.
 *
 * Fonction pure : elle rend un verdict, la traduction en refus appartient au
 * use case. Trois règles, et chacune vient d'une contrainte réelle :
 *
 * - les distances croissent strictement, parce qu'un segment a une longueur
 *   `> 0` et que deux waypoints au même kilomètre n'en délimitent aucun ;
 * - la chaîne commence par un départ et finit par une arrivée, parce que c'est
 *   ce que le Plan calcule — de l'un à l'autre ;
 * - un seul départ, une seule arrivée, pour la même raison.
 *
 * L'altitude, la latitude et la longitude n'y figurent pas : elles viennent du
 * GPX, que le prétraitement raccorde (§8.1, étape 9). Les faire saisir
 * doublerait une mesure.
 */
export type WaypointChainVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        | 'distance_not_increasing'
        | 'missing_start'
        | 'missing_finish'
        | 'duplicate_start'
        | 'duplicate_finish';
      /** Rang du waypoint fautif, quand la règle en désigne un. */
      readonly index?: number;
    };

export function checkWaypointChain(
  waypoints: readonly { readonly waypointType: string; readonly distanceKm: number }[],
): WaypointChainVerdict {
  for (let index = 1; index < waypoints.length; index += 1) {
    const previous = waypoints[index - 1];
    const current = waypoints[index];

    if (
      previous !== undefined &&
      current !== undefined &&
      current.distanceKm <= previous.distanceKm
    ) {
      return { ok: false, reason: 'distance_not_increasing', index };
    }
  }

  const starts = waypoints.filter((waypoint) => waypoint.waypointType === 'start');
  const finishes = waypoints.filter((waypoint) => waypoint.waypointType === 'finish');

  if (starts.length === 0) return { ok: false, reason: 'missing_start' };
  if (finishes.length === 0) return { ok: false, reason: 'missing_finish' };
  if (starts.length > 1) return { ok: false, reason: 'duplicate_start' };
  if (finishes.length > 1) return { ok: false, reason: 'duplicate_finish' };

  if (waypoints[0]?.waypointType !== 'start') return { ok: false, reason: 'missing_start' };
  if (waypoints[waypoints.length - 1]?.waypointType !== 'finish') {
    return { ok: false, reason: 'missing_finish' };
  }

  return { ok: true };
}

export interface RaceWaypointView extends RaceWaypointRecord {
  /** Barrière posée à ce point, quand il y en a une. */
  readonly cutoffAt: string | null;
}

/** Lecture du référentiel, tel qu'un écran de saisie le rouvre. */
export async function getRaceWaypoints(
  context: CourseContext,
  input: unknown,
): Promise<readonly RaceWaypointView[]> {
  const useCase = 'getRaceWaypoints';
  const query = parseCommand(getRaceWaypointsQuerySchema, input, useCase);

  const scope = await loadRaceScope(context.repositories, query.raceId, useCase);

  await assertOrganizationRole(
    context.repositories,
    context.actor,
    scope.event.organizationId,
    MIN_WAYPOINT_ROLE,
    useCase,
  );

  const [waypoints, cutoffs] = await Promise.all([
    context.repositories.waypoints.listByRace(query.raceId),
    context.repositories.waypoints.listCutoffsByRace(query.raceId),
  ]);

  return waypoints.map((waypoint) => ({
    ...waypoint,
    cutoffAt: cutoffAt(cutoffs, waypoint.id),
  }));
}

/**
 * Réécrit le référentiel, et demande la relance du prétraitement.
 *
 * L'ordre du tableau fait foi : c'est lui que l'écran manipule, et le rang en
 * base en découle. Personne ne saisit un `sortOrder` — ce serait une seconde
 * façon d'exprimer la même chose.
 */
export async function setRaceWaypoints(
  context: CourseContext,
  input: unknown,
): Promise<SetRaceWaypointsResult> {
  const useCase = 'setRaceWaypoints';
  const command = parseCommand(setRaceWaypointsCommandSchema, input, useCase);

  const scope = await loadRaceScope(context.repositories, command.raceId, useCase);

  await assertOrganizationRole(
    context.repositories,
    context.actor,
    scope.event.organizationId,
    MIN_WAYPOINT_ROLE,
    useCase,
  );

  const verdict = checkWaypointChain(command.waypoints);
  if (!verdict.ok) {
    throw validationError(useCase, chainMessage(verdict), chainDetails(verdict));
  }

  return context.repositories.waypoints.replace(command.raceId, command.waypoints);
}

function cutoffAt(cutoffs: readonly RaceCutoffRecord[], waypointId: string): string | null {
  return cutoffs.find((cutoff) => cutoff.raceWaypointId === waypointId)?.cutoffDatetime ?? null;
}

function chainMessage(verdict: Extract<WaypointChainVerdict, { ok: false }>): string {
  if (verdict.reason === 'distance_not_increasing') {
    return 'les kilomètres doivent croître le long du parcours';
  }
  if (verdict.reason === 'missing_start') return 'le parcours commence par un départ';
  if (verdict.reason === 'missing_finish') return 'le parcours finit par une arrivée';
  if (verdict.reason === 'duplicate_start') return 'un seul départ par parcours';

  return 'une seule arrivée par parcours';
}

/**
 * Champ auquel rattacher le refus.
 *
 * Le rang est celui du tableau : l'écran s'en sert pour poser le message
 * contre la ligne fautive plutôt qu'au bas du formulaire.
 */
function chainDetails(
  verdict: Extract<WaypointChainVerdict, { ok: false }>,
): Readonly<Record<string, string>> {
  if (verdict.index === undefined) return { waypoints: chainMessage(verdict) };

  return { [`waypoints.${verdict.index}.distanceKm`]: chainMessage(verdict) };
}
