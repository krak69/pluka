import { DbError, mapPostgrestError, type PostgrestLikeError } from '../errors.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import type { Enum, PlukaClient } from '../types.js';

/*
 * Repository de l'équipe PLUKA — migrations 0035 et 0036.
 *
 * Toutes les fonctions appelées portent leur garde : `super_admin` pour gérer
 * l'équipe, la session elle-même pour `my_staff_role`, aucune pour l'aperçu
 * d'un lien d'invitation. Le jeton n'entre ici que haché.
 */

export type StaffRole = Enum<'staff_role'>;

export interface StaffMemberRecord {
  readonly userId: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly staffRole: StaffRole;
  readonly createdAt: string;
}

export interface StaffInvitationRecord {
  readonly invitationId: string;
  readonly email: string;
  readonly staffRole: StaffRole;
  readonly status: Enum<'invitation_status'>;
  readonly sendFailed: boolean;
  readonly expiresAt: string;
  readonly sentAt: string | null;
  readonly createdAt: string;
}

export type StaffInvitationPreviewState = 'valid' | 'expired' | 'closed' | 'unknown';

export interface StaffInvitationPreviewRecord {
  readonly state: StaffInvitationPreviewState;
  readonly staffRole: StaffRole | null;
}

export interface StaffTeamRepository {
  /** Rôle de la session dans l'équipe PLUKA, ou `null`. Pour l'interface, jamais pour autoriser. */
  myStaffRole(): Promise<StaffRole | null>;
  listMembers(): Promise<readonly StaffMemberRecord[]>;
  listInvitations(): Promise<readonly StaffInvitationRecord[]>;
  /** `conflict` : l'adresse est déjà dans l'équipe. */
  invite(email: string, staffRole: StaffRole): Promise<string>;
  revokeInvitation(invitationId: string): Promise<void>;
  /** `false` quand le rôle était déjà celui-là. */
  changeRole(userId: string, staffRole: StaffRole): Promise<boolean>;
  remove(userId: string): Promise<void>;
  previewInvitation(tokenHash: string): Promise<StaffInvitationPreviewRecord>;
  /** Rend le rôle effectif après acceptation. */
  acceptInvitation(tokenHash: string): Promise<StaffRole>;
}

interface RpcCapableClient {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

async function invoke(
  client: PlukaClient,
  operation: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const result = await (client as unknown as RpcCapableClient).rpc(operation, args);

  if (result.error !== null && result.error !== undefined) {
    throw mapPostgrestError(result.error as PostgrestLikeError, operation);
  }

  return result.data;
}

function unexpected(operation: string, message: string): DbError {
  return new DbError({ code: 'unknown', operation, message });
}

function rows(data: unknown, operation: string): readonly Record<string, unknown>[] {
  if (!Array.isArray(data)) throw unexpected(operation, 'la fonction devait rendre des lignes');
  return data as readonly Record<string, unknown>[];
}

function text(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

function requiredText(row: Record<string, unknown>, key: string, operation: string): string {
  const value = text(row, key);
  if (value === null) throw unexpected(operation, `colonne ${key} absente ou non textuelle`);
  return value;
}

const STAFF_ROLES: readonly StaffRole[] = ['super_admin', 'admin', 'support'];

function staffRoleOf(value: unknown, operation: string): StaffRole {
  if (typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value)) {
    return value as StaffRole;
  }
  throw unexpected(operation, 'rôle d’équipe inconnu');
}

const PREVIEW_STATES: readonly StaffInvitationPreviewState[] = [
  'valid',
  'expired',
  'closed',
  'unknown',
];

export const staffTeamRepository = defineRepository<StaffTeamRepository>((context) => ({
  async myStaffRole() {
    const operation = 'my_staff_role';
    const data = await invoke(context.client, operation);
    return data === null || data === undefined ? null : staffRoleOf(data, operation);
  },

  async listMembers() {
    const operation = 'staff_list_members';
    return rows(await invoke(context.client, operation), operation).map((row) => ({
      userId: requiredText(row, 'user_id', operation),
      email: requiredText(row, 'email', operation),
      firstName: text(row, 'first_name'),
      lastName: text(row, 'last_name'),
      staffRole: staffRoleOf(row['staff_role'], operation),
      createdAt: requiredText(row, 'created_at', operation),
    }));
  },

  async listInvitations() {
    const operation = 'staff_list_invitations';
    return rows(await invoke(context.client, operation), operation).map((row) => ({
      invitationId: requiredText(row, 'invitation_id', operation),
      email: requiredText(row, 'email', operation),
      staffRole: staffRoleOf(row['staff_role'], operation),
      status: requiredText(row, 'status', operation) as Enum<'invitation_status'>,
      sendFailed: row['send_failed'] === true,
      expiresAt: requiredText(row, 'expires_at', operation),
      sentAt: text(row, 'sent_at'),
      createdAt: requiredText(row, 'created_at', operation),
    }));
  },

  async invite(email, staffRole) {
    const operation = 'staff_invite';
    const data = await invoke(context.client, operation, {
      p_email: email,
      p_staff_role: staffRole,
    });
    if (typeof data !== 'string') throw unexpected(operation, 'la fonction devait rendre un uuid');
    return data;
  },

  async revokeInvitation(invitationId) {
    await invoke(context.client, 'staff_revoke_invitation', { p_invitation_id: invitationId });
  },

  async changeRole(userId, staffRole) {
    const operation = 'staff_change_role';
    const data = await invoke(context.client, operation, {
      p_user_id: userId,
      p_staff_role: staffRole,
    });
    if (typeof data !== 'boolean')
      throw unexpected(operation, 'la fonction devait rendre un booléen');
    return data;
  },

  async remove(userId) {
    await invoke(context.client, 'staff_remove', { p_user_id: userId });
  },

  async previewInvitation(tokenHash) {
    const operation = 'preview_staff_invitation';
    const row = rows(
      await invoke(context.client, operation, { p_token_hash: tokenHash }),
      operation,
    )[0];

    if (row === undefined) return { state: 'unknown', staffRole: null };

    const state = text(row, 'state');
    if (state === null || !(PREVIEW_STATES as readonly string[]).includes(state)) {
      throw unexpected(operation, 'état d’invitation inconnu');
    }

    return {
      state: state as StaffInvitationPreviewState,
      staffRole: row['staff_role'] === null ? null : staffRoleOf(row['staff_role'], operation),
    };
  },

  async acceptInvitation(tokenHash) {
    const operation = 'accept_staff_invitation';
    return staffRoleOf(
      await invoke(context.client, operation, { p_token_hash: tokenHash }),
      operation,
    );
  },
}));

export interface StaffTeamRepositories {
  readonly staffTeam: StaffTeamRepository;
}

export function createStaffTeamRepositories(context: RepositoryContext): StaffTeamRepositories {
  return { staffTeam: staffTeamRepository(context) };
}
