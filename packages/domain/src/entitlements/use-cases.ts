import { z } from 'zod';
import type { EntitlementRepositories } from '@pluka/db';

import type { Actor } from '../authorization/organization-role.js';
import { notFoundError } from '../errors.js';
import { CAPABILITIES, type Capability } from './capabilities.js';
import { EntitlementError } from './errors.js';
import {
  can,
  linkedOutingUsageKey,
  QUOTA_CAPABILITY,
  resolveEntitlementContext,
  type EntitlementContext,
  type EntitlementDecision,
} from './resolver.js';

/**
 * EntitlementService — 04_ENTITLEMENTS §16.
 *
 * « Créer un service central. » C'est le seul endroit du produit où l'on décide
 * si un droit commercial autorise un geste. §5, principe 1 : « les droits sont
 * calculés côté serveur » ; principe 13 : « le serveur revérifie l'entitlement à
 * chaque mutation premium ».
 *
 * PRIVACY D'ABORD
 *
 * Toute lecture scopée vérifie d'abord que la participation appartient à
 * l'acteur, et répond « introuvable » sinon. 03_PRIVACY_RLS §24 : « un
 * entitlement ne peut jamais outrepasser la Privacy. Vérifier l'accès à la
 * donnée avant d'afficher un message d'upgrade. » Sans cette garde, demander
 * les droits sur la participation d'un inconnu renverrait un refus commercial —
 * donc l'aveu que l'objet existe, et une invitation à l'acheter (E29).
 *
 * AUCUN PAIEMENT ICI
 *
 * Ce lot lit des droits et consomme un quota. Il n'en crée aucun : le pipeline
 * de §25 — checkout, webhook vérifié, purchase, entitlement — appartient au lot
 * Billing, et §3 rappelle que « le provider de paiement n'est pas la source
 * directe de vérité applicative ».
 */
export interface EntitlementServiceContext {
  readonly repositories: EntitlementRepositories;
  readonly actor: Actor;
  /**
   * Horloge serveur — §22, « le contrôle utilise l'heure serveur ».
   *
   * Injectée, jamais implicite : une expiration doit être rejouable à
   * l'identique en test comme en incident (AGENTS §35).
   */
  readonly now: () => Date;
  /**
   * Capabilities éteintes par un feature flag de cette release — §15.
   *
   * Dérivée par l'appelant à partir de `@pluka/config`, et non lue ici : le
   * domaine ne touche pas l'environnement (01_ARCHITECTURE §4.5).
   */
  readonly disabledCapabilities?: ReadonlySet<Capability>;
}

const uuid = z.uuid();

export const resolveEntitlementsQuerySchema = z
  .object({ participantRaceId: uuid.nullable().default(null) })
  .strict();

export type ResolveEntitlementsQuery = z.infer<typeof resolveEntitlementsQuerySchema>;

export const authorizeCapabilityCommandSchema = z
  .object({
    capability: z.enum(CAPABILITIES),
    participantRaceId: uuid.nullable().default(null),
  })
  .strict();

export type AuthorizeCapabilityCommand = z.infer<typeof authorizeCapabilityCommandSchema>;

export const consumeLinkedOutingQuotaCommandSchema = z
  .object({ participantRaceId: uuid, outingId: uuid })
  .strict();

export type ConsumeLinkedOutingQuotaCommand = z.infer<typeof consumeLinkedOutingQuotaCommandSchema>;

/**
 * Garde de confidentialité, exécutée avant toute question commerciale.
 *
 * Le silence est le même que partout ailleurs : une participation qui n'est pas
 * la sienne est « introuvable », jamais « interdite » (03_PRIVACY_RLS §120).
 */
async function assertOwnParticipation(
  context: EntitlementServiceContext,
  participantRaceId: string,
  useCase: string,
): Promise<void> {
  const participation = await context.repositories.participantRaces.findById(participantRaceId);

  if (participation === null || participation.userId !== context.actor.userId) {
    throw notFoundError(useCase, 'participation');
  }
}

async function loadContext(
  context: EntitlementServiceContext,
  participantRaceId: string | null,
  useCase: string,
): Promise<EntitlementContext> {
  if (participantRaceId !== null) {
    await assertOwnParticipation(context, participantRaceId, useCase);
  }

  const [entitlements, betaGrants, linkedOutingUsage] = await Promise.all([
    context.repositories.entitlements.listByUser(context.actor.userId),
    context.repositories.entitlements.listBetaGrantsByUser(context.actor.userId),
    participantRaceId === null
      ? Promise.resolve(0)
      : context.repositories.entitlements.countUsage(
          context.actor.userId,
          QUOTA_CAPABILITY,
          participantRaceId,
        ),
  ]);

  return resolveEntitlementContext({
    userId: context.actor.userId,
    participantRaceId,
    entitlements,
    betaGrants,
    linkedOutingUsage,
    ...(context.disabledCapabilities === undefined
      ? {}
      : { disabledCapabilities: context.disabledCapabilities }),
    now: context.now(),
  });
}

/**
 * `resolveContext` de §16 — la vue effective d'un utilisateur sur un scope.
 *
 * Destinée à construire un écran : l'appelant obtient un contexte, puis
 * interroge `can` autant de fois qu'il a de décisions à prendre, sans
 * multiplier les requêtes. §92 rappelle la limite de cette commodité — le
 * client « ne peut jamais considérer ce cache comme autorisation serveur ».
 */
export async function resolveEntitlements(
  context: EntitlementServiceContext,
  input: unknown = {},
): Promise<EntitlementContext> {
  const useCase = 'resolveEntitlements';
  const query = resolveEntitlementsQuerySchema.parse(input);

  return loadContext(context, query.participantRaceId, useCase);
}

/**
 * Garde de mutation premium — §5, principe 13.
 *
 * Rend la décision quand elle autorise, lève une `EntitlementError` sinon. Le
 * refus porte son motif : §78 veut qu'un paywall reçoive « reason, upgrade
 * target, contexte » plutôt que de recalculer les droits.
 *
 * Le contexte est relu à chaque appel. §91 : « une mutation sensible doit
 * revérifier les droits depuis une source suffisamment fraîche » — une
 * révocation ne doit pas survivre dans un contexte gardé en mémoire.
 */
export async function authorizeCapability(
  context: EntitlementServiceContext,
  input: unknown,
): Promise<EntitlementDecision> {
  const useCase = 'authorizeCapability';
  const command = authorizeCapabilityCommandSchema.parse(input);

  const resolved = await loadContext(context, command.participantRaceId, useCase);
  const decision = can(resolved, command.capability);

  if (!decision.allowed) throw new EntitlementError(command.capability, decision);

  return decision;
}

/**
 * Consomme un usage de sortie liée — §27 à §34.
 *
 * Le quota est vérifié puis inscrit au ledger, jamais déduit d'un compteur
 * mutable (§31). `usageKey` porte l'idempotence : « linked-outing:{outingId} »
 * (§34), et l'unicité en base fait foi — deux appels pour la même sortie ne
 * consomment qu'une fois (E14 en dépend, tout comme un rejeu de worker).
 *
 * Sans quota applicable — PLUKA+, bêta — rien n'est inscrit : il n'y a pas de
 * compteur commercial à tenir (§29).
 *
 * La création de la sortie elle-même appartient au lot Sorties. Ce use case est
 * la moitié commerciale de l'opération, et il est délibérément appelable seul :
 * §43, « le moteur reçoit une commande déjà autorisée ».
 */
export async function consumeLinkedOutingQuota(
  context: EntitlementServiceContext,
  input: unknown,
): Promise<EntitlementDecision> {
  const useCase = 'consumeLinkedOutingQuota';
  const command = consumeLinkedOutingQuotaCommandSchema.parse(input);

  const resolved = await loadContext(context, command.participantRaceId, useCase);
  const decision = can(resolved, QUOTA_CAPABILITY);

  if (!decision.allowed) throw new EntitlementError(QUOTA_CAPABILITY, decision);

  // Pas de limite à tenir : rien à inscrire.
  if (decision.limits === undefined) return decision;

  const consumed = await context.repositories.entitlements.recordUsage({
    userId: context.actor.userId,
    // `sourceEntitlementId` n'est nul que pour Free et bêta, et ni l'un ni
    // l'autre n'atteint cette ligne : Free n'autorise pas la capability, bêta
    // n'a pas de limite.
    entitlementId: decision.sourceEntitlementId as string,
    capability: QUOTA_CAPABILITY,
    participantRaceId: command.participantRaceId,
    outingId: command.outingId,
    usageKey: linkedOutingUsageKey(command.outingId),
  });

  // Rejeu : le ledger portait déjà cette sortie, le décompte ne bouge pas.
  const used = consumed ? decision.limits.used + 1 : decision.limits.used;

  return {
    ...decision,
    limits: {
      max: decision.limits.max,
      used,
      remaining: Math.max(0, decision.limits.max - used),
    },
  };
}
