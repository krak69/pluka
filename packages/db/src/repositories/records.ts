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

/**
 * Action de revue — SOURCES_EXTRACTION §31.
 *
 * « publish, edit_and_publish, reject, mark_duplicate, needs_review ». Les
 * deux premières sont décidées par la base au vu de la valeur transmise :
 * corriger avant de publier est `edit_and_publish`, et §31 veut que la
 * correction soit auditée.
 */
export type FactReviewAction =
  'publish' | 'edit_and_publish' | 'reject' | 'mark_duplicate' | 'needs_review';

/** États d'un candidat au moment de la revue. Aucun n'est un état publié (§25). */
export type FactCandidateStatus =
  'detected' | 'needs_review' | 'conflict' | 'accepted' | 'rejected' | 'duplicate';

/**
 * Portée d'un candidat, lue en base à partir de son seul identifiant.
 *
 * Le use case ne reçoit jamais de `raceId` de l'appelant : le déduire du
 * candidat évite qu'une commande désigne une course sur laquelle son auteur a
 * des droits, pour agir sur un candidat qui appartient à une autre.
 */
export interface FactCandidateScopeRecord {
  readonly candidateId: string;
  readonly raceId: string;
  readonly organizationId: string | null;
  readonly category: Enum<'fact_category'>;
  readonly factKey: string;
  readonly status: FactCandidateStatus;
  readonly origin: string | null;
  readonly matchedFactId: string | null;
  readonly valueText: string | null;
  readonly valueNumber: number | null;
  readonly unit: string | null;
  /** §20 et §34 : sans preuve, il n'y a rien à publier. */
  readonly evidenceCount: number;
  readonly conflictStatus: string | null;
}

/**
 * Une ligne de l'écran de revue — SOURCES_EXTRACTION §30.
 *
 * « La revue doit afficher : valeur proposée ; type ; source ; extrait ;
 * page / section ; anciennes valeurs ; contradictions ; action proposée. »
 * Les huit y sont, plus la provenance d'extraction : un relecteur qui voit
 * qu'une valeur vient d'un modèle ne la lit pas comme une lecture de tableau.
 */
export interface FactCandidateReviewRecord {
  readonly candidateId: string;
  readonly raceId: string;
  readonly category: Enum<'fact_category'>;
  readonly factKey: string;
  readonly valueText: string | null;
  readonly valueNumber: number | null;
  readonly unit: string | null;
  readonly valueJson: Readonly<Record<string, unknown>> | null;
  readonly confidenceLabel: 'high' | 'medium' | 'low' | null;
  readonly status: FactCandidateStatus;
  readonly origin: string | null;
  readonly notes: string | null;
  readonly matchedFactId: string | null;
  /** Ancienne valeur, telle qu'elle est publiée aujourd'hui (§30, §40). */
  readonly publishedValueText: string | null;
  readonly publishedVersionId: string | null;
  readonly publishedTrustLevel: Enum<'trust_level'> | null;
  readonly conflictType: string | null;
  readonly conflictStatus: string | null;
  readonly excerpt: string | null;
  readonly pageNumber: number | null;
  readonly sectionPath: readonly string[];
  readonly locator: Readonly<Record<string, unknown>>;
  /**
   * Adresse de la preuve — §20 : « snapshot_id, block_id ou chunk_id ».
   *
   * Sans elle, une citation ne se vérifie pas : un extrait sans adresse ne se
   * remonte pas jusqu'au document d'origine.
   */
  readonly snapshotId: string | null;
  readonly snapshotContentHash: string | null;
  readonly blockIndex: number | null;
  readonly chunkIndex: number | null;
  /** Texte complet du block cité, pour relire l'extrait dans son contexte. */
  readonly blockContent: string | null;
  readonly sourceTitle: string | null;
  readonly sourceUrl: string | null;
  readonly sourceType: Enum<'source_type'> | null;
  readonly organizationName: string | null;
  readonly snapshotRetrievedAt: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly extractedAt: string | null;
}

/** Résultat d'une publication — les identifiants que §33 fait naître. */
export interface PublishedFactRecord {
  readonly factId: string;
  readonly factVersionId: string;
  readonly versionNumber: number;
  readonly action: 'publish' | 'edit_and_publish';
  /** Version que celle-ci remplace, nulle à la première publication (§35). */
  readonly supersededVersionId: string | null;
  readonly trustLevel: Enum<'trust_level'>;
}

/**
 * Une décision de revue, telle que le journal la conserve — §30, §31.
 *
 * `actorUserId` n'est jamais nul : la colonne SQL l'interdit. Une décision
 * sans auteur n'est pas une décision.
 */
export interface FactPublicationActRecord {
  readonly actId: string;
  readonly candidateId: string | null;
  readonly factId: string | null;
  readonly factVersionId: string | null;
  readonly action: FactReviewAction;
  readonly actorUserId: string;
  readonly authority: 'platform_admin' | 'organization_member';
  readonly actorRole: Enum<'organization_member_role'> | null;
  readonly trustLevel: Enum<'trust_level'> | null;
  /** Valeur du candidat quand l'humain l'a corrigée avant de publier (§31). */
  readonly originalValue: Readonly<Record<string, unknown>> | null;
  readonly publishedValue: Readonly<Record<string, unknown>> | null;
  readonly note: string | null;
  readonly createdAt: string;
}
