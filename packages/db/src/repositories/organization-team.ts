import { selectColumns } from '../columns.js';
import { DbError, mapPostgrestError, type PostgrestLikeError } from '../errors.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrap } from '../results.js';
import type { Enum, PlukaClient } from '../types.js';

/*
 * Repository de l'équipe d'une organisation — migration 0033.
 *
 * Toutes les fonctions SQL appelées ici portent leur garde : un `pluka_admin`
 * ou un owner de l'organisation, relu dans le jeton (`auth.uid()`). Ce
 * repository ne décide donc rien ; le même code sert la console
 * d'administration et l'espace organisateur, et c'est la base qui répond
 * différemment selon qui appelle.
 *
 * Le jeton d'invitation n'entre ici que haché : c'est le domaine qui le
 * hache, la base n'en voit jamais la valeur en clair.
 */

export type OrganizationRole = Enum<'organization_member_role'>;

export interface OrganizationMemberRecord {
  readonly userId: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly role: OrganizationRole;
  readonly joinedAt: string;
}

export interface OrganizationInvitationRecord {
  readonly invitationId: string;
  readonly email: string;
  readonly role: OrganizationRole;
  /** `expired` est calculé à la lecture pour une invitation dont la date est passée. */
  readonly status: Enum<'invitation_status'>;
  /** Le dernier envoi a échoué et l'email n'est pas parti. */
  readonly sendFailed: boolean;
  readonly expiresAt: string;
  readonly sentAt: string | null;
  readonly createdAt: string;
}

export type InvitationPreviewState = 'valid' | 'expired' | 'closed' | 'unknown';

export interface InvitationPreviewRecord {
  readonly state: InvitationPreviewState;
  readonly organizationName: string | null;
  readonly role: OrganizationRole | null;
}

/** Une organisation dont l'utilisateur est membre, avec son rôle. */
export interface OwnMembershipRecord {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly role: OrganizationRole;
}

export interface InviteMemberInput {
  readonly organizationId: string;
  readonly email: string;
  readonly role: OrganizationRole;
}

export interface OrganizationTeamRepository {
  /**
   * Les organisations de l'utilisateur, lues sous RLS : `organization_members`
   * n'ouvre que ses propres lignes (§15), `organizations` celles dont il est
   * membre. Aucune fonction privilégiée.
   */
  listOwnMemberships(userId: string): Promise<readonly OwnMembershipRecord[]>;
  listMembers(organizationId: string): Promise<readonly OrganizationMemberRecord[]>;
  listInvitations(organizationId: string): Promise<readonly OrganizationInvitationRecord[]>;
  /** Rend l'identifiant de l'invitation. `conflict` : l'adresse est déjà membre. */
  invite(input: InviteMemberInput): Promise<string>;
  revokeInvitation(invitationId: string): Promise<void>;
  /** Rend `false` quand le rôle était déjà celui demandé. */
  changeRole(organizationId: string, userId: string, role: OrganizationRole): Promise<boolean>;
  removeMember(organizationId: string, userId: string): Promise<void>;
  previewInvitation(tokenHash: string): Promise<InvitationPreviewRecord>;
  /** Rend l'organisation rejointe. */
  acceptInvitation(tokenHash: string): Promise<string>;
}

interface RpcCapableClient {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

async function invoke(
  client: PlukaClient,
  operation: string,
  args: Record<string, unknown>,
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

function uuidResult(data: unknown, operation: string): string {
  if (typeof data !== 'string') throw unexpected(operation, 'la fonction devait rendre un uuid');
  return data;
}

const PREVIEW_STATES: readonly InvitationPreviewState[] = ['valid', 'expired', 'closed', 'unknown'];

function isPreviewState(value: string | null): value is InvitationPreviewState {
  return value !== null && (PREVIEW_STATES as readonly string[]).includes(value);
}

export const organizationTeamRepository = defineRepository<OrganizationTeamRepository>(
  (context) => ({
    async listOwnMemberships(userId) {
      const memberships = unwrap(
        await context.client
          .from('organization_members')
          .select(selectColumns('organization_members', ['organization_id', 'role']))
          .eq('user_id', userId),
        'organization_members.listOwn',
      );

      if (memberships.length === 0) return [];

      const organizations = unwrap(
        await context.client
          .from('organizations')
          .select(selectColumns('organizations', ['id', 'name']))
          .in(
            'id',
            memberships.map((membership) => membership.organization_id),
          ),
        'organizations.listOwn',
      );

      const names = new Map(
        organizations.map((organization) => [organization.id, organization.name]),
      );

      return memberships
        .flatMap((membership) => {
          const name = names.get(membership.organization_id);
          return name === undefined
            ? []
            : [
                {
                  organizationId: membership.organization_id,
                  organizationName: name,
                  role: membership.role,
                },
              ];
        })
        .sort((left, right) => left.organizationName.localeCompare(right.organizationName, 'fr'));
    },

    async listMembers(organizationId) {
      const operation = 'org_list_members';
      const data = rows(
        await invoke(context.client, operation, { p_organization_id: organizationId }),
        operation,
      );

      return data.map((row) => ({
        userId: requiredText(row, 'user_id', operation),
        email: requiredText(row, 'email', operation),
        firstName: text(row, 'first_name'),
        lastName: text(row, 'last_name'),
        role: requiredText(row, 'role', operation) as OrganizationRole,
        joinedAt: requiredText(row, 'joined_at', operation),
      }));
    },

    async listInvitations(organizationId) {
      const operation = 'org_list_invitations';
      const data = rows(
        await invoke(context.client, operation, { p_organization_id: organizationId }),
        operation,
      );

      return data.map((row) => ({
        invitationId: requiredText(row, 'invitation_id', operation),
        email: requiredText(row, 'email', operation),
        role: requiredText(row, 'role', operation) as OrganizationRole,
        status: requiredText(row, 'status', operation) as Enum<'invitation_status'>,
        sendFailed: row['send_failed'] === true,
        expiresAt: requiredText(row, 'expires_at', operation),
        sentAt: text(row, 'sent_at'),
        createdAt: requiredText(row, 'created_at', operation),
      }));
    },

    async invite(input) {
      const operation = 'org_invite_member';
      return uuidResult(
        await invoke(context.client, operation, {
          p_organization_id: input.organizationId,
          p_email: input.email,
          p_role: input.role,
        }),
        operation,
      );
    },

    async revokeInvitation(invitationId) {
      await invoke(context.client, 'org_revoke_invitation', { p_invitation_id: invitationId });
    },

    async changeRole(organizationId, userId, role) {
      const operation = 'org_change_member_role';
      const data = await invoke(context.client, operation, {
        p_organization_id: organizationId,
        p_user_id: userId,
        p_role: role,
      });

      if (typeof data !== 'boolean') {
        throw unexpected(operation, 'la fonction devait rendre un booléen');
      }

      return data;
    },

    async removeMember(organizationId, userId) {
      await invoke(context.client, 'org_remove_member', {
        p_organization_id: organizationId,
        p_user_id: userId,
      });
    },

    async previewInvitation(tokenHash) {
      const operation = 'preview_organization_invitation';
      const row = rows(
        await invoke(context.client, operation, { p_token_hash: tokenHash }),
        operation,
      )[0];

      if (row === undefined) return { state: 'unknown', organizationName: null, role: null };

      const state = text(row, 'state');
      if (!isPreviewState(state)) throw unexpected(operation, 'état d’invitation inconnu');

      return {
        state,
        organizationName: text(row, 'organization_name'),
        role: text(row, 'role') as OrganizationRole | null,
      };
    },

    async acceptInvitation(tokenHash) {
      const operation = 'accept_organization_invitation';
      return uuidResult(
        await invoke(context.client, operation, { p_token_hash: tokenHash }),
        operation,
      );
    },
  }),
);

export interface OrganizationTeamRepositories {
  readonly organizationTeam: OrganizationTeamRepository;
}

export function createOrganizationTeamRepositories(
  context: RepositoryContext,
): OrganizationTeamRepositories {
  return { organizationTeam: organizationTeamRepository(context) };
}
