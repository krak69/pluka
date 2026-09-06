import { selectColumns } from '../columns.js';
import { mapPostgrestError } from '../errors.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrap, unwrapMaybe } from '../results.js';
import { participantRaceRepository, type ParticipantRaceRepository } from './participation.js';
import type { BetaAccessGrantRecord, EntitlementRecord } from './records.js';

/*
 * Repositories des droits commerciaux — 02_DATA_MODEL §10.
 *
 * AUCUNE DÉCISION ICI
 *
 * 01_ARCHITECTURE §5 règle 5 : « `db` ne décide jamais d'un entitlement. » La
 * règle est appliquée à la lettre, et pas seulement dans l'esprit : ces
 * lectures ne filtrent ni sur `status`, ni sur `starts_at`, ni sur `ends_at`.
 *
 * Ce n'est pas un oubli d'optimisation. §22 fait du contrôle de validité une
 * décision — « le contrôle utilise l'heure serveur » — et §18 exige trois
 * refus distincts : `expired`, `revoked`, `wrong_scope`. Un `where status =
 * 'active'` écrit ici les rendrait indiscernables : le resolver ne verrait
 * qu'une absence, et répondrait « pas de droit » à un coureur dont le Race
 * Pass vient d'expirer. Les lignes remontent donc entières, et le domaine
 * tranche.
 *
 * Le volume le permet : un utilisateur possède quelques droits, pas un
 * historique de transactions.
 */

const ENTITLEMENT_COLUMNS = [
  'id',
  'kind',
  'source',
  'status',
  'scope_type',
  'user_id',
  'participant_race_id',
  'organization_id',
  'starts_at',
  'ends_at',
  'revoked_at',
] as const;

const BETA_GRANT_COLUMNS = [
  'id',
  'user_id',
  'scope_type',
  'participant_race_id',
  'status',
  'starts_at',
  'ends_at',
  'revoked_at',
] as const;

type EntitlementRow = {
  id: string;
  kind: EntitlementRecord['kind'];
  source: EntitlementRecord['source'];
  status: EntitlementRecord['status'];
  scope_type: EntitlementRecord['scopeType'];
  user_id: string | null;
  participant_race_id: string | null;
  organization_id: string | null;
  starts_at: string;
  ends_at: string | null;
  revoked_at: string | null;
};

type BetaGrantRow = {
  id: string;
  user_id: string;
  scope_type: BetaAccessGrantRecord['scopeType'];
  participant_race_id: string | null;
  status: BetaAccessGrantRecord['status'];
  starts_at: string;
  ends_at: string | null;
  revoked_at: string | null;
};

function toEntitlement(row: EntitlementRow): EntitlementRecord {
  return {
    id: row.id,
    kind: row.kind,
    source: row.source,
    status: row.status,
    scopeType: row.scope_type,
    userId: row.user_id,
    participantRaceId: row.participant_race_id,
    organizationId: row.organization_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    revokedAt: row.revoked_at,
  };
}

function toBetaGrant(row: BetaGrantRow): BetaAccessGrantRecord {
  return {
    id: row.id,
    userId: row.user_id,
    scopeType: row.scope_type,
    participantRaceId: row.participant_race_id,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    revokedAt: row.revoked_at,
  };
}

/** Consommation de quota, telle que le ledger la conserve — §33, §34. */
export interface RecordUsageInput {
  readonly userId: string;
  readonly entitlementId: string;
  readonly capability: string;
  readonly participantRaceId: string;
  readonly outingId: string | null;
  /** Clé d'idempotence — §34 : `linked-outing:{outingId}`. */
  readonly usageKey: string;
}

export interface EntitlementRepository {
  /**
   * Tous les droits de l'utilisateur, quel que soit leur état.
   *
   * Y compris expirés et révoqués : ce sont eux qui permettent au resolver
   * d'expliquer un refus plutôt que de le constater (§18).
   */
  listByUser(userId: string): Promise<readonly EntitlementRecord[]>;
  /** Accès testeur — table séparée des trois produits commerciaux (§14). */
  listBetaGrantsByUser(userId: string): Promise<readonly BetaAccessGrantRecord[]>;
  /**
   * Nombre de consommations déjà inscrites au ledger pour ce scope.
   *
   * Un décompte, pas un verdict : le quota lui-même — 2 pour Race Pass et
   * Organizer Included, aucun pour PLUKA+ — appartient au domaine (§27 à §29).
   *
   * Compté sur le ledger et non sur les sorties existantes : §32 veut qu'une
   * sortie supprimée ne rende pas le quota, sans quoi le cycle
   * « créer → utiliser la météo → supprimer → recréer » le contournerait
   * indéfiniment (02_DATA_MODEL §10.4).
   */
  countUsage(userId: string, capability: string, participantRaceId: string): Promise<number>;
  /**
   * Inscrit une consommation, une seule fois.
   *
   * `unique (user_id, capability, usage_key)` porte l'idempotence en base
   * (§34). Rend `true` si la consommation était nouvelle, `false` si elle
   * était déjà inscrite — un rejeu ne consomme pas deux fois.
   */
  recordUsage(input: RecordUsageInput): Promise<boolean>;
}

export const entitlementRepository = defineRepository<EntitlementRepository>((context) => ({
  async listByUser(userId) {
    const rows = unwrap(
      await context.client
        .from('entitlements')
        .select(selectColumns('entitlements', ENTITLEMENT_COLUMNS))
        .eq('user_id', userId)
        .order('starts_at', { ascending: false }),
      'entitlements.listByUser',
    );

    return rows.map(toEntitlement);
  },

  async listBetaGrantsByUser(userId) {
    const rows = unwrap(
      await context.client
        .from('beta_access_grants')
        .select(selectColumns('beta_access_grants', BETA_GRANT_COLUMNS))
        .eq('user_id', userId)
        .order('starts_at', { ascending: false }),
      'beta_access_grants.listBetaGrantsByUser',
    );

    return rows.map(toBetaGrant);
  },

  async countUsage(userId, capability, participantRaceId) {
    const result = await context.client
      .from('entitlement_usage')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('capability', capability)
      .eq('participant_race_id', participantRaceId);

    // `head: true` ne rend aucune ligne : `unwrap` n'a rien à déballer, et
    // c'est `count` qui porte la réponse.
    if (result.error !== null) {
      throw mapPostgrestError(result.error, 'entitlement_usage.countUsage');
    }

    return result.count ?? 0;
  },

  async recordUsage(input) {
    // `ignoreDuplicates` traduit `on conflict do nothing` : la contrainte
    // d'unicité décide, pas une lecture préalable qui laisserait une fenêtre
    // entre le contrôle et l'écriture.
    const row = unwrapMaybe(
      await context.client
        .from('entitlement_usage')
        .upsert(
          {
            user_id: input.userId,
            entitlement_id: input.entitlementId,
            capability: input.capability,
            participant_race_id: input.participantRaceId,
            outing_id: input.outingId,
            usage_key: input.usageKey,
          },
          { onConflict: 'user_id,capability,usage_key', ignoreDuplicates: true },
        )
        .select(selectColumns('entitlement_usage', ['id']))
        .maybeSingle(),
      'entitlement_usage.recordUsage',
    );

    return row !== null;
  },
}));

/**
 * Bundle passé au resolver.
 *
 * La participation y figure pour une raison de confidentialité, pas de
 * commerce : avant de parler d'un droit sur une participation, le resolver
 * vérifie qu'elle appartient bien à l'acteur. AGENTS §24 : « ne pas dire à un
 * utilisateur d'acheter un Race Pass pour un objet qui appartient à quelqu'un
 * d'autre ».
 */
export interface EntitlementRepositories {
  readonly entitlements: EntitlementRepository;
  readonly participantRaces: ParticipantRaceRepository;
}

export function createEntitlementRepositories(context: RepositoryContext): EntitlementRepositories {
  return {
    entitlements: entitlementRepository(context),
    participantRaces: participantRaceRepository(context),
  };
}
