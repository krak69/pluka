import { z } from 'zod';

import type { EmergencyContactRecord, OrganizerEmergencyContactRepository } from '@pluka/db';

import { authorizeCapability } from '../entitlements/use-cases.js';
import { parseCommand } from '../errors.js';
import type { AssistanceContext } from './assistance.js';

/**
 * Contact d'urgence — 00_PRODUCT_SPEC §15.5, 03_PRIVACY_RLS §48, AC-ASST-09,
 * décisions du 2026-11-17.
 *
 * Distinct de l'Assistance, et gratuit : c'est une information de sécurité
 * (AGENTS §22), utile même en autonomie. Le coureur atteste que la personne a
 * accepté d'être son contact. Il peut, en plus, le partager avec
 * l'organisation de la course pour une urgence liée à cette course ; décocher
 * retire l'accès aussitôt. L'organisation ne lit jamais la table : elle passe
 * par une fonction réservée au propriétaire et aux admins, et journalisée.
 */

export interface EmergencyContactView {
  readonly contact: EmergencyContactRecord | null;
  /** Le nom de la course, pour dire à qui le partage s'adresse. */
  readonly raceName: string | null;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === undefined || value === null || value === '' ? null : value));

const saveCommand = z
  .object({
    participantRaceId: z.uuid(),
    firstName: z.string().trim().min(1).max(60),
    lastName: optionalText(60),
    phone: z
      .string()
      .trim()
      .regex(/^[0-9+() .-]{3,30}$/u, 'numéro de téléphone invalide'),
    relationshipLabel: optionalText(60),
    /** Sans l'accord de la personne, rien n'est enregistré. */
    personAgreed: z.literal(true),
    shareWithOrganization: z.boolean(),
  })
  .strict();

const participation = z.object({ participantRaceId: z.uuid() }).strict();

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

export async function getEmergencyContact(
  context: AssistanceContext,
  input: unknown,
): Promise<EmergencyContactView> {
  const { participantRaceId } = parseCommand(participation, input, 'getEmergencyContact');

  await authorizeCapability(serviceContext(context), {
    capability: 'assistance.read',
    participantRaceId,
  });

  const record = await context.repositories.participantRaces.findById(participantRaceId);
  const [contact, race] = await Promise.all([
    context.repositories.emergencyContacts.find(participantRaceId),
    record === null ? null : context.repositories.races.findById(record.raceId),
  ]);

  return { contact, raceName: race?.name ?? null };
}

/**
 * Enregistrer garde la date de l'accord déjà donné, et celle du partage tant
 * qu'il reste coché : modifier un numéro ne redate pas un consentement.
 */
export async function saveEmergencyContact(
  context: AssistanceContext,
  input: unknown,
): Promise<void> {
  const command = parseCommand(saveCommand, input, 'saveEmergencyContact');

  await authorizeCapability(serviceContext(context), {
    capability: 'assistance.read',
    participantRaceId: command.participantRaceId,
  });

  const existing = await context.repositories.emergencyContacts.find(command.participantRaceId);
  const now = context.now().toISOString();

  await context.repositories.emergencyContacts.save(command.participantRaceId, {
    firstName: command.firstName,
    lastName: command.lastName,
    phone: command.phone,
    relationshipLabel: command.relationshipLabel,
    explicitConsentAt: existing?.explicitConsentAt ?? now,
    organizationShareConsentAt: command.shareWithOrganization
      ? (existing?.organizationShareConsentAt ?? now)
      : null,
  });
}

export async function removeEmergencyContact(
  context: AssistanceContext,
  input: unknown,
): Promise<void> {
  const { participantRaceId } = parseCommand(participation, input, 'removeEmergencyContact');

  await authorizeCapability(serviceContext(context), {
    capability: 'assistance.read',
    participantRaceId,
  });
  await context.repositories.emergencyContacts.remove(participantRaceId);
}

// ------------------------------------------------------------
// Côté organisation — propriétaire et admins, journalisé (0101)
// ------------------------------------------------------------

export interface OrganizerEmergencyContactContext {
  readonly repositories: {
    readonly organizerEmergencyContacts: OrganizerEmergencyContactRepository;
  };
}

const editionQuery = z.object({ editionId: z.uuid() }).strict();

/**
 * Les participations dont le contact est partagé. La base refuse elle-même
 * un rôle inférieur à admin ; l'écran n'en reçoit alors qu'une liste vide.
 */
export async function listSharedEmergencyContacts(
  context: OrganizerEmergencyContactContext,
  input: unknown,
): Promise<ReadonlySet<string>> {
  const { editionId } = parseCommand(editionQuery, input, 'listSharedEmergencyContacts');
  return new Set(await context.repositories.organizerEmergencyContacts.listShared(editionId));
}

export async function viewSharedEmergencyContact(
  context: OrganizerEmergencyContactContext,
  input: unknown,
) {
  const { participantRaceId } = parseCommand(participation, input, 'viewSharedEmergencyContact');
  return context.repositories.organizerEmergencyContacts.view(participantRaceId);
}
