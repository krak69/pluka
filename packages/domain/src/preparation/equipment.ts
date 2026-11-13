import { z } from 'zod';

import type {
  EntitlementRepositories,
  EquipmentRequirement,
  LibraryRepositories,
  ParticipantEquipmentRecord,
  PreparationRepositories,
  PublishedFactRepository,
  PublishedRaceFactRecord,
} from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import type { Capability } from '../entitlements/capabilities.js';
import { can } from '../entitlements/resolver.js';
import { authorizeCapability, resolveEntitlements } from '../entitlements/use-cases.js';
import { notFoundError, parseCommand } from '../errors.js';
import { equipmentValueOf } from '../facts/equipment.js';
import { cleanLabels, labelKey } from '../library/equipment-library.js';

/**
 * Checklist de matériel — 00_PRODUCT_SPEC §14.1, §14.2 ; 04_ENTITLEMENTS §45,
 * §57 ; migration 0091.
 *
 * Deux listes, jamais confondues (§14.1 : le matériel officiel « doit être
 * distingué visuellement de toute suggestion ») :
 *
 * - le matériel de l'organisation — obligatoire, conditionnel, recommandé —
 *   lu dans les informations publiées de la course, avec son exigence telle
 *   que la source la dit ;
 * - le matériel personnel du coureur, un intitulé libre.
 *
 * Droits : cocher le matériel de l'organisation appartient au socle gratuit
 * (`course.mandatory_equipment.read`, décision produit du 2026-11-13) — c'est
 * de la sécurité. Le matériel personnel est de la préparation avancée
 * (`preparation.edit_advanced`, Race Pass). Le droit est revérifié à chaque
 * écriture, côté serveur (§5, principe 13).
 *
 * « Prêt » est le seul état : coché, la pièce est dans le sac.
 */

export interface PreparationContext {
  readonly repositories: PreparationRepositories &
    LibraryRepositories &
    EntitlementRepositories & { readonly publishedFacts: PublishedFactRepository };
  readonly actor: Actor;
  /** Horloge serveur, transmise au service de droits (04_ENTITLEMENTS §22). */
  readonly now: () => Date;
  readonly disabledCapabilities?: ReadonlySet<Capability>;
}

/** Une pièce de matériel de l'organisation, avec son état pour ce coureur. */
export interface OfficialEquipmentItem {
  readonly raceFactId: string;
  readonly label: string;
  /** Nul : la source ne précise pas l'exigence — jamais lu comme obligatoire. */
  readonly requirement: EquipmentRequirement | null;
  readonly condition: string | null;
  readonly detail: string | null;
  readonly ready: boolean;
}

export interface PersonalEquipmentItem {
  readonly id: string;
  readonly label: string;
  readonly ready: boolean;
}

export interface EquipmentChecklist {
  readonly official: readonly OfficialEquipmentItem[];
  readonly personal: readonly PersonalEquipmentItem[];
  /** La jauge « prêts » : le matériel obligatoire seul. */
  readonly mandatory: { readonly ready: number; readonly total: number };
  /** Peut ajouter, cocher et retirer du matériel personnel (Race Pass). */
  readonly canEditPersonal: boolean;
  /**
   * « Mon matériel » qui n'est pas encore dans cette course, à ajouter d'un
   * clic. Gratuit à lire : un PLUKA+ expiré garde son matériel.
   */
  readonly fromLibrary: readonly { readonly id: string; readonly label: string }[];
  /** Une pièce saisie ici rejoint aussi « Mon matériel » (PLUKA+, `library.edit`). */
  readonly savesToLibrary: boolean;
}

const participation = z.object({ participantRaceId: z.uuid() }).strict();

const setOfficialCommand = z
  .object({ participantRaceId: z.uuid(), raceFactId: z.uuid(), ready: z.boolean() })
  .strict();

const addPersonalCommand = z
  .object({
    participantRaceId: z.uuid(),
    label: z.string().trim().min(1).max(120),
    // Le coureur choisit de garder la pièce dans « Mon matériel » (coché par défaut).
    saveToLibrary: z.boolean().default(true),
  })
  .strict();

const setPersonalCommand = z
  .object({ participantRaceId: z.uuid(), equipmentId: z.uuid(), ready: z.boolean() })
  .strict();

const addFromLibraryCommand = z
  .object({ participantRaceId: z.uuid(), itemIds: z.array(z.uuid()).min(1).max(100) })
  .strict();

const removePersonalCommand = z
  .object({ participantRaceId: z.uuid(), equipmentId: z.uuid() })
  .strict();

/** Ordre de lecture : ce qui empêche de partir d'abord. */
const REQUIREMENT_ORDER: Readonly<Record<string, number>> = {
  mandatory: 0,
  conditional: 1,
  recommended: 2,
  unknown: 3,
};

function serviceContext(context: PreparationContext) {
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
  context: PreparationContext,
  capability: Capability,
  participantRaceId: string,
): Promise<void> {
  await authorizeCapability(serviceContext(context), { capability, participantRaceId });
}

async function raceIdOf(
  context: PreparationContext,
  participantRaceId: string,
  useCase: string,
): Promise<string> {
  const participationRecord =
    await context.repositories.participantRaces.findById(participantRaceId);
  if (participationRecord === null) throw notFoundError(useCase, 'participation');
  return participationRecord.raceId;
}

function officialItems(
  facts: readonly PublishedRaceFactRecord[],
  rows: readonly ParticipantEquipmentRecord[],
): readonly OfficialEquipmentItem[] {
  const readyByFact = new Map(
    rows
      .filter((row) => row.raceFactId !== null)
      .map((row) => [row.raceFactId as string, row.ready]),
  );

  return facts
    .filter((fact) => fact.category === 'equipment')
    .map((fact) => {
      const value = equipmentValueOf(fact.valueJson);
      return {
        raceFactId: fact.factId,
        label: fact.valueText ?? '',
        requirement: value.requirement,
        condition: value.condition,
        detail: value.detail,
        ready: readyByFact.get(fact.factId) ?? false,
      };
    })
    .sort(
      (left, right) =>
        (REQUIREMENT_ORDER[left.requirement ?? 'unknown'] ?? 3) -
          (REQUIREMENT_ORDER[right.requirement ?? 'unknown'] ?? 3) ||
        left.label.localeCompare(right.label, 'fr'),
    );
}

/** La checklist d'une participation : le matériel de l'organisation, puis le sien. */
export async function getEquipmentChecklist(
  context: PreparationContext,
  input: unknown,
): Promise<EquipmentChecklist> {
  const useCase = 'getEquipmentChecklist';
  const { participantRaceId } = parseCommand(participation, input, useCase);

  // La lecture est gratuite ; la garde vérifie d'abord la propriété.
  await authorize(context, 'course.mandatory_equipment.read', participantRaceId);

  const raceId = await raceIdOf(context, participantRaceId, useCase);
  const [facts, rows, entitlements, library] = await Promise.all([
    context.repositories.publishedFacts.listPublishedByRace(raceId),
    context.repositories.preparation.listEquipment(participantRaceId),
    resolveEntitlements(serviceContext(context), { participantRaceId }),
    context.repositories.library.listEquipment(context.actor.userId),
  ]);

  const official = officialItems(facts, rows);
  const mandatory = official.filter((item) => item.requirement === 'mandatory');
  const personal = rows
    .filter((row) => row.origin === 'personal' && row.customLabel !== null)
    .map((row) => ({ id: row.id, label: row.customLabel as string, ready: row.ready }));
  const taken = new Set([...official, ...personal].map((item) => labelKey(item.label)));

  return {
    official,
    personal,
    mandatory: {
      ready: mandatory.filter((item) => item.ready).length,
      total: mandatory.length,
    },
    canEditPersonal: can(entitlements, 'preparation.edit_advanced').allowed,
    fromLibrary: library.filter((item) => !taken.has(labelKey(item.label))),
    savesToLibrary: can(entitlements, 'library.edit').allowed,
  };
}

/** Coche ou décoche une pièce du matériel de l'organisation. Gratuit. */
export async function setOfficialEquipmentReady(
  context: PreparationContext,
  input: unknown,
): Promise<void> {
  const useCase = 'setOfficialEquipmentReady';
  const command = parseCommand(setOfficialCommand, input, useCase);

  await authorize(context, 'course.mandatory_equipment.read', command.participantRaceId);

  // La pièce doit être du matériel publié de cette course : la base le
  // revérifie (0091), le domaine répond « introuvable » plutôt qu'une erreur.
  const raceId = await raceIdOf(context, command.participantRaceId, useCase);
  const facts = await context.repositories.publishedFacts.listPublishedByRace(raceId);
  const known = facts.some(
    (fact) => fact.factId === command.raceFactId && fact.category === 'equipment',
  );
  if (!known) throw notFoundError(useCase, 'matériel');

  await context.repositories.preparation.setOfficialEquipment(
    command.participantRaceId,
    command.raceFactId,
    command.ready ? 'ready' : 'not_ready',
  );
}

/** Ajoute une pièce personnelle. Race Pass ; avec PLUKA+, elle rejoint aussi « Mon matériel ». */
export async function addPersonalEquipment(
  context: PreparationContext,
  input: unknown,
): Promise<void> {
  const command = parseCommand(addPersonalCommand, input, 'addPersonalEquipment');
  await authorize(context, 'preparation.edit_advanced', command.participantRaceId);
  await context.repositories.preparation.addPersonalEquipment(
    command.participantRaceId,
    command.label,
  );

  // Avec PLUKA+, la pièce rejoint aussi « Mon matériel » si le coureur le
  // laisse coché : on ne la retapera plus (décisions produit du 2026-11-13).
  // Sans ce droit, elle reste à la course.
  if (!command.saveToLibrary) return;
  const entitlements = await resolveEntitlements(serviceContext(context), {
    participantRaceId: command.participantRaceId,
  });
  if (can(entitlements, 'library.edit').allowed) {
    await context.repositories.library.addEquipment(context.actor.userId, [command.label]);
  }
}

/** Coche ou décoche une pièce personnelle. Race Pass. */
export async function setPersonalEquipmentReady(
  context: PreparationContext,
  input: unknown,
): Promise<void> {
  const command = parseCommand(setPersonalCommand, input, 'setPersonalEquipmentReady');
  await authorize(context, 'preparation.edit_advanced', command.participantRaceId);
  await context.repositories.preparation.setPersonalEquipment(
    command.participantRaceId,
    command.equipmentId,
    command.ready ? 'ready' : 'not_ready',
  );
}

/** Retire une pièce personnelle. Race Pass. */
export async function removePersonalEquipment(
  context: PreparationContext,
  input: unknown,
): Promise<void> {
  const command = parseCommand(removePersonalCommand, input, 'removePersonalEquipment');
  await authorize(context, 'preparation.edit_advanced', command.participantRaceId);
  await context.repositories.preparation.removePersonalEquipment(
    command.participantRaceId,
    command.equipmentId,
  );
}

/** Les intitulés déjà présents dans la checklist, pour ne pas les dupliquer (§14.3). */
async function takenLabels(
  context: PreparationContext,
  participantRaceId: string,
  raceId: string,
): Promise<ReadonlySet<string>> {
  const [facts, rows] = await Promise.all([
    context.repositories.publishedFacts.listPublishedByRace(raceId),
    context.repositories.preparation.listEquipment(participantRaceId),
  ]);
  return new Set(
    [
      ...facts
        .filter((fact) => fact.category === 'equipment' && fact.valueText !== null)
        .map((fact) => fact.valueText as string),
      ...rows
        .filter((row) => row.origin === 'personal' && row.customLabel !== null)
        .map((row) => row.customLabel as string),
    ].map(labelKey),
  );
}

/**
 * Ajoute à la course des pièces de « Mon matériel », d'un clic — sans rien
 * retaper (décision produit du 2026-11-13). Une copie : retirer la pièce de la
 * course ne la retire pas de la bibliothèque. Les pièces déjà présentes sont
 * ignorées. Rend le nombre de pièces ajoutées.
 *
 * Lire sa bibliothèque est gratuit, ajouter du matériel personnel est Race
 * Pass : un coureur qui a eu PLUKA+ garde son matériel et peut s'en servir.
 */
export async function addPersonalEquipmentFromLibrary(
  context: PreparationContext,
  input: unknown,
): Promise<number> {
  const useCase = 'addPersonalEquipmentFromLibrary';
  const command = parseCommand(addFromLibraryCommand, input, useCase);
  await authorize(context, 'preparation.edit_advanced', command.participantRaceId);

  // La RLS ne rend que son propre matériel : un identifiant étranger est ignoré.
  const library = await context.repositories.library.listEquipment(context.actor.userId);
  const wanted = new Set(command.itemIds);
  const raceId = await raceIdOf(context, command.participantRaceId, useCase);
  const taken = await takenLabels(context, command.participantRaceId, raceId);

  const added = cleanLabels(
    library.filter((item) => wanted.has(item.id)).map((item) => item.label),
  ).filter((label) => !taken.has(labelKey(label)));

  await context.repositories.preparation.addPersonalEquipmentMany(command.participantRaceId, added);
  return added.length;
}
