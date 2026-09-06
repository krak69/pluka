import { z } from 'zod';

/**
 * Entrées des commandes de Profil trailer — 00_PRODUCT_SPEC §8.
 *
 * Validées à la frontière du domaine (01_ARCHITECTURE §7).
 *
 * Aucun schéma ne porte de `userId` : le profil édité est toujours celui de la
 * session, et accepter un identifiant ouvrirait la seule porte par laquelle on
 * pourrait écrire chez quelqu'un d'autre (03_PRIVACY_RLS §11, §25).
 *
 * §8.2 exclut du cœur V1 : VO2max, VMA, zones cardiaques, historique détaillé
 * d'entraînement, puissance, charge d'entraînement. Aucun champ ne les nomme,
 * et le schéma refuse les clés inconnues plutôt que de les ignorer en silence
 * — une donnée physiologique envoyée par erreur doit produire une erreur, pas
 * disparaître sans trace.
 */

/*
 * Bornes de stockage, lues sur le schéma de 0001 :
 *
 *   representative_distance_km        numeric(7,2)  → 99 999,99
 *   weekly_distance_km                numeric(6,1)  → 99 999,9
 *   colonnes entières                 integer       → 2 147 483 647
 *
 * Ce ne sont pas des jugements sportifs. §8 ne pose aucun plafond, et
 * PLAN_ENGINE §50 interdit de déclarer une valeur impossible sans modèle
 * validé.
 */
const MAX_DISTANCE_KM = 99_999.99;
const MAX_WEEKLY_DISTANCE_KM = 99_999.9;
export const MAX_PROFILE_INTEGER = 2_147_483_647;

/** `numeric(7,2)` : au-delà de deux décimales, PostgreSQL arrondirait en silence. */
const distanceKm = z.number().positive().max(MAX_DISTANCE_KM).multipleOf(0.01);
const weeklyDistanceKm = z.number().min(0).max(MAX_WEEKLY_DISTANCE_KM).multipleOf(0.1);
const elevationM = z.number().int().min(0).max(MAX_PROFILE_INTEGER);
const positiveSeconds = z.number().int().positive().max(MAX_PROFILE_INTEGER);

const comfort = z.enum(['low', 'medium', 'high']);
const longDistanceExperience = z.enum(['none', 'up_to_30k', '30_60k', '60_100k', '100k_plus']);

/**
 * Mise à jour du Profil trailer — `updateTrailProfile` de 01_ARCHITECTURE §7.
 *
 * Sémantique de patch, alignée sur `updateRaceCommandSchema` :
 *
 * - champ absent → inchangé ;
 * - champ à `null` → effacé.
 *
 * §7.2 la rend nécessaire : « Course → confirmer / ajuster profil → Objectif →
 * Plan. Éviter de reposer systématiquement toutes les questions. » Un
 * remplacement complet obligerait l'appelant à renvoyer des réponses qu'il n'a
 * pas demandées, donc à les recopier — et à les perdre le jour où il oublie.
 *
 * La commande vide est refusée : elle ne veut rien dire, et la laisser passer
 * horodaterait une modification qui n'a pas eu lieu.
 */
export const updateTrailProfileCommandSchema = z
  .object({
    representativeEffortLabel: z.string().trim().min(1).max(200).nullable().optional(),
    representativeEffortDate: z.iso.date().nullable().optional(),
    representativeDistanceKm: distanceKm.nullable().optional(),
    representativeElevationGainM: elevationM.nullable().optional(),
    representativeDurationSeconds: positiveSeconds.nullable().optional(),
    fallbackTrailPaceSecondsPerKm: positiveSeconds.nullable().optional(),
    weeklyDistanceKm: weeklyDistanceKm.nullable().optional(),
    weeklyElevationGainM: elevationM.nullable().optional(),
    climbComfort: comfort.nullable().optional(),
    descentComfort: comfort.nullable().optional(),
    longDistanceExperience: longDistanceExperience.nullable().optional(),
  })
  .strict()
  .refine((command) => Object.keys(command).length > 0, {
    error: 'aucune modification demandée',
  });

export type UpdateTrailProfileCommand = z.infer<typeof updateTrailProfileCommandSchema>;

/**
 * Lecture du profil de la session.
 *
 * Sans paramètre, et c'est volontaire : il n'existe aucune façon de désigner
 * le profil d'un autre coureur (03_PRIVACY_RLS §13).
 */
export const getTrailProfileQuerySchema = z.object({}).strict();
export type GetTrailProfileQuery = z.infer<typeof getTrailProfileQuerySchema>;
