import type { BetaAccessGrantRecord, EntitlementRecord } from '@pluka/db';

import { requiresParticipantRaceScope, type Capability } from './capabilities.js';
import {
  capabilitiesForRaceScopedBeta,
  capabilitiesForTier,
  isBroaderTier,
  TIERS_BY_PRIORITY,
  type AccessTier,
} from './tiers.js';

/**
 * Resolver d'entitlements — 04_ENTITLEMENTS §16, §18, §19, §20, §90.
 *
 * Tout ce fichier est pur. Les lignes arrivent telles qu'elles sont en base, et
 * l'heure est passée explicitement : §22 fait du contrôle de validité une
 * décision d'horloge serveur, et une horloge implicite la rendrait
 * irreproductible.
 *
 * §5, principe 1 : « les droits sont calculés côté serveur ». Principe 2 :
 * « l'UI ne fait jamais autorité ». Rien de ce qui entre ici ne vient du
 * client — ni un `tier`, ni un `isPremium`, ni un identifiant d'utilisateur
 * (E28).
 */

/** Un droit actif, applicable au scope demandé. */
export interface ActiveGrant {
  readonly tier: AccessTier;
  readonly scope: 'global' | 'participant_race';
  /** Nul pour Free, qui n'a pas de ligne (§8), et pour un grant bêta. */
  readonly entitlementId: string | null;
  readonly capabilities: ReadonlySet<Capability>;
}

export type UnavailableReason = 'wrong_scope' | 'expired' | 'revoked';

/**
 * Un droit qui existe mais ne s'applique pas ici.
 *
 * Sans cette liste, un refus serait toujours `not_entitled`. §18 en veut
 * quatre nuances, et E03 en nomme une : un Race Pass sur une autre course doit
 * répondre `wrong_scope`, pas « pas de droit ». La différence est ce qui permet
 * à l'UI de dire « ce Race Pass couvre une autre épreuve » au lieu de proposer
 * un second achat.
 */
export interface UnavailableGrant {
  readonly tier: AccessTier;
  readonly reason: UnavailableReason;
  readonly capabilities: ReadonlySet<Capability>;
}

/** §90 — vue effective produite par le resolver. */
export interface EntitlementContext {
  readonly userId: string;
  readonly participantRaceId: string | null;
  readonly globalAccess: {
    readonly plus: boolean;
    readonly betaFull: boolean;
  };
  readonly participantRaceAccess: {
    readonly racePass: boolean;
    readonly organizerIncluded: boolean;
    readonly betaFull: boolean;
  };
  readonly effectiveTier: AccessTier;
  readonly sourceEntitlements: readonly string[];
  /** Droits applicables, du plus large au plus étroit (§19). */
  readonly grants: readonly ActiveGrant[];
  readonly unavailable: readonly UnavailableGrant[];
  /** Consommations déjà inscrites au ledger pour ce scope (§33). */
  readonly linkedOutingUsage: number;
  /**
   * Capabilities éteintes par un feature flag — §15.
   *
   * « Une feature doit passer les deux contrôles : feature flag enabled AND
   * entitlement allowed. » Les faire passer par le contexte plutôt que par deux
   * appels séparés met la règle en un seul endroit : un appelant ne peut pas
   * oublier la moitié.
   *
   * L'ensemble est vide aujourd'hui. Aucune capability de §56 ne correspond à
   * un flag de la liste figée de 01_ARCHITECTURE §41 — `repere_pluka`,
   * `race_intelligence`, `community`, `advanced_offline` — dont aucun n'est un
   * droit commercial B2C.
   */
  readonly disabledCapabilities: ReadonlySet<Capability>;
}

/** §18 — le verdict rendu par `can`. */
export type DecisionReason =
  | 'free_included'
  | 'race_pass'
  | 'plus'
  | 'organizer_included'
  | 'beta_access'
  | 'quota_available'
  | 'quota_exceeded'
  | 'not_entitled'
  | 'expired'
  | 'revoked'
  | 'wrong_scope'
  | 'feature_disabled';

export interface EntitlementDecision {
  readonly allowed: boolean;
  readonly reason: DecisionReason;
  readonly sourceEntitlementId: string | null;
  readonly limits?: {
    readonly max: number;
    readonly used: number;
    readonly remaining: number;
  };
}

/**
 * Quota de sorties liées — §27, §28.
 *
 * « Race Pass autorise jusqu'à 2 sorties de préparation liées à la course »,
 * et « Organizer Included suit la même logique ». PLUKA+ n'en a pas (§29).
 */
export const LINKED_OUTING_QUOTA = 2;

/** Capability dont le droit se compte, et non se possède simplement. */
export const QUOTA_CAPABILITY: Capability = 'outing.create_linked';

/** Clé d'usage du ledger — §34. */
export function linkedOutingUsageKey(outingId: string): string {
  return `linked-outing:${outingId}`;
}

type Validity =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: UnavailableReason | 'not_started' };

/**
 * Validité d'un droit à un instant donné — §22, §23, §24.
 *
 * ```text
 * starts_at <= now AND (ends_at is null OR now < ends_at) AND status = active
 * ```
 *
 * La révocation est testée en premier et sur deux signaux : le statut et
 * `revoked_at`. §24 veut qu'une révocation ne puisse pas être contournée, et
 * une ligne dont seule la date de révocation aurait été posée ne doit pas
 * passer pour active.
 *
 * Les dates l'emportent ensuite sur le statut : une ligne encore marquée
 * `active` dont la fenêtre est close est expirée. Le contraire ferait dépendre
 * un droit du passage d'un job de maintenance.
 */
function checkValidity(
  grant: {
    readonly status: EntitlementRecord['status'];
    readonly startsAt: string;
    readonly endsAt: string | null;
    readonly revokedAt: string | null;
  },
  now: Date,
): Validity {
  if (grant.status === 'revoked' || grant.revokedAt !== null) {
    return { ok: false, reason: 'revoked' };
  }

  if (grant.status !== 'active') return { ok: false, reason: 'expired' };

  const instant = now.getTime();
  const startsAt = Date.parse(grant.startsAt);
  if (Number.isNaN(startsAt) || startsAt > instant) return { ok: false, reason: 'not_started' };

  if (grant.endsAt !== null) {
    const endsAt = Date.parse(grant.endsAt);
    if (Number.isNaN(endsAt) || endsAt <= instant) return { ok: false, reason: 'expired' };
  }

  return { ok: true };
}

function tierForKind(kind: EntitlementRecord['kind']): AccessTier {
  if (kind === 'plus') return 'plus';
  if (kind === 'organizer_included') return 'organizer_included';

  return 'race_pass';
}

export interface ResolveContextInput {
  readonly userId: string;
  readonly participantRaceId: string | null;
  readonly entitlements: readonly EntitlementRecord[];
  readonly betaGrants: readonly BetaAccessGrantRecord[];
  readonly linkedOutingUsage: number;
  readonly disabledCapabilities?: ReadonlySet<Capability>;
  readonly now: Date;
}

/**
 * Construit la vue effective d'un utilisateur sur un scope.
 *
 * §20 : « si plusieurs entitlements sont actifs, le user reçoit l'union des
 * droits autorisés ». Les grants ne s'écrasent donc pas — ils s'ajoutent, et
 * §19 ne sert qu'à nommer le plus large (§21) et à choisir la source d'une
 * décision.
 */
export function resolveEntitlementContext(input: ResolveContextInput): EntitlementContext {
  const grants: ActiveGrant[] = [];
  const unavailable: UnavailableGrant[] = [];

  for (const entitlement of input.entitlements) {
    const tier = tierForKind(entitlement.kind);
    const capabilities = capabilitiesForTier(tier);
    const validity = checkValidity(entitlement, input.now);

    if (!validity.ok) {
      // Un droit qui n'a pas encore commencé n'explique aucun refus : il ne
      // s'est rien passé, et §18 n'a pas de mot pour cela.
      if (validity.reason !== 'not_started') {
        unavailable.push({ tier, reason: validity.reason, capabilities });
      }
      continue;
    }

    if (entitlement.scopeType === 'global') {
      grants.push({ tier, scope: 'global', entitlementId: entitlement.id, capabilities });
      continue;
    }

    // §9, §10 : un Race Pass est lié à une participation précise. Il ne
    // s'applique ni à une autre distance, ni à l'édition suivante.
    if (
      input.participantRaceId !== null &&
      entitlement.participantRaceId === input.participantRaceId
    ) {
      grants.push({
        tier,
        scope: 'participant_race',
        entitlementId: entitlement.id,
        capabilities,
      });
      continue;
    }

    unavailable.push({ tier, reason: 'wrong_scope', capabilities });
  }

  for (const beta of input.betaGrants) {
    const validity = checkValidity(beta, input.now);
    // §61 : bêta global vaut PLUKA+, bêta limité à une course vaut Race Pass.
    const capabilities =
      beta.scopeType === 'global' ? capabilitiesForTier('beta') : capabilitiesForRaceScopedBeta();

    if (!validity.ok) {
      if (validity.reason !== 'not_started') {
        unavailable.push({ tier: 'beta', reason: validity.reason, capabilities });
      }
      continue;
    }

    if (beta.scopeType === 'global') {
      grants.push({ tier: 'beta', scope: 'global', entitlementId: null, capabilities });
      continue;
    }

    if (input.participantRaceId !== null && beta.participantRaceId === input.participantRaceId) {
      grants.push({ tier: 'beta', scope: 'participant_race', entitlementId: null, capabilities });
      continue;
    }

    unavailable.push({ tier: 'beta', reason: 'wrong_scope', capabilities });
  }

  // §8 : Free est implicite, et toujours là. Il ferme la liste parce qu'il est
  // le droit le plus étroit, jamais parce qu'il serait un repli en cas d'échec.
  grants.push({
    tier: 'free',
    scope: 'global',
    entitlementId: null,
    capabilities: capabilitiesForTier('free'),
  });

  const byPriority = (
    left: { readonly tier: AccessTier },
    right: { readonly tier: AccessTier },
  ): number => TIERS_BY_PRIORITY.indexOf(left.tier) - TIERS_BY_PRIORITY.indexOf(right.tier);

  grants.sort(byPriority);
  unavailable.sort(byPriority);

  let effectiveTier: AccessTier = 'free';
  for (const grant of grants) {
    if (isBroaderTier(grant.tier, effectiveTier)) effectiveTier = grant.tier;
  }

  const has = (tier: AccessTier, scope: ActiveGrant['scope']): boolean =>
    grants.some((grant) => grant.tier === tier && grant.scope === scope);

  return {
    userId: input.userId,
    participantRaceId: input.participantRaceId,
    globalAccess: { plus: has('plus', 'global'), betaFull: has('beta', 'global') },
    participantRaceAccess: {
      racePass: has('race_pass', 'participant_race'),
      organizerIncluded: has('organizer_included', 'participant_race'),
      betaFull: has('beta', 'participant_race'),
    },
    effectiveTier,
    sourceEntitlements: grants
      .map((grant) => grant.entitlementId)
      .filter((id): id is string => id !== null),
    grants,
    unavailable,
    linkedOutingUsage: input.linkedOutingUsage,
    disabledCapabilities: input.disabledCapabilities ?? new Set<Capability>(),
  };
}

const REASON_BY_TIER: Readonly<Record<AccessTier, DecisionReason>> = {
  free: 'free_included',
  race_pass: 'race_pass',
  organizer_included: 'organizer_included',
  plus: 'plus',
  beta: 'beta_access',
};

function deny(reason: DecisionReason): EntitlementDecision {
  return { allowed: false, reason, sourceEntitlementId: null };
}

/**
 * Refus expliqué par un droit qui existe ailleurs — §18.
 *
 * Parcouru dans l'ordre de priorité : si l'utilisateur possède un PLUKA+
 * expiré et un Race Pass sur une autre course, c'est le PLUKA+ qu'on lui
 * nomme, parce que c'est le droit le plus large qui aurait couvert son geste.
 */
function explainAbsence(context: EntitlementContext, capability: Capability): EntitlementDecision {
  const blocking = context.unavailable.find((grant) => grant.capabilities.has(capability));

  return deny(blocking?.reason ?? 'not_entitled');
}

/**
 * Quota de sorties liées — §27 à §34, §110.
 *
 * PLUKA+ n'a pas de quota commercial (§29) : la décision n'expose alors aucune
 * limite, parce qu'il n'y en a pas à afficher.
 *
 * L'accès bêta non plus — §57, « Décisions de complétion » : §29 pose le quota
 * comme une règle *commerciale* et §14 fait de la bêta un override temporaire.
 * Le modèle le confirme, `entitlement_usage.entitlement_id` référençant une
 * table où un grant bêta n'a par construction aucune ligne (02_DATA_MODEL
 * §10.2).
 */
function decideLinkedOuting(
  context: EntitlementContext,
  granting: ActiveGrant,
): EntitlementDecision {
  const unlimited = granting.tier === 'plus' || granting.tier === 'beta';

  if (unlimited) {
    return {
      allowed: true,
      reason: REASON_BY_TIER[granting.tier],
      sourceEntitlementId: granting.entitlementId,
    };
  }

  const used = context.linkedOutingUsage;
  const remaining = Math.max(0, LINKED_OUTING_QUOTA - used);
  const limits = { max: LINKED_OUTING_QUOTA, used, remaining };

  if (remaining === 0) {
    return { allowed: false, reason: 'quota_exceeded', sourceEntitlementId: null, limits };
  }

  return {
    allowed: true,
    reason: 'quota_available',
    sourceEntitlementId: granting.entitlementId,
    limits,
  };
}

/**
 * Décide d'une capability — §16, `can(context, capability)`.
 *
 * Synchrone et pure : tout ce dont elle a besoin — droits, usage, flags — a été
 * rassemblé par `resolveEntitlementContext`. C'est ce qui permet de l'appeler
 * plusieurs fois pour construire un écran sans multiplier les requêtes, et de
 * la tester sans base.
 *
 * L'ordre des refus est délibéré. Le feature flag passe avant tout : §15 sépare
 * « cette fonctionnalité existe-t-elle dans cette release ? » de « cet
 * utilisateur a-t-il le droit de l'utiliser ? », et proposer un achat pour une
 * fonctionnalité qui n'existe pas serait une promesse en l'air (AGENTS §47).
 */
export function can(context: EntitlementContext, capability: Capability): EntitlementDecision {
  if (context.disabledCapabilities.has(capability)) return deny('feature_disabled');

  // §9 : un droit de course sans course désigné n'a pas de réponse possible.
  if (requiresParticipantRaceScope(capability) && context.participantRaceId === null) {
    return deny('wrong_scope');
  }

  const granting = context.grants.find((grant) => grant.capabilities.has(capability));
  if (granting === undefined) return explainAbsence(context, capability);

  if (capability === QUOTA_CAPABILITY) return decideLinkedOuting(context, granting);

  return {
    allowed: true,
    reason: REASON_BY_TIER[granting.tier],
    sourceEntitlementId: granting.entitlementId,
  };
}
