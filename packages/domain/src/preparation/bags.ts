import { z } from 'zod';

import type {
  BagRecord,
  BagRepositories,
  BagType,
  CourseWaypointRecord,
  EntitlementRepositories,
  LibraryRepositories,
  ParticipantRaceSettingsRecord,
  PreparationRepositories,
  PublishedFactRepository,
  RaceWaypointRepository,
} from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import type { Capability } from '../entitlements/capabilities.js';
import { can } from '../entitlements/resolver.js';
import { authorizeCapability, resolveEntitlements } from '../entitlements/use-cases.js';
import { notFoundError, parseCommand, validationError } from '../errors.js';
import { cleanLabels, labelKey } from '../library/equipment-library.js';

/**
 * Sacs de la Préparation — 00_PRODUCT_SPEC §14.4 ; 04_ENTITLEMENTS §45 ;
 * migrations 0094, 0095.
 *
 * L'onglet s'ouvre vide. PLUKA suggère les sacs que la course appelle — départ,
 * drop bags aux points où l'organisation les accepte, assistance aux points
 * d'assistance, arrivée — et le coureur les accepte d'un clic ou les écarte
 * (décisions produit du 2026-11-16). Aucune IA : les suggestions se déduisent
 * du parcours publié, par `suggestBags`, fonction pure.
 *
 * Droits : lire ses sacs est du socle (`preparation.read`) — un Race Pass
 * expiré ne reprend pas la vue de ce que le coureur a écrit (04 §57). Créer,
 * remplir, cocher et écarter sont de la préparation avancée
 * (`preparation.edit_advanced`, Race Pass), revérifiée à chaque écriture.
 *
 * Les coches d'un sac sont indépendantes de la checklist de matériel : « prêt »
 * dans la checklist dit « je l'ai », coché dans un sac dit « il est dedans ».
 */

export interface BagsContext {
  readonly repositories: BagRepositories &
    PreparationRepositories &
    LibraryRepositories &
    EntitlementRepositories & {
      readonly publishedFacts: PublishedFactRepository;
      readonly waypoints: RaceWaypointRepository;
    };
  readonly actor: Actor;
  /** Horloge serveur, transmise au service de droits (04_ENTITLEMENTS §22). */
  readonly now: () => Date;
  readonly disabledCapabilities?: ReadonlySet<Capability>;
}

export type SuggestedBagType = Exclude<BagType, 'other'>;

export interface BagPoint {
  readonly id: string;
  readonly name: string;
  readonly distanceKm: number;
}

export interface BagSuggestion {
  /** `start`, `finish`, `drop_bag:<point>`, `assistance:<point>` — ce que « Pas besoin » retient. */
  readonly key: string;
  readonly bagType: SuggestedBagType;
  readonly name: string;
  readonly point: BagPoint | null;
}

export interface BagItemView {
  readonly id: string;
  readonly label: string;
  readonly quantity: number;
  readonly checked: boolean;
}

export interface BagView {
  readonly id: string;
  readonly bagType: BagType;
  readonly name: string;
  readonly point: BagPoint | null;
  /**
   * Ce qui a changé côté organisation depuis que le sac existe : le point a
   * été retiré du parcours, ou n'accepte plus de drop bag. Le sac reste ; l'écran
   * le signale.
   */
  readonly pointIssue: 'removed' | 'drop_bag_withdrawn' | null;
  readonly items: readonly BagItemView[];
  readonly checkedCount: number;
  /** Prêt : au moins un contenu, tout coché. */
  readonly ready: boolean;
  /** Ce qu'on peut y mettre d'un clic : checklist et « Mon matériel », hors ce qu'il contient. */
  readonly picks: readonly string[];
}

export interface OfficialBagNote {
  readonly factId: string;
  readonly text: string;
}

export interface BagsOverview {
  readonly bags: readonly BagView[];
  readonly ready: { readonly ready: number; readonly total: number };
  readonly suggestions: readonly BagSuggestion[];
  /** Suggestions écartées : de quoi proposer « Réafficher ». */
  readonly dismissedCount: number;
  /** Les consignes officielles sur les sacs, gratuites (AGENTS §22). */
  readonly officialNotes: readonly OfficialBagNote[];
  /** Les points où rattacher un nouveau sac à la main. */
  readonly dropBagPoints: readonly BagPoint[];
  readonly assistancePoints: readonly BagPoint[];
  /** Créer, remplir, cocher : Race Pass. */
  readonly canEdit: boolean;
}

const NAME_MAX = 80;

const BAG_NAMES: Readonly<Record<SuggestedBagType, (point: string | null) => string>> = {
  start: () => 'Sac de départ',
  finish: () => 'Sac d’arrivée',
  drop_bag: (point) => `Drop bag · ${point ?? ''}`,
  assistance: (point) => `Sac d’assistance · ${point ?? ''}`,
};

function bagName(bagType: SuggestedBagType, point: string | null): string {
  return BAG_NAMES[bagType](point).slice(0, NAME_MAX).trim();
}

/** La clé d'une suggestion : le rôle du sac, et son point quand il en a un. */
export function suggestionKey(bagType: SuggestedBagType, pointId: string | null): string {
  return pointId === null ? bagType : `${bagType}:${pointId}`;
}

function pointOf(waypoint: CourseWaypointRecord): BagPoint {
  return { id: waypoint.id, name: waypoint.name, distanceKm: waypoint.distanceKm };
}

function byKm(left: CourseWaypointRecord, right: CourseWaypointRecord): number {
  return left.distanceKm - right.distanceKm;
}

/** Les points d'un drop bag : ceux que l'organisation a cochés (0094). */
function dropBagWaypoints(waypoints: readonly CourseWaypointRecord[]) {
  return waypoints.filter((waypoint) => waypoint.dropBagAllowed).sort(byKm);
}

/** Les points d'assistance du parcours (« Base de vie » à la saisie). */
function assistanceWaypoints(waypoints: readonly CourseWaypointRecord[]) {
  return waypoints.filter((waypoint) => waypoint.waypointType === 'assistance').sort(byKm);
}

export interface SuggestBagsInput {
  readonly waypoints: readonly CourseWaypointRecord[];
  /** « Autonome » : le coureur a dit qu'il n'aurait pas d'assistance. */
  readonly assistanceStatus: ParticipantRaceSettingsRecord['assistanceStatus'] | null;
  readonly bags: readonly Pick<BagRecord, 'bagType' | 'raceWaypointId'>[];
  readonly dismissed: ReadonlySet<string>;
}

/**
 * Les sacs que la course appelle, et que le coureur n'a ni créés ni écartés.
 *
 * Dans l'ordre de la course : départ, drop bags et sacs d'assistance au fil
 * des kilomètres, arrivée. Fonction pure (AGENTS §11).
 */
export function suggestBags(input: SuggestBagsInput): readonly BagSuggestion[] {
  const existing = new Set(
    input.bags
      .filter((bag) => bag.bagType !== 'other')
      .map((bag) => suggestionKey(bag.bagType as SuggestedBagType, bag.raceWaypointId)),
  );

  const along = [
    ...dropBagWaypoints(input.waypoints).map((waypoint) => ({
      bagType: 'drop_bag' as const,
      waypoint,
    })),
    ...(input.assistanceStatus === 'autonomous'
      ? []
      : assistanceWaypoints(input.waypoints).map((waypoint) => ({
          bagType: 'assistance' as const,
          waypoint,
        }))),
  ].sort((left, right) => byKm(left.waypoint, right.waypoint));

  const candidates: BagSuggestion[] = [
    { key: 'start', bagType: 'start', name: bagName('start', null), point: null },
    ...along.map(({ bagType, waypoint }) => ({
      key: suggestionKey(bagType, waypoint.id),
      bagType,
      name: bagName(bagType, waypoint.name),
      point: pointOf(waypoint),
    })),
    { key: 'finish', bagType: 'finish', name: bagName('finish', null), point: null },
  ];

  return candidates.filter(
    (candidate) => !existing.has(candidate.key) && !input.dismissed.has(candidate.key),
  );
}

// ------------------------------------------------------------
// Commandes
// ------------------------------------------------------------

const participation = z.object({ participantRaceId: z.uuid() }).strict();

const name = z.string().trim().min(1).max(NAME_MAX);

const createCommand = z
  .object({
    participantRaceId: z.uuid(),
    bagType: z.enum(['start', 'drop_bag', 'assistance', 'finish', 'other']),
    pointId: z.uuid().nullable().default(null),
    /** Imposé pour un sac « autre » ; sinon déduit du rôle et du point. */
    name: name.optional(),
  })
  .strict();

const bagCommand = z.object({ participantRaceId: z.uuid(), bagId: z.uuid() }).strict();

const renameCommand = z.object({ participantRaceId: z.uuid(), bagId: z.uuid(), name }).strict();

const addItemsCommand = z
  .object({
    participantRaceId: z.uuid(),
    bagId: z.uuid(),
    labels: z.array(z.string().max(120)).min(1).max(50),
    quantity: z.number().int().min(1).max(99).default(1),
  })
  .strict();

const itemCommand = z
  .object({ participantRaceId: z.uuid(), bagId: z.uuid(), itemId: z.uuid() })
  .strict();

const checkCommand = itemCommand.extend({ checked: z.boolean() }).strict();

const dismissCommand = z
  .object({
    participantRaceId: z.uuid(),
    key: z
      .string()
      .regex(
        /^(start|finish|(drop_bag|assistance):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u,
      ),
  })
  .strict();

// ------------------------------------------------------------
// Lecture
// ------------------------------------------------------------

function serviceContext(context: BagsContext) {
  return {
    repositories: context.repositories,
    actor: context.actor,
    now: context.now,
    ...(context.disabledCapabilities === undefined
      ? {}
      : { disabledCapabilities: context.disabledCapabilities }),
  };
}

async function authorize(
  context: BagsContext,
  capability: Capability,
  participantRaceId: string,
): Promise<void> {
  await authorizeCapability(serviceContext(context), { capability, participantRaceId });
}

async function raceIdOf(
  context: BagsContext,
  participantRaceId: string,
  useCase: string,
): Promise<string> {
  const record = await context.repositories.participantRaces.findById(participantRaceId);
  if (record === null) throw notFoundError(useCase, 'participation');
  return record.raceId;
}

/** Ce qu'on peut mettre dans un sac : la checklist de la course, puis « Mon matériel ». */
async function pickableLabels(
  context: BagsContext,
  participantRaceId: string,
  raceId: string,
): Promise<readonly string[]> {
  const [facts, rows, library] = await Promise.all([
    context.repositories.publishedFacts.listPublishedByRace(raceId),
    context.repositories.preparation.listEquipment(participantRaceId),
    context.repositories.library.listEquipment(context.actor.userId),
  ]);

  return cleanLabels([
    ...facts
      .filter((fact) => fact.category === 'equipment' && fact.valueText !== null)
      .map((fact) => fact.valueText as string),
    ...rows
      .filter((row) => row.origin === 'personal' && row.customLabel !== null)
      .map((row) => row.customLabel as string),
    ...library.map((item) => item.label),
  ]);
}

function viewOf(
  bag: BagRecord,
  waypoints: ReadonlyMap<string, CourseWaypointRecord>,
  picks: readonly string[],
): BagView {
  const waypoint = bag.raceWaypointId === null ? undefined : waypoints.get(bag.raceWaypointId);
  const wantsPoint = bag.bagType === 'drop_bag' || bag.bagType === 'assistance';
  const inside = new Set(bag.items.map((item) => labelKey(item.label)));
  const checkedCount = bag.items.filter((item) => item.checked).length;

  return {
    id: bag.id,
    bagType: bag.bagType,
    name: bag.name,
    point: waypoint === undefined ? null : pointOf(waypoint),
    pointIssue:
      wantsPoint && waypoint === undefined
        ? 'removed'
        : bag.bagType === 'drop_bag' && waypoint !== undefined && !waypoint.dropBagAllowed
          ? 'drop_bag_withdrawn'
          : null,
    items: bag.items,
    checkedCount,
    ready: bag.items.length > 0 && checkedCount === bag.items.length,
    picks: picks.filter((label) => !inside.has(labelKey(label))),
  };
}

/** Les sacs d'une participation, les suggestions qui restent, et les consignes officielles. */
export async function getBags(context: BagsContext, input: unknown): Promise<BagsOverview> {
  const useCase = 'getBags';
  const { participantRaceId } = parseCommand(participation, input, useCase);

  await authorize(context, 'preparation.read', participantRaceId);

  const raceId = await raceIdOf(context, participantRaceId, useCase);
  const [bags, waypoints, settings, dismissed, facts, entitlements, picks] = await Promise.all([
    context.repositories.bags.listBags(participantRaceId),
    context.repositories.waypoints.listByRace(raceId),
    context.repositories.participantRaceSettings.findByParticipantRace(participantRaceId),
    context.repositories.bags.listDismissedSuggestions(participantRaceId),
    context.repositories.publishedFacts.listPublishedByRace(raceId),
    resolveEntitlements(serviceContext(context), { participantRaceId }),
    pickableLabels(context, participantRaceId, raceId),
  ]);

  const byId = new Map(waypoints.map((waypoint) => [waypoint.id, waypoint]));
  const views = bags.map((bag) => viewOf(bag, byId, picks));
  const dismissedKeys = new Set(dismissed);
  const suggestions = suggestBags({
    waypoints,
    assistanceStatus: settings?.assistanceStatus ?? null,
    bags,
    dismissed: dismissedKeys,
  });
  const reachable = new Set(
    suggestBags({
      waypoints,
      assistanceStatus: settings?.assistanceStatus ?? null,
      bags,
      dismissed: new Set(),
    }).map((suggestion) => suggestion.key),
  );

  return {
    bags: views,
    ready: { ready: views.filter((bag) => bag.ready).length, total: views.length },
    suggestions,
    // Une clé écartée dont le sac a depuis été créé, ou dont le point a
    // disparu, n'a plus rien à réafficher.
    dismissedCount: dismissed.filter((key) => reachable.has(key)).length,
    officialNotes: facts
      .filter((fact) => fact.category === 'bag' && fact.valueText !== null)
      .map((fact) => ({ factId: fact.factId, text: fact.valueText as string })),
    dropBagPoints: dropBagWaypoints(waypoints).map(pointOf),
    assistancePoints: assistanceWaypoints(waypoints).map(pointOf),
    canEdit: can(entitlements, 'preparation.edit_advanced').allowed,
  };
}

// ------------------------------------------------------------
// Écritures — Race Pass
// ------------------------------------------------------------

async function ownedBag(
  context: BagsContext,
  participantRaceId: string,
  bagId: string,
  useCase: string,
): Promise<BagRecord> {
  // La RLS borne déjà les sacs au coureur ; la participation borne aussi le
  // geste : un sac d'une autre de ses courses n'est pas touché d'ici.
  const bags = await context.repositories.bags.listBags(participantRaceId);
  const bag = bags.find((candidate) => candidate.id === bagId);
  if (bag === undefined) throw notFoundError(useCase, 'sac');
  return bag;
}

/**
 * Crée un sac — une suggestion acceptée, ou un sac ajouté à la main.
 *
 * Le point est vérifié ici pour répondre clairement, et revérifié par la base
 * (0095). Accepter deux fois la même suggestion ne crée qu'un sac.
 */
export async function createBag(context: BagsContext, input: unknown): Promise<void> {
  const useCase = 'createBag';
  const command = parseCommand(createCommand, input, useCase);
  await authorize(context, 'preparation.edit_advanced', command.participantRaceId);

  if (command.bagType === 'other') {
    if (command.name === undefined) {
      throw validationError(useCase, 'donne un nom à ce sac', { name: 'donne un nom à ce sac' });
    }
    await context.repositories.bags.createBag(command.participantRaceId, {
      bagType: 'other',
      name: command.name,
      raceWaypointId: null,
    });
    return;
  }

  const bagType = command.bagType;

  if (bagType === 'start' || bagType === 'finish') {
    await context.repositories.bags.createBag(command.participantRaceId, {
      bagType,
      name: command.name ?? bagName(bagType, null),
      raceWaypointId: null,
    });
    return;
  }

  const raceId = await raceIdOf(context, command.participantRaceId, useCase);
  const waypoints = await context.repositories.waypoints.listByRace(raceId);
  const allowed =
    bagType === 'drop_bag' ? dropBagWaypoints(waypoints) : assistanceWaypoints(waypoints);
  const waypoint = allowed.find((candidate) => candidate.id === command.pointId);

  if (waypoint === undefined) {
    const message =
      bagType === 'drop_bag'
        ? 'choisis un point où l’organisation accepte un drop bag'
        : 'choisis un point d’assistance du parcours';
    throw validationError(useCase, message, { pointId: message });
  }

  await context.repositories.bags.createBag(command.participantRaceId, {
    bagType,
    name: command.name ?? bagName(bagType, waypoint.name),
    raceWaypointId: waypoint.id,
  });
}

export async function renameBag(context: BagsContext, input: unknown): Promise<void> {
  const useCase = 'renameBag';
  const command = parseCommand(renameCommand, input, useCase);
  await authorize(context, 'preparation.edit_advanced', command.participantRaceId);
  await ownedBag(context, command.participantRaceId, command.bagId, useCase);
  await context.repositories.bags.renameBag(command.participantRaceId, command.bagId, command.name);
}

/** Supprime un sac et son contenu. Sa suggestion revient : le sac n'existe plus. */
export async function deleteBag(context: BagsContext, input: unknown): Promise<void> {
  const useCase = 'deleteBag';
  const command = parseCommand(bagCommand, input, useCase);
  await authorize(context, 'preparation.edit_advanced', command.participantRaceId);
  await ownedBag(context, command.participantRaceId, command.bagId, useCase);
  await context.repositories.bags.deleteBag(command.participantRaceId, command.bagId);
}

/**
 * Met des éléments dans un sac : un intitulé tapé, ou repris de la checklist
 * et de « Mon matériel » — copié, sans lien (0095). Ce qui y est déjà est
 * ignoré. Rend le nombre d'éléments ajoutés.
 */
export async function addBagItems(context: BagsContext, input: unknown): Promise<number> {
  const useCase = 'addBagItems';
  const command = parseCommand(addItemsCommand, input, useCase);
  await authorize(context, 'preparation.edit_advanced', command.participantRaceId);

  const bag = await ownedBag(context, command.participantRaceId, command.bagId, useCase);
  const inside = new Set(bag.items.map((item) => labelKey(item.label)));
  const labels = cleanLabels(command.labels).filter((label) => !inside.has(labelKey(label)));

  if (labels.length === 0 && cleanLabels(command.labels).length === 0) {
    throw validationError(useCase, 'écris ce que tu mets dans ce sac', {
      label: 'écris ce que tu mets dans ce sac',
    });
  }

  await context.repositories.bags.addItems(
    command.bagId,
    labels.map((label) => ({ label, quantity: command.quantity })),
  );
  return labels.length;
}

export async function setBagItemChecked(context: BagsContext, input: unknown): Promise<void> {
  const useCase = 'setBagItemChecked';
  const command = parseCommand(checkCommand, input, useCase);
  await authorize(context, 'preparation.edit_advanced', command.participantRaceId);

  const bag = await ownedBag(context, command.participantRaceId, command.bagId, useCase);
  if (!bag.items.some((item) => item.id === command.itemId))
    throw notFoundError(useCase, 'élément');

  await context.repositories.bags.setItemChecked(command.bagId, command.itemId, command.checked);
}

export async function removeBagItem(context: BagsContext, input: unknown): Promise<void> {
  const useCase = 'removeBagItem';
  const command = parseCommand(itemCommand, input, useCase);
  await authorize(context, 'preparation.edit_advanced', command.participantRaceId);
  await ownedBag(context, command.participantRaceId, command.bagId, useCase);
  await context.repositories.bags.removeItem(command.bagId, command.itemId);
}

/** « Pas besoin » : la suggestion ne revient plus pour cette course. */
export async function dismissBagSuggestion(context: BagsContext, input: unknown): Promise<void> {
  const command = parseCommand(dismissCommand, input, 'dismissBagSuggestion');
  await authorize(context, 'preparation.edit_advanced', command.participantRaceId);
  await context.repositories.bags.dismissSuggestion(command.participantRaceId, command.key);
}

/** « Réafficher » : toutes les suggestions écartées reviennent. */
export async function restoreBagSuggestions(context: BagsContext, input: unknown): Promise<void> {
  const { participantRaceId } = parseCommand(participation, input, 'restoreBagSuggestions');
  await authorize(context, 'preparation.edit_advanced', participantRaceId);
  await context.repositories.bags.restoreSuggestions(participantRaceId);
}
