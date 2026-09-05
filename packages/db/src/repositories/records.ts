import type { Enum } from '../types.js';

/**
 * DTO de la couche données.
 *
 * Les lignes ne sortent jamais telles quelles : le repository projette des
 * colonnes explicites et les renomme en camelCase. Le domaine ne connaît donc
 * pas la forme SQL, et une colonne ajoutée au schéma n'élargit pas
 * silencieusement ce qui circule.
 */
export interface EventRecord {
  readonly id: string;
  /**
   * Absente pour un événement maintenu par PLUKA à partir de sources
   * publiques (02_DATA_MODEL §3.1). §4.1 en tire la conséquence : « un
   * événement sans organisation gestionnaire n'est administrable que par
   * `pluka_admin` ».
   */
  readonly organizationId: string | null;
  readonly name: string;
  readonly slug: string;
  readonly status: Enum<'record_status'>;
}

export interface EditionRecord {
  readonly id: string;
  readonly eventId: string;
  readonly year: number;
  readonly slug: string;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly status: Enum<'edition_status'>;
}

export interface RaceRecord {
  readonly id: string;
  readonly editionId: string;
  readonly name: string;
  readonly slug: string;
  readonly distanceKm: number;
  readonly elevationGainM: number | null;
  readonly elevationLossM: number | null;
  readonly startDatetime: string;
  readonly cutoffDatetime: string | null;
  readonly timezone: string;
  readonly startLocationName: string | null;
  readonly finishLocationName: string | null;
  readonly status: Enum<'race_status'>;
  readonly publicVisibility: Enum<'race_visibility'>;
}

/**
 * Une transition de statut journalisée (00_PRODUCT_SPEC §4.1).
 *
 * Écrite par le trigger `races_journal_status_change`, jamais par
 * l'application : un acteur déclaré par l'appelant ne serait pas une preuve.
 * `actorUserId` est absent quand la transition vient d'un traitement serveur
 * sans session utilisateur.
 */
export interface RaceStatusTransitionRecord {
  readonly id: string;
  readonly raceId: string;
  readonly fromStatus: Enum<'race_status'>;
  readonly toStatus: Enum<'race_status'>;
  readonly actorUserId: string | null;
  readonly createdAt: string;
}

/** Rôle d'un utilisateur dans une organisation, ou son absence. */
export interface MembershipRecord {
  readonly organizationId: string;
  readonly userId: string;
  readonly role: Enum<'organization_member_role'>;
}

/**
 * Rôle plateforme, lu en base et jamais accepté depuis le client
 * (03_PRIVACY_RLS §4, §178).
 */
export interface PlatformIdentityRecord {
  readonly id: string;
  readonly platformRole: Enum<'platform_role'>;
}
