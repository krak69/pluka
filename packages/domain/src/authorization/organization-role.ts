import type { IdentityRepository } from '@pluka/db';

import { forbiddenError } from '../errors.js';

/**
 * Hiérarchie des rôles organisation — 03_PRIVACY_RLS §111.
 *
 * L'ordre de l'enum PostgreSQL (owner, admin, editor, viewer) est l'inverse
 * de la hiérarchie : s'y fier donnerait des droits à l'envers. Le rang est
 * donc explicite, comme dans `private.org_role_rank`. La duplication
 * SQL / TypeScript est assumée : la RLS protège la donnée, le use case
 * protège l'opération, et aucune des deux ne délègue à l'autre.
 */
export const ORGANIZATION_ROLE_RANK = {
  viewer: 10,
  editor: 20,
  admin: 30,
  owner: 40,
} as const;

export type OrganizationRole = keyof typeof ORGANIZATION_ROLE_RANK;

export function hasOrganizationRole(actual: OrganizationRole, minimum: OrganizationRole): boolean {
  return ORGANIZATION_ROLE_RANK[actual] >= ORGANIZATION_ROLE_RANK[minimum];
}

/**
 * Dépendance minimale des gardes d'autorisation.
 *
 * Structurelle plutôt que nominale : tout bundle de repositories portant une
 * identité — course, participation — passe ici sans que la garde ait à
 * connaître le lot qui l'appelle. Elle n'a besoin que de relire un rôle.
 */
export interface AuthorizationRepositories {
  readonly identity: IdentityRepository;
}

/**
 * Identité de l'acteur.
 *
 * Un identifiant, rien d'autre. Aucun rôle n'y figure : les rôles sont relus
 * en base à chaque commande, jamais déclarés par l'appelant
 * (03_PRIVACY_RLS §11, §178). Ajouter un champ `role` ici serait rouvrir
 * exactement la porte que cette règle ferme.
 */
export interface Actor {
  readonly userId: string;
}

/**
 * Autorité effective sur une organisation, telle que la base la connaît.
 *
 * `pluka_admin` administre la base courses (00_PRODUCT_SPEC §3.5). C'est
 * aussi la seule autorité possible sur un événement sans organisation
 * gestionnaire (§4.1).
 */
export type Authority =
  | { readonly kind: 'platform_admin' }
  | { readonly kind: 'organization_member'; readonly role: OrganizationRole };

/**
 * Résout l'autorité d'un acteur, par deux lectures en base.
 *
 * Le rôle plateforme est interrogé en premier : un `pluka_admin` est autorisé
 * même sans appartenance, et notamment sur un événement dont
 * `organizationId` est nul.
 */
export async function resolveAuthority(
  repositories: AuthorizationRepositories,
  actor: Actor,
  organizationId: string | null,
): Promise<Authority | null> {
  const identity = await repositories.identity.findPlatformIdentity(actor.userId);
  if (identity?.platformRole === 'pluka_admin') return { kind: 'platform_admin' };

  if (organizationId === null) return null;

  const membership = await repositories.identity.findMembership(actor.userId, organizationId);
  if (membership === null) return null;

  return { kind: 'organization_member', role: membership.role };
}

/**
 * Garde d'écriture.
 *
 * Le serveur revérifie toujours : la RLS peut être contournée par une clé de
 * service, et un use case ne doit jamais s'appuyer sur elle comme unique
 * barrière (03_PRIVACY_RLS §8).
 */
export async function assertOrganizationRole(
  repositories: AuthorizationRepositories,
  actor: Actor,
  organizationId: string | null,
  minimum: OrganizationRole,
  useCase: string,
): Promise<Authority> {
  const authority = await resolveAuthority(repositories, actor, organizationId);

  if (authority === null) throw forbiddenError(useCase);
  if (authority.kind === 'platform_admin') return authority;
  if (!hasOrganizationRole(authority.role, minimum)) throw forbiddenError(useCase);

  return authority;
}

/** Garde des transitions que §4.1 réserve à `pluka_admin`. */
export async function assertPlatformAdmin(
  repositories: AuthorizationRepositories,
  actor: Actor,
  useCase: string,
): Promise<Authority> {
  const identity = await repositories.identity.findPlatformIdentity(actor.userId);
  if (identity?.platformRole !== 'pluka_admin') throw forbiddenError(useCase);

  return { kind: 'platform_admin' };
}
