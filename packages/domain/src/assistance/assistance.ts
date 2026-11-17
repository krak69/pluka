import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

import type {
  AssistanceAssignmentRecord,
  AssistanceRepositories,
  AssistantLinkRecord,
  AssistantLinkViewRepository,
  AssistantRecord,
  CourseWaypointRecord,
  EntitlementRepositories,
  ParticipantRaceSettingsRecord,
} from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import type { Capability } from '../entitlements/capabilities.js';
import { can } from '../entitlements/resolver.js';
import { authorizeCapability, resolveEntitlements } from '../entitlements/use-cases.js';
import { notFoundError, parseCommand, validationError } from '../errors.js';
import { cleanLabels } from '../library/equipment-library.js';

/**
 * Assistance du coureur — 00_PRODUCT_SPEC §15, PLAN_ENGINE §41-42,
 * 04_ENTITLEMENTS §46, décisions du 2026-11-17.
 *
 * Le coureur dit s'il sera autonome, assisté, ou s'il décidera plus tard : ce
 * choix est gratuit (`assistance.read`), il sert aussi aux suggestions de
 * sacs. Ajouter les personnes qui l'assistent, leurs rendez-vous et ce
 * qu'elles doivent lui donner demande le Race Pass (`assistance.edit`).
 *
 * L'heure d'un rendez-vous n'est jamais stockée : elle se lit dans le Plan
 * actif à chaque affichage (AC-ASST-04). Un Plan modifié change donc l'heure,
 * et les consignes restent (AC-ASST-05). Aucun suivi en direct.
 */

export interface AssistanceContext {
  readonly repositories: AssistanceRepositories & EntitlementRepositories;
  readonly actor: Actor;
  readonly now: () => Date;
  readonly disabledCapabilities?: ReadonlySet<Capability>;
}

export type AssistanceStatus = ParticipantRaceSettingsRecord['assistanceStatus'];

export interface AssistancePoint {
  readonly id: string;
  readonly name: string;
  readonly distanceKm: number;
}

/** Passage estimé et fenêtre de planification — PLAN_ENGINE §42. */
export interface AssistancePassage {
  readonly at: string;
  readonly windowStart: string;
  readonly windowEnd: string;
}

export interface RendezvousView {
  readonly id: string;
  readonly point: AssistancePoint | null;
  /**
   * Ce qui a changé côté organisation : le point a disparu, ou n'autorise plus
   * l'assistance. Le rendez-vous reste ; l'écran le signale.
   */
  readonly pointIssue: 'removed' | 'assistance_withdrawn' | null;
  /**
   * Nul sans Plan, ou quand le Plan ne passe pas encore par ce point (un point
   * ajouté depuis : le Plan est à mettre à jour, PLAN_ENGINE §39).
   */
  readonly passage: AssistancePassage | null;
  readonly instructions: string | null;
  readonly items: readonly { readonly id: string; readonly label: string }[];
}

export interface AssistantView {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string | null;
  readonly phone: string | null;
  readonly rendezvous: readonly RendezvousView[];
  /** Le lien privé actif de cette personne (0100) ; nul s'il n'y en a pas. */
  readonly link: { readonly createdAt: string; readonly lastUsedAt: string | null } | null;
}

export interface AssistanceOverview {
  readonly status: AssistanceStatus;
  readonly people: readonly AssistantView[];
  /** Les points où l'organisation autorise l'assistance (0098), au kilomètre. */
  readonly points: readonly AssistancePoint[];
  readonly hasPlan: boolean;
  readonly timezone: string;
  /** Personnes, rendez-vous, « À me donner » : Race Pass. */
  readonly canEdit: boolean;
  /** Créer ou régénérer un lien privé : Race Pass (`assistance.share`). */
  readonly canShare: boolean;
}

const MINUTE = 60;

/**
 * PLAN_ENGINE §42 : `half_window = clamp(0.075 × elapsed_time, 15 min, 60 min)`.
 * Une marge de planification, pas un intervalle probabiliste.
 */
export function assistancePassage(
  startAt: string,
  plannedElapsedSeconds: number,
): AssistancePassage {
  const halfWindow = Math.min(
    60 * MINUTE,
    Math.max(15 * MINUTE, Math.round(0.075 * plannedElapsedSeconds)),
  );
  const arrival = Date.parse(startAt) + plannedElapsedSeconds * 1000;

  return {
    at: new Date(arrival).toISOString(),
    windowStart: new Date(arrival - halfWindow * 1000).toISOString(),
    windowEnd: new Date(arrival + halfWindow * 1000).toISOString(),
  };
}

// ------------------------------------------------------------
// Commandes
// ------------------------------------------------------------

const participation = z.object({ participantRaceId: z.uuid() }).strict();

const statusCommand = z
  .object({
    participantRaceId: z.uuid(),
    status: z.enum(['to_define', 'autonomous', 'enabled']),
  })
  .strict();

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === undefined || value === null || value === '' ? null : value));

const assistantFields = {
  firstName: z.string().trim().min(1).max(60),
  lastName: optionalText(60),
  phone: optionalText(30).refine(
    (value) => value === null || /^[0-9+() .-]{3,30}$/u.test(value),
    'numéro de téléphone invalide',
  ),
};

const addAssistantCommand = z.object({ participantRaceId: z.uuid(), ...assistantFields }).strict();

const updateAssistantCommand = z
  .object({ participantRaceId: z.uuid(), assistantId: z.uuid(), ...assistantFields })
  .strict();

const assistantCommand = z.object({ participantRaceId: z.uuid(), assistantId: z.uuid() }).strict();

const addRendezvousCommand = z
  .object({ participantRaceId: z.uuid(), assistantId: z.uuid(), pointId: z.uuid() })
  .strict();

const rendezvousCommand = z
  .object({ participantRaceId: z.uuid(), rendezvousId: z.uuid() })
  .strict();

const instructionsCommand = z
  .object({
    participantRaceId: z.uuid(),
    rendezvousId: z.uuid(),
    instructions: optionalText(1000),
  })
  .strict();

const addItemsCommand = z
  .object({
    participantRaceId: z.uuid(),
    rendezvousId: z.uuid(),
    labels: z.array(z.string().max(120)).min(1).max(50),
  })
  .strict();

const itemCommand = z.object({ participantRaceId: z.uuid(), itemId: z.uuid() }).strict();

// ------------------------------------------------------------
// Aides
// ------------------------------------------------------------

function serviceContext(context: AssistanceContext) {
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
  context: AssistanceContext,
  capability: Capability,
  participantRaceId: string,
): Promise<void> {
  await authorizeCapability(serviceContext(context), { capability, participantRaceId });
}

function pointOf(waypoint: CourseWaypointRecord): AssistancePoint {
  return { id: waypoint.id, name: waypoint.name, distanceKm: waypoint.distanceKm };
}

async function raceOf(context: AssistanceContext, participantRaceId: string, useCase: string) {
  const record = await context.repositories.participantRaces.findById(participantRaceId);
  if (record === null) throw notFoundError(useCase, 'participation');
  return record.raceId;
}

/** La personne, si elle appartient bien à cette participation. */
async function ownAssistant(
  context: AssistanceContext,
  participantRaceId: string,
  assistantId: string,
  useCase: string,
): Promise<AssistantRecord> {
  const assistants = await context.repositories.assistance.listAssistants(participantRaceId);
  const assistant = assistants.find((entry) => entry.id === assistantId);
  if (assistant === undefined) throw notFoundError(useCase, 'personne');
  return assistant;
}

/** Le rendez-vous, s'il est bien celui d'une personne de cette participation. */
async function ownRendezvous(
  context: AssistanceContext,
  participantRaceId: string,
  rendezvousId: string,
  useCase: string,
): Promise<AssistanceAssignmentRecord> {
  const assistants = await context.repositories.assistance.listAssistants(participantRaceId);
  const assignments = await context.repositories.assistance.listAssignments(
    assistants.map((assistant) => assistant.id),
  );
  const assignment = assignments.find((entry) => entry.id === rendezvousId);
  if (assignment === undefined) throw notFoundError(useCase, 'rendez-vous');
  return assignment;
}

// ------------------------------------------------------------
// Lecture — gratuite
// ------------------------------------------------------------

export async function getAssistance(
  context: AssistanceContext,
  input: unknown,
): Promise<AssistanceOverview> {
  const useCase = 'getAssistance';
  const { participantRaceId } = parseCommand(participation, input, useCase);

  await authorize(context, 'assistance.read', participantRaceId);

  const raceId = await raceOf(context, participantRaceId, useCase);
  const [race, waypoints, settings, assistants, plan, entitlements, links] = await Promise.all([
    context.repositories.races.findById(raceId),
    context.repositories.waypoints.listByRace(raceId),
    context.repositories.participantRaceSettings.findByParticipantRace(participantRaceId),
    context.repositories.assistance.listAssistants(participantRaceId),
    context.repositories.racePlans.findActive(participantRaceId),
    resolveEntitlements(serviceContext(context), { participantRaceId }),
    context.repositories.assistance.listLinks(participantRaceId),
  ]);
  const assignments = await context.repositories.assistance.listAssignments(
    assistants.map((assistant) => assistant.id),
  );
  const [items, planWaypoints] = await Promise.all([
    context.repositories.assistance.listItems(assignments.map((assignment) => assignment.id)),
    plan === null ? [] : context.repositories.racePlans.listWaypoints(plan.id),
  ]);

  const byId = new Map(waypoints.map((waypoint) => [waypoint.id, waypoint]));
  const planned = new Map(planWaypoints.map((entry) => [entry.raceWaypointId, entry]));

  const rendezvousOf = (assignment: AssistanceAssignmentRecord): RendezvousView => {
    const waypoint = byId.get(assignment.raceWaypointId);
    const step = planned.get(assignment.raceWaypointId);
    return {
      id: assignment.id,
      point: waypoint === undefined ? null : pointOf(waypoint),
      pointIssue:
        waypoint === undefined
          ? 'removed'
          : waypoint.assistanceAllowed
            ? null
            : 'assistance_withdrawn',
      passage:
        plan?.startAt === null || plan?.startAt === undefined || step === undefined
          ? null
          : assistancePassage(plan.startAt, step.plannedElapsedSeconds),
      instructions: assignment.instructions,
      items: items
        .filter((item) => item.assignmentId === assignment.id)
        .map((item) => ({ id: item.id, label: item.label })),
    };
  };

  return {
    status: settings?.assistanceStatus ?? 'to_define',
    people: assistants.map((assistant) => ({
      id: assistant.id,
      firstName: assistant.firstName,
      lastName: assistant.lastName,
      phone: assistant.phone,
      link: linkOf(links, assistant.id),
      rendezvous: assignments
        .filter((assignment) => assignment.assistantId === assistant.id)
        .map(rendezvousOf)
        .sort(
          (left, right) =>
            (left.point?.distanceKm ?? Number.POSITIVE_INFINITY) -
            (right.point?.distanceKm ?? Number.POSITIVE_INFINITY),
        ),
    })),
    points: waypoints
      .filter((waypoint) => waypoint.assistanceAllowed)
      .sort((left, right) => left.distanceKm - right.distanceKm)
      .map(pointOf),
    hasPlan: plan !== null,
    timezone: race?.timezone ?? 'Europe/Paris',
    canEdit: can(entitlements, 'assistance.edit').allowed,
    canShare: can(entitlements, 'assistance.share').allowed,
  };
}

/**
 * Autonome, avec assistance, ou plus tard (AC-ASST-02). Gratuit : c'est une
 * question de préparation, pas une personnalisation. Repasser en « autonome »
 * ne supprime personne ; les rendez-vous restent pour un retour en arrière.
 */
export async function setAssistanceStatus(
  context: AssistanceContext,
  input: unknown,
): Promise<void> {
  const command = parseCommand(statusCommand, input, 'setAssistanceStatus');

  await authorize(context, 'assistance.read', command.participantRaceId);
  await context.repositories.participantRaceSettings.upsertAssistanceStatus(
    command.participantRaceId,
    command.status,
  );
}

// ------------------------------------------------------------
// Personnes, rendez-vous, « À me donner » — Race Pass
// ------------------------------------------------------------

/** Ajouter une personne vaut « avec assistance ». */
export async function addAssistant(context: AssistanceContext, input: unknown): Promise<void> {
  const command = parseCommand(addAssistantCommand, input, 'addAssistant');

  await authorize(context, 'assistance.edit', command.participantRaceId);
  await context.repositories.assistance.createAssistant(command.participantRaceId, {
    firstName: command.firstName,
    lastName: command.lastName,
    phone: command.phone,
  });
  await context.repositories.participantRaceSettings.upsertAssistanceStatus(
    command.participantRaceId,
    'enabled',
  );
}

export async function updateAssistant(context: AssistanceContext, input: unknown): Promise<void> {
  const useCase = 'updateAssistant';
  const command = parseCommand(updateAssistantCommand, input, useCase);

  await authorize(context, 'assistance.edit', command.participantRaceId);
  await ownAssistant(context, command.participantRaceId, command.assistantId, useCase);
  await context.repositories.assistance.updateAssistant(
    command.participantRaceId,
    command.assistantId,
    { firstName: command.firstName, lastName: command.lastName, phone: command.phone },
  );
}

export async function removeAssistant(context: AssistanceContext, input: unknown): Promise<void> {
  const useCase = 'removeAssistant';
  const command = parseCommand(assistantCommand, input, useCase);

  await authorize(context, 'assistance.edit', command.participantRaceId);
  await ownAssistant(context, command.participantRaceId, command.assistantId, useCase);
  await context.repositories.assistance.deleteAssistant(
    command.participantRaceId,
    command.assistantId,
  );
}

/** AC-ASST-03 : seulement à un point de la course où l'assistance est autorisée. */
export async function addRendezvous(context: AssistanceContext, input: unknown): Promise<void> {
  const useCase = 'addRendezvous';
  const command = parseCommand(addRendezvousCommand, input, useCase);

  await authorize(context, 'assistance.edit', command.participantRaceId);
  await ownAssistant(context, command.participantRaceId, command.assistantId, useCase);

  const raceId = await raceOf(context, command.participantRaceId, useCase);
  const waypoint = (await context.repositories.waypoints.listByRace(raceId)).find(
    (entry) => entry.id === command.pointId,
  );
  if (waypoint === undefined) throw notFoundError(useCase, 'point');
  if (!waypoint.assistanceAllowed) {
    throw validationError(useCase, 'l’organisation n’autorise pas l’assistance à ce point', {
      pointId: 'l’organisation n’autorise pas l’assistance à ce point',
    });
  }

  await context.repositories.assistance.createAssignment(command.assistantId, command.pointId);
}

export async function removeRendezvous(context: AssistanceContext, input: unknown): Promise<void> {
  const useCase = 'removeRendezvous';
  const command = parseCommand(rendezvousCommand, input, useCase);

  await authorize(context, 'assistance.edit', command.participantRaceId);
  await ownRendezvous(context, command.participantRaceId, command.rendezvousId, useCase);
  await context.repositories.assistance.deleteAssignment(command.rendezvousId);
}

export async function setRendezvousInstructions(
  context: AssistanceContext,
  input: unknown,
): Promise<void> {
  const useCase = 'setRendezvousInstructions';
  const command = parseCommand(instructionsCommand, input, useCase);

  await authorize(context, 'assistance.edit', command.participantRaceId);
  await ownRendezvous(context, command.participantRaceId, command.rendezvousId, useCase);
  await context.repositories.assistance.setInstructions(command.rendezvousId, command.instructions);
}

/** « À me donner » : une ou plusieurs lignes, nettoyées et sans doublon. */
export async function addRendezvousItems(
  context: AssistanceContext,
  input: unknown,
): Promise<number> {
  const useCase = 'addRendezvousItems';
  const command = parseCommand(addItemsCommand, input, useCase);

  await authorize(context, 'assistance.edit', command.participantRaceId);
  await ownRendezvous(context, command.participantRaceId, command.rendezvousId, useCase);

  const existing = new Set(
    (await context.repositories.assistance.listItems([command.rendezvousId])).map((item) =>
      item.label.toLocaleLowerCase('fr-FR'),
    ),
  );
  const labels = cleanLabels(command.labels).filter(
    (label) => !existing.has(label.toLocaleLowerCase('fr-FR')),
  );
  await context.repositories.assistance.addItems(command.rendezvousId, labels);
  return labels.length;
}

export async function removeRendezvousItem(
  context: AssistanceContext,
  input: unknown,
): Promise<void> {
  const useCase = 'removeRendezvousItem';
  const command = parseCommand(itemCommand, input, useCase);

  await authorize(context, 'assistance.edit', command.participantRaceId);

  const assistants = await context.repositories.assistance.listAssistants(
    command.participantRaceId,
  );
  const assignments = await context.repositories.assistance.listAssignments(
    assistants.map((assistant) => assistant.id),
  );
  const items = await context.repositories.assistance.listItems(
    assignments.map((assignment) => assignment.id),
  );
  if (!items.some((item) => item.id === command.itemId)) {
    throw notFoundError(useCase, 'élément');
  }

  await context.repositories.assistance.deleteItem(command.itemId);
}

// ------------------------------------------------------------
// Lien privé de l'accompagnant — 0100, 03_PRIVACY_RLS §44 à §47
// ------------------------------------------------------------

function linkOf(links: readonly AssistantLinkRecord[], assistantId: string): AssistantView['link'] {
  const link = links.find((entry) => entry.assistantId === assistantId);
  return link === undefined ? null : { createdAt: link.createdAt, lastUsedAt: link.lastUsedAt };
}

/** SHA-256 hexadécimal : la seule forme du jeton qui entre en base (§44). */
export function hashAssistantToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * 96 bits aléatoires, en base64url : 16 caractères, pour un lien court à
 * envoyer par message (décision du 2026-11-17). Impossible à deviner, et la page
 * limite en plus le débit.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16}$/u;

/**
 * Crée le lien privé d'une personne et rend le jeton en clair — la seule fois
 * où il existe hors de l'URL. L'ancien lien de cette personne s'éteint.
 * Race Pass (`assistance.share`, 04_ENTITLEMENTS §46).
 */
export async function createAssistantLink(
  context: AssistanceContext,
  input: unknown,
): Promise<{ readonly token: string }> {
  const useCase = 'createAssistantLink';
  const command = parseCommand(assistantCommand, input, useCase);

  await authorize(context, 'assistance.share', command.participantRaceId);
  await ownAssistant(context, command.participantRaceId, command.assistantId, useCase);

  const token = randomBytes(12).toString('base64url');
  await context.repositories.assistance.createLink(command.assistantId, hashAssistantToken(token));
  return { token };
}

/** Révoquer reste toujours permis : couper un accès n'est pas une personnalisation. */
export async function revokeAssistantLink(
  context: AssistanceContext,
  input: unknown,
): Promise<void> {
  const useCase = 'revokeAssistantLink';
  const command = parseCommand(assistantCommand, input, useCase);

  await authorize(context, 'assistance.read', command.participantRaceId);
  await ownAssistant(context, command.participantRaceId, command.assistantId, useCase);
  await context.repositories.assistance.revokeLink(command.assistantId);
}

export interface AssistantPageContext {
  readonly repositories: { readonly assistantLinkView: AssistantLinkViewRepository };
  readonly now: () => Date;
}

export interface AssistantPageRendezvous {
  readonly pointName: string;
  readonly distanceKm: number;
  readonly passage: AssistancePassage | null;
  readonly instructions: string | null;
  readonly items: readonly string[];
}

export type AssistantPage =
  | { readonly state: 'unknown' | 'revoked' | 'expired' }
  | {
      readonly state: 'valid';
      readonly runnerFirstName: string | null;
      readonly assistantFirstName: string;
      readonly raceName: string;
      readonly eventName: string | null;
      readonly timezone: string;
      readonly planUpdatedAt: string | null;
      readonly rendezvous: readonly AssistantPageRendezvous[];
      /**
       * Le prochain rendez-vous : le premier dont la fenêtre n'est pas
       * terminée, sinon le dernier. Une estimation du Plan, jamais un suivi
       * en direct (PLAN_ENGINE §42).
       */
      readonly nextIndex: number | null;
    };

/**
 * La page `/a/[token]` — sans session. Un jeton mal formé ne va pas jusqu'à
 * la base. La projection reste celle de §46 : rendez-vous, heures, lieux, ce
 * qu'il faut apporter, consignes.
 */
export async function getAssistantPage(
  context: AssistantPageContext,
  token: string,
): Promise<AssistantPage> {
  if (!TOKEN_PATTERN.test(token)) return { state: 'unknown' };

  const view = await context.repositories.assistantLinkView.view(hashAssistantToken(token));
  if (view.state !== 'valid') return { state: view.state };

  const rendezvous = view.rendezvous.map((entry) => ({
    pointName: entry.pointName,
    distanceKm: Number(entry.distanceKm),
    passage:
      entry.plannedElapsedSeconds === null
        ? null
        : assistancePassage(view.startAt, entry.plannedElapsedSeconds),
    instructions: entry.instructions,
    items: entry.items,
  }));
  const now = context.now().getTime();
  const upcoming = rendezvous.findIndex(
    (entry) => entry.passage !== null && Date.parse(entry.passage.windowEnd) >= now,
  );

  return {
    state: 'valid',
    runnerFirstName: view.runnerFirstName,
    assistantFirstName: view.assistantFirstName,
    raceName: view.raceName,
    eventName: view.eventName,
    timezone: view.timezone,
    planUpdatedAt: view.planUpdatedAt,
    rendezvous,
    nextIndex: rendezvous.length === 0 ? null : upcoming >= 0 ? upcoming : rendezvous.length - 1,
  };
}
