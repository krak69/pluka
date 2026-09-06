import { z } from 'zod';

import { PREPARATION_STATES } from './lifecycle.js';

/**
 * Entrées des commandes de participation.
 *
 * Validées à la frontière du domaine — étape 1 de 01_ARCHITECTURE §7.
 *
 * Aucun schéma n'accepte de `userId`, de rôle ni de statut d'entitlement :
 * l'acteur est passé séparément et ses droits sont relus en base
 * (03_PRIVACY_RLS §11, §25). Aucun n'accepte non plus de `status` de
 * participation : il est dérivé de l'état de préparation
 * (`participationStatusFor`).
 */

const uuid = z.uuid();

/**
 * Borne haute de l'objectif : la valeur maximale d'un `integer` PostgreSQL.
 *
 * C'est une limite de stockage, pas un jugement sportif. PLAN_ENGINE §7 ne
 * pose qu'une condition — « l'objectif est strictement positif » — et §50
 * interdit explicitement d'inventer un seuil d'impossibilité : « le moteur ne
 * doit pas produire artificiellement `TARGET_PHYSIOLOGICALLY_IMPOSSIBLE` s'il
 * ne possède aucun modèle validé permettant de l'affirmer. »
 */
export const MAX_TARGET_DURATION_SECONDS = 2_147_483_647;

export const createParticipantRaceCommandSchema = z.object({ raceId: uuid });
export type CreateParticipantRaceCommand = z.infer<typeof createParticipantRaceCommandSchema>;

/**
 * Réclamation d'une participation importée — 01_ARCHITECTURE §10.2.
 *
 * Aucun email n'est transmis : celui de l'acteur est relu en base et comparé
 * là, pour la même raison qu'un rôle ne se déclare pas.
 */
export const claimParticipantRaceCommandSchema = z.object({ participantRaceId: uuid });
export type ClaimParticipantRaceCommand = z.infer<typeof claimParticipantRaceCommandSchema>;

export const getParticipationQuerySchema = z.object({ participantRaceId: uuid });
export type GetParticipationQuery = z.infer<typeof getParticipationQuerySchema>;

export const getParticipationForRaceQuerySchema = z.object({ raceId: uuid });
export type GetParticipationForRaceQuery = z.infer<typeof getParticipationForRaceQuerySchema>;

/** L'objectif du coureur, en secondes — 00_PRODUCT_SPEC §9.1, saisi en `HH:MM`. */
export const setRaceGoalCommandSchema = z.object({
  participantRaceId: uuid,
  targetDurationSeconds: z.number().int().positive().max(MAX_TARGET_DURATION_SECONDS),
});

export type SetRaceGoalCommand = z.infer<typeof setRaceGoalCommandSchema>;

export const setPreparationStateCommandSchema = z.object({
  participantRaceId: uuid,
  preparationState: z.enum(PREPARATION_STATES),
});

export type SetPreparationStateCommand = z.infer<typeof setPreparationStateCommandSchema>;

/**
 * Liste d'inscrits vue par l'organisation — 03_PRIVACY_RLS §27.
 *
 * La borne est obligatoire et plafonnée : une liste d'inscrits se parcourt
 * page par page, elle ne se déverse pas dans un écran.
 */
export const listRaceRosterQuerySchema = z.object({
  raceId: uuid,
  limit: z.number().int().min(1).max(500).default(100),
});

export type ListRaceRosterQuery = z.infer<typeof listRaceRosterQuerySchema>;
