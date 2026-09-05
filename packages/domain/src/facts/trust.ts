import type { FactRepositories } from '@pluka/db';

import {
  hasOrganizationRole,
  type Actor,
  type OrganizationRole,
} from '../authorization/organization-role.js';

/**
 * Qui peut conférer quel niveau de confiance — SOURCES_EXTRACTION §4, §32.
 *
 * §32 : « seule une organisation autorisée peut conférer le niveau Officielle
 * à une information de sa course. PLUKA peut publier : Validée PLUKA, mais pas
 * se substituer silencieusement à l'organisateur pour qualifier une décision
 * d'"Officielle". »
 *
 * §4.2 dit la règle dans l'autre sens : « Validée PLUKA » est une vérification
 * faite *par PLUKA*. Une organisation qualifie ses informations d'officielles,
 * elle ne se décerne pas le label d'un tiers.
 *
 * Cette duplication du trigger de la migration 0012 est assumée, comme celle
 * des rôles : la base protège la donnée, le use case protège l'opération, et
 * aucune des deux ne délègue à l'autre (03_PRIVACY_RLS §8).
 */

/** Rôle minimum pour publier, aligné sur les policies d'écriture de 0005. */
export const MIN_PUBLISH_ROLE: OrganizationRole = 'editor';

/**
 * Autorité de publication.
 *
 * Les deux appartenances sont portées ensemble plutôt que départagées par une
 * précédence : un admin PLUKA *qui est aussi* éditeur de l'organisation publie
 * une information officielle au titre de son appartenance, et §32 est
 * respecté. Choisir l'une des deux le priverait à tort de ce droit.
 */
export interface PublicationAuthority {
  readonly isPlatformAdmin: boolean;
  readonly organizationRole: OrganizationRole | null;
}

/** Résout l'autorité par deux lectures en base — jamais depuis l'appelant (§178). */
export async function resolvePublicationAuthority(
  repositories: FactRepositories,
  actor: Actor,
  organizationId: string | null,
): Promise<PublicationAuthority> {
  const identity = await repositories.identity.findPlatformIdentity(actor.userId);

  const membership =
    organizationId === null
      ? null
      : await repositories.identity.findMembership(actor.userId, organizationId);

  return {
    isPlatformAdmin: identity?.platformRole === 'pluka_admin',
    organizationRole: membership?.role ?? null,
  };
}

/** Autorité suffisante pour agir en revue — §30. */
export function canReviewFacts(authority: PublicationAuthority): boolean {
  return (
    authority.isPlatformAdmin ||
    (authority.organizationRole !== null &&
      hasOrganizationRole(authority.organizationRole, MIN_PUBLISH_ROLE))
  );
}

export type TrustLevelRefusal = 'OFFICIAL_AUTHORIZATION_REQUIRED' | 'PLUKA_VALIDATION_REQUIRED';

/**
 * Peut-on conférer ce niveau ?
 *
 * Rend le code de refus de §62 plutôt qu'un booléen : « interdit » ne dit pas
 * au relecteur qu'il lui manque une appartenance à l'organisation.
 */
export function refusalForTrustLevel(
  authority: PublicationAuthority,
  trustLevel: 'official' | 'pluka_validated',
): TrustLevelRefusal | null {
  if (trustLevel === 'official') {
    const member =
      authority.organizationRole !== null &&
      hasOrganizationRole(authority.organizationRole, MIN_PUBLISH_ROLE);

    // Un admin PLUKA membre de l'organisation le peut — c'est alors
    // l'organisation qui publie, par une personne qui la représente. Un admin
    // PLUKA qui n'en est pas membre, non : ce serait exactement la
    // substitution silencieuse que §32 refuse.
    return member ? null : 'OFFICIAL_AUTHORIZATION_REQUIRED';
  }

  return authority.isPlatformAdmin ? null : 'PLUKA_VALIDATION_REQUIRED';
}
