import { z } from 'zod';

import { PREPARATION_STATES, RUNNER_PARTICIPATION_STATUSES } from './lifecycle.js';

/**
 * Entrées des commandes de participation.
 *
 * Validées à la frontière du domaine — étape 1 de 01_ARCHITECTURE §7.
 *
 * Aucun schéma n'accepte de `userId`, de rôle ni de statut d'entitlement :
 * l'acteur est passé séparément et ses droits sont relus en base
 * (03_PRIVACY_RLS §11, §25).
 *
 * Les deux axes de 02_DATA_MODEL §9.3 ont chacun leur commande. Aucune n'écrit
 * les deux colonnes : « aucun chemin d'écriture ne calcule l'une à partir de
 * l'autre », et une commande qui les porterait ensemble rouvrirait la porte à
 * une dérivation implicite côté appelant.
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

/** Axe préparation — où en est le coureur (§9.3). */
export const setPreparationStateCommandSchema = z.object({
  participantRaceId: uuid,
  preparationState: z.enum(PREPARATION_STATES),
});

export type SetPreparationStateCommand = z.infer<typeof setPreparationStateCommandSchema>;

/**
 * Axe participation — ce qu'est devenue la course (§9.3).
 *
 * `archived` n'est pas proposé : c'est un geste d'administration, pas une
 * déclaration de coureur.
 */
export const setParticipationStatusCommandSchema = z.object({
  participantRaceId: uuid,
  status: z.enum(RUNNER_PARTICIPATION_STATUSES),
});

export type SetParticipationStatusCommand = z.infer<typeof setParticipationStatusCommandSchema>;

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
