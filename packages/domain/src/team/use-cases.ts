import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  DbError,
  type InvitationPreviewRecord,
  type OrganizationInvitationRecord,
  type OrganizationMemberRecord,
  type OrganizationTeamRepositories,
  type OwnMembershipRecord,
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

/**
 * Équipe d'une organisation — 03_PRIVACY_RLS §3, §15, §114–§118 · migration 0033.
 *
 * QUI GÈRE
 *
 * Un `pluka_admin`, ou un owner de l'organisation. La garde est dans chaque
 * fonction SQL et seulement là — même décision que 0029 : ces use cases ne la
 * redoublent pas. Le même code sert la console d'administration et l'espace
 * organisateur ; c'est la base qui répond selon qui appelle.
 *
 * CE QUE LE DOMAINE AJOUTE
 *
 * - la validation des entrées à la frontière ;
 * - la confirmation explicite du retrait d'un membre ;
 * - le hachage du jeton d'invitation : il arrive en clair depuis l'URL, et
 *   seul son SHA-256 part en base (AGENTS §64) ;
 * - la traduction des refus en erreurs typées, avec le message qui dit quoi
 *   faire — « dernier propriétaire », « autre adresse ».
 */

export interface OrganizationTeamContext {
  readonly repositories: OrganizationTeamRepositories;
  /** Non consulté : la base lit l'acteur dans le jeton (`auth.uid()`). */
  readonly actor: Actor;
}

/** Les quatre rôles de 0001, dans l'ordre d'autorité décroissante. */
export const ORGANIZATION_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;

const uuid = z.string().uuid();
const role = z.enum(ORGANIZATION_ROLES, { error: 'rôle inconnu' });
const confirmed = z.literal(true, { error: 'Cochez la case pour confirmer ce geste.' });

/**
 * Jeton tiré par le worker : 32 octets en base64url, 43 caractères. La forme
 * est vérifiée avant tout appel, pour qu'une URL quelconque ne coûte pas une
 * requête.
 */
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/, { error: 'lien d’invitation invalide' });

export const listOrganizationTeamQuerySchema = z.object({ organizationId: uuid }).strict();

export const inviteOrganizationMemberCommandSchema = z
  .object({
    organizationId: uuid,
    // Nettoyée avant d'être vérifiée : Zod contrôle le format avant `.trim()`.
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email({ error: 'adresse email invalide' })),
    role,
  })
  .strict();

export const revokeOrganizationInvitationCommandSchema = z.object({ invitationId: uuid }).strict();

export const changeOrganizationMemberRoleCommandSchema = z
  .object({ organizationId: uuid, userId: uuid, role })
  .strict();

export const removeOrganizationMemberCommandSchema = z
  .object({ organizationId: uuid, userId: uuid, confirmed })
  .strict();

export const organizationInvitationTokenSchema = z.object({ token }).strict();

export type InviteOrganizationMemberCommand = z.infer<typeof inviteOrganizationMemberCommandSchema>;
export type ChangeOrganizationMemberRoleCommand = z.infer<
  typeof changeOrganizationMemberRoleCommandSchema
>;

/** SHA-256 hexadécimal, la forme de `organization_invitations.token_hash`. */
export function hashInvitationToken(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const LAST_OWNER =
  'l’organisation doit garder au moins un propriétaire : nommez-en un autre avant de changer celui-ci';

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
 * Les organisations de l'acteur — `/org` (05_ROUTES_FLOWS §6.1). Lues sous
 * RLS : la liste ne peut contenir que ses propres appartenances.
 */
export async function listMyOrganizations(
  context: OrganizationTeamContext,
): Promise<readonly OwnMembershipRecord[]> {
  return context.repositories.organizationTeam.listOwnMemberships(context.actor.userId);
}

/**
 * L'organisation d'un espace `/org/[organizationId]`, si l'acteur en est
 * membre. Sinon `not_found` — jamais `forbidden`, qui confirmerait qu'elle
 * existe (03_PRIVACY_RLS §120).
 */
export async function getMyOrganization(
  context: OrganizationTeamContext,
  input: unknown,
): Promise<OwnMembershipRecord> {
  const useCase = 'getMyOrganization';
  const query = parseCommand(listOrganizationTeamQuerySchema, input, useCase);

  const memberships = await listMyOrganizations(context);
  const membership = memberships.find(
    (candidate) => candidate.organizationId === query.organizationId,
  );

  if (membership === undefined) throw notFoundError(useCase, 'organisation');
  return membership;
}

export interface OrganizationTeam {
  readonly members: readonly OrganizationMemberRecord[];
  readonly invitations: readonly OrganizationInvitationRecord[];
}

export async function listOrganizationTeam(
  context: OrganizationTeamContext,
  input: unknown,
): Promise<OrganizationTeam> {
  const useCase = 'listOrganizationTeam';
  const query = parseCommand(listOrganizationTeamQuerySchema, input, useCase);

  try {
    const [members, invitations] = await Promise.all([
      context.repositories.organizationTeam.listMembers(query.organizationId),
      context.repositories.organizationTeam.listInvitations(query.organizationId),
    ]);

    return { members, invitations };
  } catch (error) {
    throw translate(error, useCase, 'organisation', 'lecture refusée');
  }
}

/**
 * Invite une adresse avec un rôle. L'email part du worker ; réinviter la même
 * adresse révoque le lien précédent.
 */
export async function inviteOrganizationMember(
  context: OrganizationTeamContext,
  input: unknown,
): Promise<{ readonly invitationId: string }> {
  const useCase = 'inviteOrganizationMember';
  const command = parseCommand(inviteOrganizationMemberCommandSchema, input, useCase);

  try {
    const invitationId = await context.repositories.organizationTeam.invite(command);
    return { invitationId };
  } catch (error) {
    if (error instanceof DbError && error.code === 'conflict') {
      throw validationError(useCase, 'déjà membre', {
        email: 'cette personne fait déjà partie de l’équipe',
      });
    }

    throw translate(error, useCase, 'organisation', 'invitation refusée');
  }
}

export async function revokeOrganizationInvitation(
  context: OrganizationTeamContext,
  input: unknown,
): Promise<void> {
  const useCase = 'revokeOrganizationInvitation';
  const command = parseCommand(revokeOrganizationInvitationCommandSchema, input, useCase);

  try {
    await context.repositories.organizationTeam.revokeInvitation(command.invitationId);
  } catch (error) {
    throw translate(error, useCase, 'invitation', 'cette invitation est déjà close');
  }
}

/** Rend `changed: false` quand le rôle était déjà celui demandé. */
export async function changeOrganizationMemberRole(
  context: OrganizationTeamContext,
  input: unknown,
): Promise<{ readonly changed: boolean }> {
  const useCase = 'changeOrganizationMemberRole';
  const command = parseCommand(changeOrganizationMemberRoleCommandSchema, input, useCase);

  try {
    const changed = await context.repositories.organizationTeam.changeRole(
      command.organizationId,
      command.userId,
      command.role,
    );
    return { changed };
  } catch (error) {
    throw translate(error, useCase, 'membre', LAST_OWNER);
  }
}

/**
 * Retire un membre. Ses accès cessent à la requête suivante (§114) ; ce qu'il a
 * créé reste à l'organisation (AGENTS §82).
 */
export async function removeOrganizationMember(
  context: OrganizationTeamContext,
  input: unknown,
): Promise<void> {
  const useCase = 'removeOrganizationMember';
  const command = parseCommand(removeOrganizationMemberCommandSchema, input, useCase);

  try {
    await context.repositories.organizationTeam.removeMember(
      command.organizationId,
      command.userId,
    );
  } catch (error) {
    throw translate(error, useCase, 'membre', LAST_OWNER);
  }
}

/**
 * Aperçu d'un lien d'invitation, avant connexion. Un jeton mal formé est un
 * lien inconnu, pas une erreur : la page n'a qu'une chose à dire.
 */
export async function previewOrganizationInvitation(
  context: OrganizationTeamContext,
  input: unknown,
): Promise<InvitationPreviewRecord> {
  const parsed = organizationInvitationTokenSchema.safeParse(input);
  if (!parsed.success) return { state: 'unknown', organizationName: null, role: null };

  return context.repositories.organizationTeam.previewInvitation(
    hashInvitationToken(parsed.data.token),
  );
}

/** Le refus d'une invitation acceptée par une autre adresse — §117. */
export const OTHER_EMAIL_REASON = 'other_email';

/**
 * Accepte une invitation. Exige une session ; l'adresse du compte doit être
 * celle de l'invitation (§117). Le refus `forbidden` porte alors
 * `details.reason = other_email`, sans jamais citer l'adresse attendue.
 */
export async function acceptOrganizationInvitation(
  context: OrganizationTeamContext,
  input: unknown,
): Promise<{ readonly organizationId: string }> {
  const useCase = 'acceptOrganizationInvitation';
  const command = parseCommand(organizationInvitationTokenSchema, input, useCase);

  try {
    const organizationId = await context.repositories.organizationTeam.acceptInvitation(
      hashInvitationToken(command.token),
    );
    return { organizationId };
  } catch (error) {
    if (error instanceof DbError && error.code === 'permission_denied') {
      throw forbiddenError(useCase, { reason: OTHER_EMAIL_REASON });
    }

    throw translate(
      error,
      useCase,
      'invitation',
      'cette invitation a expiré ou a déjà été utilisée : demandez-en une nouvelle',
    );
  }
}
