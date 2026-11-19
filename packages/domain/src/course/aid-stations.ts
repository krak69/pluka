import type {
  AidItemKind,
  AidStationItemInput,
  AidStationItemRecord,
  AidStationRepository,
  CourseRepositories,
} from '@pluka/db';
import { z } from 'zod';

import { type Actor, assertOrganizationRole } from '../authorization/organization-role.js';
import { notFoundError, parseCommand } from '../errors.js';
import { loadRaceScope } from './use-cases.js';

/**
 * Contenu des ravitaillements — NUTRITION_ENGINE §31, §32 ; migration 0110 ;
 * décisions du 2026-11-19.
 *
 * L'organisation (dans /org) et l'équipe PLUKA (dans l'admin, d'après les
 * sources officielles) disent ce que propose chaque point. Rien n'est
 * supposé : un point sans contenu n'annonce rien. Le contenu se lit avec la
 * course, gratuitement, comme toute information officielle (AGENTS §22).
 */

export type AnnouncedAidKind = Exclude<AidItemKind, 'other'>;

/** Les genres proposés d'un clic, dans l'ordre d'affichage. */
export const ANNOUNCED_AID_KINDS: readonly AnnouncedAidKind[] = [
  'water',
  'sports_drink',
  'cola',
  'soup',
  'fruit',
  'sweet',
  'salty',
  'hot_meal',
];

/** L'intitulé enregistré pour un genre choisi d'un clic. */
export const AID_KIND_LABELS: Readonly<Record<AnnouncedAidKind, string>> = {
  water: 'Eau',
  sports_drink: 'Boisson d’effort',
  cola: 'Cola',
  soup: 'Soupe ou bouillon',
  fruit: 'Fruits',
  sweet: 'Sucré',
  salty: 'Salé',
  hot_meal: 'Repas chaud',
};

export interface AidStationContext {
  readonly repositories: CourseRepositories & { readonly aidStations: AidStationRepository };
  readonly actor: Actor;
}

const MIN_ROLE = 'editor';

const setCommand = z
  .object({
    raceId: z.uuid(),
    waypointId: z.uuid(),
    kinds: z.array(z.enum(ANNOUNCED_AID_KINDS as [AnnouncedAidKind, ...AnnouncedAidKind[]])).max(8),
    /** Ce qui n'entre dans aucun genre : « Pain d'épices », « Fromage »… */
    others: z.array(z.string().trim().max(80)).max(10).default([]),
  })
  .strict();

/** Les éléments à enregistrer : les genres dans l'ordre d'affichage, puis le reste. */
export function aidItemsOf(
  kinds: readonly AnnouncedAidKind[],
  others: readonly string[],
): AidStationItemInput[] {
  const seen = new Set<string>();
  const extra = others
    .map((label) => label.trim())
    .filter((label) => {
      const key = label.toLocaleLowerCase('fr-FR');
      if (label === '' || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return [
    ...ANNOUNCED_AID_KINDS.filter((kind) => kinds.includes(kind)).map((kind) => ({
      kind,
      label: AID_KIND_LABELS[kind],
    })),
    ...extra.map((label) => ({ kind: 'other' as const, label })),
  ];
}

/**
 * Ce que propose un point de la course — organisation éditrice ou
 * administration PLUKA. Vide, le point n'annonce plus rien.
 */
export async function setAidStationItems(
  context: AidStationContext,
  input: unknown,
): Promise<void> {
  const useCase = 'setAidStationItems';
  const command = parseCommand(setCommand, input, useCase);

  const scope = await loadRaceScope(context.repositories, command.raceId, useCase);
  await assertOrganizationRole(
    context.repositories,
    context.actor,
    scope.event.organizationId,
    MIN_ROLE,
    useCase,
  );

  const waypoints = await context.repositories.waypoints.listByRace(command.raceId);
  if (!waypoints.some((waypoint) => waypoint.id === command.waypointId)) {
    throw notFoundError(useCase, 'point');
  }

  await context.repositories.aidStations.setForWaypoint(
    command.waypointId,
    aidItemsOf(command.kinds, command.others),
  );
}

const listQuery = z.object({ raceId: z.uuid() }).strict();

/** Ce que proposent les points d'une course — lecture publique, comme la course. */
export async function listAidStationItems(
  context: AidStationContext,
  input: unknown,
): Promise<readonly AidStationItemRecord[]> {
  const { raceId } = parseCommand(listQuery, input, 'listAidStationItems');
  return context.repositories.aidStations.listByRace(raceId);
}
