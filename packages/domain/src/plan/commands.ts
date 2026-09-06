import { z } from 'zod';

/**
 * Commandes du Plan — docs/engines/PLAN_ENGINE.md §63.
 *
 * « La couche domaine peut exposer : generateRacePlan, changePlanTarget,
 * updatePlanSegmentDuration, removePlanSegmentOverride, updatePlanStop,
 * lockPlanWaypoint, unlockPlanWaypoint, rebalancePlanToTarget,
 * preserveCurrentPlan, resetPlanScope. »
 *
 * Aucune ne porte la configuration du moteur. §14 : « le client ne peut jamais
 * fournir cette configuration arbitrairement. La version est choisie côté
 * serveur. » Elle vit donc sur le contexte, pas dans l'entrée.
 *
 * Aucune ne porte non plus de `userId` ni de niveau d'accès : l'acteur est
 * celui de la session, et ses droits sont résolus par l'EntitlementService
 * (03_PRIVACY_RLS §11, PLAN_ENGINE §45).
 */

const uuid = z.uuid();

/**
 * Borne de durée : la valeur maximale d'un `integer` PostgreSQL.
 *
 * C'est une limite de stockage. §50 interdit d'inventer un plafond sportif :
 * « le moteur Plan ne doit pas produire artificiellement
 * TARGET_PHYSIOLOGICALLY_IMPOSSIBLE s'il ne possède aucun modèle validé ».
 */
const MAX_SECONDS = 2_147_483_647;

const positiveSeconds = z.number().int().positive().max(MAX_SECONDS);
const nonNegativeSeconds = z.number().int().min(0).max(MAX_SECONDS);

/** Les deux comportements de §22, choisis explicitement par l'appelant. */
const mode = z.enum(['preserve_manual_changes', 'rebalance_to_target']);

export const generateRacePlanCommandSchema = z
  .object({
    participantRaceId: uuid,
    targetDurationSeconds: positiveSeconds,
  })
  .strict();

export type GenerateRacePlanCommand = z.infer<typeof generateRacePlanCommandSchema>;

/**
 * §21.1 — « l'utilisateur définit une nouvelle durée cible ».
 *
 * Le mode n'est pas offert : changer d'objectif, c'est demander à finir sur ce
 * nouvel objectif. §22.3 fait le même constat pour la génération initiale.
 */
export const changePlanTargetCommandSchema = z
  .object({
    participantRaceId: uuid,
    targetDurationSeconds: positiveSeconds,
  })
  .strict();

export type ChangePlanTargetCommand = z.infer<typeof changePlanTargetCommandSchema>;

/** §21.2 — le segment devient `manual_override` avec une durée fixe. */
export const updatePlanSegmentDurationCommandSchema = z
  .object({
    participantRaceId: uuid,
    raceSegmentId: uuid,
    durationSeconds: positiveSeconds,
    mode,
  })
  .strict();

export type UpdatePlanSegmentDurationCommand = z.infer<
  typeof updatePlanSegmentDurationCommandSchema
>;

export const removePlanSegmentOverrideCommandSchema = z
  .object({ participantRaceId: uuid, raceSegmentId: uuid, mode })
  .strict();

export type RemovePlanSegmentOverrideCommand = z.infer<
  typeof removePlanSegmentOverrideCommandSchema
>;

/** §21.3 — « la nouvelle durée devient fixe jusqu'à modification ultérieure ». */
export const updatePlanStopCommandSchema = z
  .object({
    participantRaceId: uuid,
    raceWaypointId: uuid,
    durationSeconds: nonNegativeSeconds,
    mode,
  })
  .strict();

export type UpdatePlanStopCommand = z.infer<typeof updatePlanStopCommandSchema>;

/** §21.4 — le waypoint devient une ancre dure. */
export const lockPlanWaypointCommandSchema = z
  .object({
    participantRaceId: uuid,
    raceWaypointId: uuid,
    arrivalElapsedSeconds: positiveSeconds,
    mode,
  })
  .strict();

export type LockPlanWaypointCommand = z.infer<typeof lockPlanWaypointCommandSchema>;

/** §21.5 — « la contrainte horaire disparaît ». */
export const unlockPlanWaypointCommandSchema = z
  .object({ participantRaceId: uuid, raceWaypointId: uuid, mode })
  .strict();

export type UnlockPlanWaypointCommand = z.infer<typeof unlockPlanWaypointCommandSchema>;

/**
 * §22.2 — « Rééquilibrer pour finir en HH:MM ».
 *
 * L'arrivée cible redevient une ancre, et le delta est absorbé par les seuls
 * segments flexibles.
 */
export const rebalancePlanToTargetCommandSchema = z.object({ participantRaceId: uuid }).strict();
export type RebalancePlanToTargetCommand = z.infer<typeof rebalancePlanToTargetCommandSchema>;

/**
 * §22.1 — « Conserver ce Plan ».
 *
 * Aucune ancre finale : l'arrivée dérive de ce que l'utilisateur a imposé.
 */
export const preserveCurrentPlanCommandSchema = z.object({ participantRaceId: uuid }).strict();
export type PreserveCurrentPlanCommand = z.infer<typeof preserveCurrentPlanCommandSchema>;

/**
 * §21.6 — retour à la proposition PLUKA sur un périmètre choisi.
 *
 * « La commande exacte doit être explicite ; pas de reset silencieux de toute
 * la course. » Le périmètre est donc une union discriminée, et `all` est une
 * valeur qu'il faut écrire, jamais un défaut.
 */
export const resetPlanScopeCommandSchema = z
  .object({
    participantRaceId: uuid,
    scope: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('segment'), raceSegmentId: uuid }).strict(),
      z.object({ kind: z.literal('stop'), raceWaypointId: uuid }).strict(),
      z.object({ kind: z.literal('anchor'), raceWaypointId: uuid }).strict(),
      z.object({ kind: z.literal('all') }).strict(),
    ]),
    mode,
  })
  .strict();

export type ResetPlanScopeCommand = z.infer<typeof resetPlanScopeCommandSchema>;

/**
 * §37 — preview.
 *
 * « Une preview peut être calculée en mémoire, ne crée pas automatiquement une
 * version persistée, ne déclenche pas les consommateurs downstream
 * définitifs. » L'objectif y est optionnel : un slider en essaie plusieurs sans
 * rien engager.
 */
export const previewPlanQuerySchema = z
  .object({
    participantRaceId: uuid,
    targetDurationSeconds: positiveSeconds.optional(),
    mode: mode.default('rebalance_to_target'),
  })
  .strict();

export type PreviewPlanQuery = z.infer<typeof previewPlanQuerySchema>;

export const getActivePlanQuerySchema = z.object({ participantRaceId: uuid }).strict();
export type GetActivePlanQuery = z.infer<typeof getActivePlanQuerySchema>;

export const listPlanVersionsQuerySchema = z.object({ participantRaceId: uuid }).strict();
export type ListPlanVersionsQuery = z.infer<typeof listPlanVersionsQuerySchema>;
