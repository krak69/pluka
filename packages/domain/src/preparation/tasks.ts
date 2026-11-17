import { z } from 'zod';

import type {
  BagRecord,
  EntitlementRepositories,
  PublishedFactRepository,
  PublishedRaceFactRecord,
  TaskRecord,
  TaskRepositories,
} from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import type { Capability } from '../entitlements/capabilities.js';
import { can } from '../entitlements/resolver.js';
import { authorizeCapability, resolveEntitlements } from '../entitlements/use-cases.js';
import { notFoundError, parseCommand } from '../errors.js';
import { equipmentValueOf } from '../facts/equipment.js';
import { civilMoment, civilToInstant } from '../site/editing.js';

/**
 * Préparation · À faire — 00_PRODUCT_SPEC §14.5 ; 04_ENTITLEMENTS §45 ;
 * migration 0097.
 *
 * Comme le prototype : « Mes tâches », puis les suggestions PLUKA que le
 * coureur ajoute à ses tâches ou écarte.
 *
 * - Les suggestions se déduisent des données de la course par `suggestTasks`,
 *   fonction pure — aucune IA, aucun délai inventé (décisions produit du
 *   2026-11-17). Les ajouter, les cocher, les retirer et les écarter est
 *   gratuit (`preparation.read`) : ce sont des rappels sur ce que la course
 *   demande.
 * - Les tâches du coureur portent une échéance facultative. Les créer,
 *   modifier, cocher et supprimer est de la préparation avancée
 *   (`preparation.edit_advanced`, Race Pass), revérifiée à chaque écriture. Un
 *   Race Pass expiré garde la vue de ce que le coureur a écrit (04 §57).
 *
 * Une suggestion n'est une ligne qu'une fois ajoutée (`dismissed_at` nul) ou
 * écartée (0097). La retirer de ses tâches efface la ligne : elle redevient
 * une suggestion.
 */

export interface TasksContext {
  readonly repositories: TaskRepositories &
    EntitlementRepositories & { readonly publishedFacts: PublishedFactRepository };
  readonly actor: Actor;
  /** Horloge serveur : date la coche, et part au service de droits (04 §22). */
  readonly now: () => Date;
  readonly disabledCapabilities?: ReadonlySet<Capability>;
}

export interface TaskSuggestion {
  /** `plan`, `gpx`, `mandatory_equipment`, `bag:<id>` — ce que l'ajout et « Écarter » retiennent. */
  readonly key: string;
  readonly title: string;
}

/** Une ligne de « Mes tâches » : une tâche du coureur, ou une suggestion qu'il a ajoutée. */
export interface MyTaskView {
  readonly id: string;
  /** La suggestion d'origine ; nulle pour une tâche écrite par le coureur. */
  readonly suggestionKey: string | null;
  readonly title: string;
  /** Jour civil de l'échéance, dans le fuseau de la course (`AAAA-MM-JJ`). */
  readonly dueDay: string | null;
  /**
   * Jours entre aujourd'hui et l'échéance : 2 pour « dans 2 jours », 0
   * aujourd'hui, négatif en retard (décision produit du 2026-11-17 : compté
   * depuis aujourd'hui, pas depuis le départ — illisible quand la course est loin).
   */
  readonly daysLeft: number | null;
  readonly done: boolean;
}

export interface TasksOverview {
  readonly mine: readonly MyTaskView[];
  /** Les suggestions ni ajoutées ni écartées. */
  readonly suggestions: readonly TaskSuggestion[];
  /** Ce qui est fait dans « Mes tâches ». */
  readonly progress: { readonly done: number; readonly total: number };
  /** Suggestions écartées qui pourraient revenir : de quoi proposer « Réafficher ». */
  readonly dismissedCount: number;
  /** Créer, modifier, cocher, supprimer ses propres tâches : Race Pass. */
  readonly canEdit: boolean;
}

const TITLE_MAX = 120;

export interface SuggestTasksInput {
  readonly hasPlan: boolean;
  readonly hasCourseTrace: boolean;
  readonly hasMandatoryEquipment: boolean;
  readonly bags: readonly Pick<BagRecord, 'id' | 'bagType' | 'name'>[];
}

function bagTitle(bag: Pick<BagRecord, 'bagType' | 'name'>): string {
  const title =
    bag.bagType === 'drop_bag' ? `Préparer et déposer : ${bag.name}` : `Préparer : ${bag.name}`;
  return title.slice(0, TITLE_MAX).trim();
}

/**
 * Les rappels que la course appelle, chacun seulement quand sa donnée existe.
 *
 * Dans l'ordre d'une préparation : le Plan, la trace, le matériel, puis les
 * sacs dans l'ordre où le coureur les a créés. Fonction pure (AGENTS §11).
 */
export function suggestTasks(input: SuggestTasksInput): readonly TaskSuggestion[] {
  return [
    ...(input.hasPlan ? [] : [{ key: 'plan', title: 'Construire ton Plan' }]),
    ...(input.hasCourseTrace ? [{ key: 'gpx', title: 'Charger la trace sur ta montre' }] : []),
    ...(input.hasMandatoryEquipment
      ? [{ key: 'mandatory_equipment', title: 'Rassembler le matériel obligatoire' }]
      : []),
    ...input.bags.map((bag) => ({ key: `bag:${bag.id}`, title: bagTitle(bag) })),
  ];
}

/** Jours civils entre deux dates `AAAA-MM-JJ`. */
function daysBetween(fromDay: string, toDay: string): number {
  return Math.round(
    (Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000,
  );
}

// ------------------------------------------------------------
// Commandes
// ------------------------------------------------------------

const participation = z.object({ participantRaceId: z.uuid() }).strict();

const title = z.string().trim().min(1).max(TITLE_MAX);

const dueDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((day) => new Date(`${day}T00:00:00Z`).toISOString().startsWith(day))
  .nullable()
  .default(null);

const createCommand = z.object({ participantRaceId: z.uuid(), title, dueDay }).strict();

const updateCommand = z
  .object({ participantRaceId: z.uuid(), taskId: z.uuid(), title, dueDay })
  .strict();

const taskCommand = z.object({ participantRaceId: z.uuid(), taskId: z.uuid() }).strict();

const doneCommand = taskCommand.extend({ done: z.boolean() }).strict();

const suggestionCommand = z
  .object({ participantRaceId: z.uuid(), key: z.string().min(1).max(64) })
  .strict();

const suggestionDoneCommand = suggestionCommand.extend({ done: z.boolean() }).strict();

const suggestionDueCommand = suggestionCommand.extend({ dueDay }).strict();

// ------------------------------------------------------------
// Lecture
// ------------------------------------------------------------

function serviceContext(context: TasksContext) {
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
  context: TasksContext,
  capability: Capability,
  participantRaceId: string,
): Promise<void> {
  await authorizeCapability(serviceContext(context), { capability, participantRaceId });
}

interface RaceClock {
  readonly raceId: string;
  readonly timezone: string;
  /** Aujourd'hui, en jour civil dans le fuseau de la course, d'après l'horloge injectée. */
  readonly today: string;
}

async function raceClockOf(
  context: TasksContext,
  participantRaceId: string,
  useCase: string,
): Promise<RaceClock> {
  const record = await context.repositories.participantRaces.findById(participantRaceId);
  if (record === null) throw notFoundError(useCase, 'participation');
  const race = await context.repositories.races.findById(record.raceId);
  if (race === null) throw notFoundError(useCase, 'course');

  return {
    raceId: race.id,
    timezone: race.timezone,
    today: civilMoment(context.now().toISOString(), race.timezone).day,
  };
}

function hasMandatoryEquipment(facts: readonly PublishedRaceFactRecord[]): boolean {
  return facts.some(
    (fact) =>
      fact.category === 'equipment' && equipmentValueOf(fact.valueJson).requirement === 'mandatory',
  );
}

async function currentSuggestions(
  context: TasksContext,
  participantRaceId: string,
  raceId: string,
): Promise<readonly TaskSuggestion[]> {
  const [plan, geometryId, facts, bags] = await Promise.all([
    context.repositories.racePlans.findActive(participantRaceId),
    context.repositories.planCourse.findCurrentCourseGeometryId(raceId),
    context.repositories.publishedFacts.listPublishedByRace(raceId),
    context.repositories.bags.listBags(participantRaceId),
  ]);

  return suggestTasks({
    hasPlan: plan !== null,
    hasCourseTrace: geometryId !== null,
    hasMandatoryEquipment: hasMandatoryEquipment(facts),
    bags,
  });
}

function myTaskView(task: TaskRecord, title: string, clock: RaceClock): MyTaskView {
  const day = task.dueAt === null ? null : civilMoment(task.dueAt, clock.timezone).day;
  return {
    id: task.id,
    suggestionKey: task.suggestionKey,
    title,
    dueDay: day,
    daysLeft: day === null ? null : daysBetween(clock.today, day),
    done: task.completedAt !== null,
  };
}

/** À faire, dans l'ordre : ce qui reste avant ce qui est fait, l'échéance la plus proche d'abord. */
function byUrgency(left: MyTaskView, right: MyTaskView): number {
  if (left.done !== right.done) return left.done ? 1 : -1;
  if (left.dueDay !== right.dueDay) {
    if (left.dueDay === null) return 1;
    if (right.dueDay === null) return -1;
    return left.dueDay.localeCompare(right.dueDay);
  }
  return 0;
}

/** « Mes tâches », et les suggestions qui restent. */
export async function getTasks(context: TasksContext, input: unknown): Promise<TasksOverview> {
  const useCase = 'getTasks';
  const { participantRaceId } = parseCommand(participation, input, useCase);

  await authorize(context, 'preparation.read', participantRaceId);

  const clock = await raceClockOf(context, participantRaceId, useCase);
  const [suggestions, rows, entitlements] = await Promise.all([
    currentSuggestions(context, participantRaceId, clock.raceId),
    context.repositories.tasks.listTasks(participantRaceId),
    resolveEntitlements(serviceContext(context), { participantRaceId }),
  ]);

  const live = new Map(suggestions.map((suggestion) => [suggestion.key, suggestion]));
  const marked = new Map(
    rows.filter((row) => row.suggestionKey !== null).map((row) => [row.suggestionKey, row]),
  );
  // Une suggestion ajoutée dont la donnée a disparu — sac supprimé, Plan
  // construit — n'est ni affichée ni comptée : ce qu'elle rappelait n'existe plus.
  const mine = rows
    .flatMap((row) => {
      if (row.suggestionKey === null) return [myTaskView(row, row.title, clock)];
      const suggestion = live.get(row.suggestionKey);
      return suggestion === undefined || row.dismissedAt !== null
        ? []
        : [myTaskView(row, suggestion.title, clock)];
    })
    .sort(byUrgency);

  return {
    mine,
    suggestions: suggestions.filter((suggestion) => !marked.has(suggestion.key)),
    progress: { done: mine.filter((task) => task.done).length, total: mine.length },
    dismissedCount: suggestions.filter(
      (suggestion) => (marked.get(suggestion.key)?.dismissedAt ?? null) !== null,
    ).length,
    canEdit: can(entitlements, 'preparation.edit_advanced').allowed,
  };
}

// ------------------------------------------------------------
// Suggestions — gratuit
// ------------------------------------------------------------

/** « Ajouter à mes tâches » : la suggestion rejoint « Mes tâches ». */
export async function adoptTaskSuggestion(context: TasksContext, input: unknown): Promise<void> {
  const useCase = 'adoptTaskSuggestion';
  const command = parseCommand(suggestionCommand, input, useCase);
  await authorize(context, 'preparation.read', command.participantRaceId);

  const suggestion = await liveSuggestion(context, command.participantRaceId, command.key, useCase);
  await context.repositories.tasks.markSuggestion(command.participantRaceId, suggestion.key, {
    title: suggestion.title,
    dismissedAt: null,
  });
}

/**
 * Date une suggestion ajoutée. Seule l'échéance change : le titre reste celui
 * de PLUKA — le réécrire ferait d'une suggestion gratuite une tâche libre.
 */
export async function setSuggestedTaskDueDay(context: TasksContext, input: unknown): Promise<void> {
  const useCase = 'setSuggestedTaskDueDay';
  const command = parseCommand(suggestionDueCommand, input, useCase);
  await authorize(context, 'preparation.read', command.participantRaceId);

  const rows = await context.repositories.tasks.listTasks(command.participantRaceId);
  const adopted = rows.some((row) => row.suggestionKey === command.key && row.dismissedAt === null);
  if (!adopted) throw notFoundError(useCase, 'suggestion');

  const clock = await raceClockOf(context, command.participantRaceId, useCase);
  const suggestion = await liveSuggestion(context, command.participantRaceId, command.key, useCase);
  await context.repositories.tasks.markSuggestion(command.participantRaceId, suggestion.key, {
    title: suggestion.title,
    dueAt: dueAtOf(command.dueDay, clock),
  });
}

/** Retire une suggestion de « Mes tâches » : elle redevient une suggestion. */
export async function removeTaskSuggestion(context: TasksContext, input: unknown): Promise<void> {
  const command = parseCommand(suggestionCommand, input, 'removeTaskSuggestion');
  await authorize(context, 'preparation.read', command.participantRaceId);
  await context.repositories.tasks.deleteSuggestion(command.participantRaceId, command.key);
}

async function liveSuggestion(
  context: TasksContext,
  participantRaceId: string,
  key: string,
  useCase: string,
): Promise<TaskSuggestion> {
  const clock = await raceClockOf(context, participantRaceId, useCase);
  const suggestions = await currentSuggestions(context, participantRaceId, clock.raceId);
  const suggestion = suggestions.find((candidate) => candidate.key === key);
  if (suggestion === undefined) throw notFoundError(useCase, 'suggestion');
  return suggestion;
}

/** Coche ou décoche une suggestion ajoutée à « Mes tâches ». */
export async function setSuggestedTaskDone(context: TasksContext, input: unknown): Promise<void> {
  const useCase = 'setSuggestedTaskDone';
  const command = parseCommand(suggestionDoneCommand, input, useCase);
  await authorize(context, 'preparation.read', command.participantRaceId);

  const suggestion = await liveSuggestion(context, command.participantRaceId, command.key, useCase);
  await context.repositories.tasks.markSuggestion(command.participantRaceId, suggestion.key, {
    title: suggestion.title,
    completedAt: command.done ? context.now().toISOString() : null,
  });
}

/** « Écarter » : la suggestion ne revient plus pour cette course, jusqu'à « Réafficher ». */
export async function dismissTaskSuggestion(context: TasksContext, input: unknown): Promise<void> {
  const useCase = 'dismissTaskSuggestion';
  const command = parseCommand(suggestionCommand, input, useCase);
  await authorize(context, 'preparation.read', command.participantRaceId);

  const suggestion = await liveSuggestion(context, command.participantRaceId, command.key, useCase);
  await context.repositories.tasks.markSuggestion(command.participantRaceId, suggestion.key, {
    title: suggestion.title,
    dismissedAt: context.now().toISOString(),
  });
}

/** « Réafficher » : les suggestions écartées redeviennent des suggestions. */
export async function restoreTaskSuggestions(context: TasksContext, input: unknown): Promise<void> {
  const { participantRaceId } = parseCommand(participation, input, 'restoreTaskSuggestions');
  await authorize(context, 'preparation.read', participantRaceId);
  await context.repositories.tasks.restoreSuggestions(participantRaceId);
}

// ------------------------------------------------------------
// Ses propres tâches — Race Pass
// ------------------------------------------------------------

async function ownedTask(
  context: TasksContext,
  participantRaceId: string,
  taskId: string,
  useCase: string,
): Promise<TaskRecord> {
  // La RLS borne déjà les tâches au coureur ; la participation borne aussi le
  // geste, et une suggestion ne se modifie ni ne se supprime d'ici.
  const rows = await context.repositories.tasks.listTasks(participantRaceId);
  const task = rows.find((row) => row.id === taskId && row.suggestionKey === null);
  if (task === undefined) throw notFoundError(useCase, 'tâche');
  return task;
}

function dueAtOf(day: string | null, clock: RaceClock): string | null {
  return day === null ? null : civilToInstant(day, '00:00', clock.timezone);
}

export async function createTask(context: TasksContext, input: unknown): Promise<void> {
  const useCase = 'createTask';
  const command = parseCommand(createCommand, input, useCase);
  await authorize(context, 'preparation.edit_advanced', command.participantRaceId);

  const clock = await raceClockOf(context, command.participantRaceId, useCase);
  await context.repositories.tasks.createTask(command.participantRaceId, {
    title: command.title,
    dueAt: dueAtOf(command.dueDay, clock),
  });
}

export async function updateTask(context: TasksContext, input: unknown): Promise<void> {
  const useCase = 'updateTask';
  const command = parseCommand(updateCommand, input, useCase);
  await authorize(context, 'preparation.edit_advanced', command.participantRaceId);

  await ownedTask(context, command.participantRaceId, command.taskId, useCase);
  const clock = await raceClockOf(context, command.participantRaceId, useCase);
  await context.repositories.tasks.updateTask(command.participantRaceId, command.taskId, {
    title: command.title,
    dueAt: dueAtOf(command.dueDay, clock),
  });
}

export async function setTaskDone(context: TasksContext, input: unknown): Promise<void> {
  const useCase = 'setTaskDone';
  const command = parseCommand(doneCommand, input, useCase);
  await authorize(context, 'preparation.edit_advanced', command.participantRaceId);

  await ownedTask(context, command.participantRaceId, command.taskId, useCase);
  await context.repositories.tasks.setCompleted(
    command.participantRaceId,
    command.taskId,
    command.done ? context.now().toISOString() : null,
  );
}

export async function deleteTask(context: TasksContext, input: unknown): Promise<void> {
  const useCase = 'deleteTask';
  const command = parseCommand(taskCommand, input, useCase);
  await authorize(context, 'preparation.edit_advanced', command.participantRaceId);

  await ownedTask(context, command.participantRaceId, command.taskId, useCase);
  await context.repositories.tasks.deleteTask(command.participantRaceId, command.taskId);
}
