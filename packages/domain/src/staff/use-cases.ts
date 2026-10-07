import { z } from 'zod';

import {
  DbError,
  type StaffInvitationPreviewRecord,
  type StaffInvitationRecord,
  type StaffMemberRecord,
  type StaffRole,
  type StaffTeamRepositories,
} from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import {
  DomainError,
  forbiddenError,
  invalidStateError,
  notFoundError,
  parseCommand,
  validationError,
} from '../errors.js';
import { hashInvitationToken } from '../team/use-cases.js';

/**
 * Équipe PLUKA — migrations 0035, 0036.
 *
 * Trois rôles : `super_admin` (tout, dont Paramètres et l'équipe), `admin`
 * (la console sans Paramètres), `support` (lecture seule). Gérer l'équipe est
 * réservé au super-admin ; la garde est dans chaque fonction SQL, et ces use
 * cases ne la redoublent pas — même décision que 0029 et 0033.
 *
 * Ils ajoutent la validation, la confirmation du retrait, le hachage du jeton
 * et les messages qui disent quoi faire.
 */

export interface StaffTeamContext {
  readonly repositories: StaffTeamRepositories;
  /** Non consulté : la base lit l'acteur dans le jeton (`auth.uid()`). */
  readonly actor: Actor;
}

/** Les trois rôles de 0035, du plus large au plus étroit. */
export const STAFF_ROLES = ['super_admin', 'admin', 'support'] as const;

const uuid = z.string().uuid();
const staffRole = z.enum(STAFF_ROLES, { error: 'rôle inconnu' });
const confirmed = z.literal(true, { error: 'Cochez la case pour confirmer ce geste.' });
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/, { error: 'lien d’invitation invalide' });

export const inviteStaffMemberCommandSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email({ error: 'adresse email invalide' })),
    staffRole,
  })
  .strict();

export const revokeStaffInvitationCommandSchema = z.object({ invitationId: uuid }).strict();

export const changeStaffRoleCommandSchema = z.object({ userId: uuid, staffRole }).strict();

export const removeStaffMemberCommandSchema = z.object({ userId: uuid, confirmed }).strict();

export const staffInvitationTokenSchema = z.object({ token }).strict();

export type InviteStaffMemberCommand = z.infer<typeof inviteStaffMemberCommandSchema>;

const LAST_SUPER_ADMIN =
  'l’équipe doit garder au moins un super-admin : nommez-en un autre avant de changer celui-ci';

function translate(error: unknown, useCase: string, subject: string, refusal: string): unknown {
  if (!(error instanceof DbError)) return error;

  const translated: Partial<Record<DbError['code'], DomainError>> = {
    permission_denied: forbiddenError(useCase),
    not_found: notFoundError(useCase, subject),
    invalid_state: invalidStateError(useCase, refusal),
  };

  return translated[error.code] ?? error;
}

/**
 * Le rôle de la session — pour composer le menu, jamais pour autoriser.
 * Une erreur de lecture rend `null` : un menu réduit vaut mieux qu'une page
 * qui casse, et chaque page garde sa propre garde.
 */
export async function getMyStaffRole(context: StaffTeamContext): Promise<StaffRole | null> {
  try {
    return await context.repositories.staffTeam.myStaffRole();
  } catch {
    return null;
  }
}

export interface StaffTeam {
  readonly members: readonly StaffMemberRecord[];
  readonly invitations: readonly StaffInvitationRecord[];
}

export async function listStaffTeam(context: StaffTeamContext): Promise<StaffTeam> {
  const useCase = 'listStaffTeam';

  try {
    const [members, invitations] = await Promise.all([
      context.repositories.staffTeam.listMembers(),
      context.repositories.staffTeam.listInvitations(),
    ]);
    return { members, invitations };
  } catch (error) {
    throw translate(error, useCase, 'équipe', 'lecture refusée');
  }
}

export async function inviteStaffMember(
  context: StaffTeamContext,
  input: unknown,
): Promise<{ readonly invitationId: string }> {
  const useCase = 'inviteStaffMember';
  const command = parseCommand(inviteStaffMemberCommandSchema, input, useCase);

  try {
    const invitationId = await context.repositories.staffTeam.invite(
      command.email,
      command.staffRole,
    );
    return { invitationId };
  } catch (error) {
    if (error instanceof DbError && error.code === 'conflict') {
      throw validationError(useCase, 'déjà membre', {
        email: 'cette personne fait déjà partie de l’équipe PLUKA',
      });
    }
    throw translate(error, useCase, 'équipe', 'invitation refusée');
  }
}

export async function revokeStaffInvitation(
  context: StaffTeamContext,
  input: unknown,
): Promise<void> {
  const useCase = 'revokeStaffInvitation';
  const command = parseCommand(revokeStaffInvitationCommandSchema, input, useCase);

  try {
    await context.repositories.staffTeam.revokeInvitation(command.invitationId);
  } catch (error) {
    throw translate(error, useCase, 'invitation', 'cette invitation est déjà close');
  }
}

export async function changeStaffRole(
  context: StaffTeamContext,
  input: unknown,
): Promise<{ readonly changed: boolean }> {
  const useCase = 'changeStaffRole';
  const command = parseCommand(changeStaffRoleCommandSchema, input, useCase);

  try {
    const changed = await context.repositories.staffTeam.changeRole(
      command.userId,
      command.staffRole,
    );
    return { changed };
  } catch (error) {
    throw translate(error, useCase, 'membre', LAST_SUPER_ADMIN);
  }
}

/** Retire de l'équipe : le compte redevient simple utilisateur. */
export async function removeStaffMember(context: StaffTeamContext, input: unknown): Promise<void> {
  const useCase = 'removeStaffMember';
  const command = parseCommand(removeStaffMemberCommandSchema, input, useCase);

  try {
    await context.repositories.staffTeam.remove(command.userId);
  } catch (error) {
    throw translate(error, useCase, 'membre', LAST_SUPER_ADMIN);
  }
}

export async function previewStaffInvitation(
  context: StaffTeamContext,
  input: unknown,
): Promise<StaffInvitationPreviewRecord> {
  const parsed = staffInvitationTokenSchema.safeParse(input);
  if (!parsed.success) return { state: 'unknown', staffRole: null };

  return context.repositories.staffTeam.previewInvitation(hashInvitationToken(parsed.data.token));
}

/** Le refus d'une invitation acceptée par une autre adresse — §117. */
export const STAFF_OTHER_EMAIL_REASON = 'other_email';

export async function acceptStaffInvitation(
  context: StaffTeamContext,
  input: unknown,
): Promise<{ readonly staffRole: StaffRole }> {
  const useCase = 'acceptStaffInvitation';
  const command = parseCommand(staffInvitationTokenSchema, input, useCase);

  try {
    const role = await context.repositories.staffTeam.acceptInvitation(
      hashInvitationToken(command.token),
    );
    return { staffRole: role };
  } catch (error) {
    if (error instanceof DbError && error.code === 'permission_denied') {
      throw forbiddenError(useCase, { reason: STAFF_OTHER_EMAIL_REASON });
    }
    throw translate(
      error,
      useCase,
      'invitation',
      'cette invitation a expiré ou a déjà été utilisée : demandez-en une nouvelle',
    );
  }
}
