import { z } from 'zod';

/**
 * Entrées des commandes Event / Edition / Race.
 *
 * Validées à la frontière du domaine — étape 1 de la séquence de
 * 01_ARCHITECTURE §7 : valider, autoriser, appliquer les invariants, écrire.
 *
 * Les schémas restent ici, au plus près des use cases qui les consomment.
 * §4.5 les verrait dans `packages/contracts` le jour où une deuxième surface
 * en aura besoin ; tant qu'il n'y en a qu'une, les y déplacer n'ajouterait
 * qu'un aller-retour.
 *
 * Aucun schéma n'accepte de rôle, de `platformRole` ni d'`organizationId`
 * d'autorité : l'acteur est passé séparément et ses droits sont relus en base
 * (03_PRIVACY_RLS §11).
 */

const slug = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: 'slug attendu en minuscules, tirets simples' });

const name = z.string().trim().min(1).max(200);
const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();

export const createEventCommandSchema = z.object({
  /** Nul pour un événement maintenu par PLUKA : seul `pluka_admin` le gère (§4.1). */
  organizationId: uuid.nullable(),
  name,
  slug,
});

export type CreateEventCommand = z.infer<typeof createEventCommandSchema>;

export const createEditionCommandSchema = z.object({
  eventId: uuid,
  year: z.number().int().min(2000).max(2200),
  slug,
  startDate: isoDate,
  endDate: isoDate.nullable().default(null),
});

export type CreateEditionCommand = z.infer<typeof createEditionCommandSchema>;

export const createRaceCommandSchema = z.object({
  editionId: uuid,
  name,
  slug,
  distanceKm: z.number().positive(),
  elevationGainM: z.number().int().min(0).nullable().default(null),
  elevationLossM: z.number().int().min(0).nullable().default(null),
  startDatetime: instant,
  cutoffDatetime: instant.nullable().default(null),
  timezone: z.string().trim().min(1).max(64),
  startLocationName: name.nullable().default(null),
  finishLocationName: name.nullable().default(null),
});

export type CreateRaceCommand = z.infer<typeof createRaceCommandSchema>;

/**
 * Mise à jour d'épreuve.
 *
 * Ni `editionId` ni `slug` n'y figurent : déplacer une Race d'une édition à
 * l'autre casserait la hiérarchie (02_DATA_MODEL §3.1), et changer le slug
 * d'une course déjà publiée casserait son URL.
 *
 * Le statut non plus : il a sa propre commande, parce qu'il a ses propres
 * autorisations (§4.1).
 */
export const updateRaceCommandSchema = z
  .object({
    raceId: uuid,
    name: name.optional(),
    distanceKm: z.number().positive().optional(),
    elevationGainM: z.number().int().min(0).nullable().optional(),
    elevationLossM: z.number().int().min(0).nullable().optional(),
    startDatetime: instant.optional(),
    cutoffDatetime: instant.nullable().optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    startLocationName: name.nullable().optional(),
    finishLocationName: name.nullable().optional(),
  })
  .refine((command) => Object.keys(command).length > 1, {
    error: 'aucune modification demandée',
  });

export type UpdateRaceCommand = z.infer<typeof updateRaceCommandSchema>;

/** Raccourci de `changeRaceStatus` vers `published`. */
export const publishRaceCommandSchema = z.object({ raceId: uuid });
export type PublishRaceCommand = z.infer<typeof publishRaceCommandSchema>;

export const changeRaceStatusCommandSchema = z.object({
  raceId: uuid,
  status: z.enum(['draft', 'published', 'cancelled', 'completed', 'archived']),
});

export type ChangeRaceStatusCommand = z.infer<typeof changeRaceStatusCommandSchema>;

/**
 * Transitions d'Event et d'Edition — 00_PRODUCT_SPEC §4.1.
 *
 * Chaque schéma n'admet que les statuts de son enum : `record_status` n'a ni
 * `completed` ni `cancelled`, et demander à un événement de devenir « couru »
 * est une erreur de saisie, pas une transition illégale. Le refuser ici la
 * nomme comme telle, plutôt que de la laisser ressortir en `invalid_state`.
 */
export const changeEventStatusCommandSchema = z.object({
  eventId: uuid,
  status: z.enum(['draft', 'published', 'archived']),
});

export type ChangeEventStatusCommand = z.infer<typeof changeEventStatusCommandSchema>;

export const changeEditionStatusCommandSchema = z.object({
  editionId: uuid,
  status: z.enum(['draft', 'published', 'cancelled', 'completed', 'archived']),
});

export type ChangeEditionStatusCommand = z.infer<typeof changeEditionStatusCommandSchema>;

export const setRaceVisibilityCommandSchema = z.object({
  raceId: uuid,
  visibility: z.enum(['private', 'unlisted', 'public']),
});

export type SetRaceVisibilityCommand = z.infer<typeof setRaceVisibilityCommandSchema>;

export const getRaceOverviewQuerySchema = z.object({ raceId: uuid });
export type GetRaceOverviewQuery = z.infer<typeof getRaceOverviewQuerySchema>;

export const listRaceStatusHistoryQuerySchema = z.object({
  raceId: uuid,
  limit: z.number().int().min(1).max(200).default(50),
});

export type ListRaceStatusHistoryQuery = z.infer<typeof listRaceStatusHistoryQuerySchema>;

/**
 * Lectures d'administration — 00_PRODUCT_SPEC §3.5.
 *
 * La borne est obligatoire et plafonnée : une base courses se parcourt page
 * par page, elle ne se déverse pas dans un écran.
 */
export const listEventsForAdministrationQuerySchema = z.object({
  limit: z.number().int().min(1).max(200).default(100),
});

export type ListEventsForAdministrationQuery = z.infer<
  typeof listEventsForAdministrationQuerySchema
>;

/**
 * `limit` borne le journal de statut rendu avec l'objet, comme pour l'épreuve.
 * Valeur par défaut : l'appelant qui n'en veut pas n'a rien à passer.
 */
export const getEventAdministrationQuerySchema = z.object({
  eventId: uuid,
  limit: z.number().int().min(1).max(200).default(50),
});
export type GetEventAdministrationQuery = z.infer<typeof getEventAdministrationQuerySchema>;

export const getEditionAdministrationQuerySchema = z.object({
  editionId: uuid,
  limit: z.number().int().min(1).max(200).default(50),
});
export type GetEditionAdministrationQuery = z.infer<typeof getEditionAdministrationQuerySchema>;

export const getRaceAdministrationQuerySchema = z.object({
  raceId: uuid,
  limit: z.number().int().min(1).max(200).default(50),
});

export type GetRaceAdministrationQuery = z.infer<typeof getRaceAdministrationQuerySchema>;
