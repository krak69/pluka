import { DbError, mapPostgrestError, type PostgrestLikeError } from '../errors.js';
import { defineRepository, type RepositoryContext } from '../repository.js';
import type { PlukaClient } from '../types.js';

/*
 * Accès bêta — migration 0073.
 *
 * Chaque fonction SQL porte la garde `pluka_admin` et écrit le journal ; ce
 * repository ne décide rien.
 */

export type BetaAccessStatus = 'active' | 'expired' | 'revoked' | 'pending' | 'reserved';

export interface BetaAccessRecord {
  /** Nul pour une réservation : l'adresse n'a pas encore de compte. */
  readonly grantId: string | null;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly status: BetaAccessStatus;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly reason: string | null;
  readonly reserved: boolean;
}

export interface BetaAccessGrantOutcome {
  readonly granted: number;
  readonly extended: number;
  readonly reserved: number;
  readonly invalid: number;
}

export interface BetaAccessRepository {
  list(): Promise<readonly BetaAccessRecord[]>;
  grant(
    emails: readonly string[],
    endsAt: string,
    reason: string | null,
  ): Promise<BetaAccessGrantOutcome>;
  revoke(grantId: string, reason: string | null): Promise<void>;
  cancelReservation(email: string): Promise<void>;
}

interface RpcCapableClient {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

async function invoke(
  client: PlukaClient,
  operation: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await (client as unknown as RpcCapableClient).rpc(operation, args);

  if (result.error !== null && result.error !== undefined) {
    throw mapPostgrestError(result.error as PostgrestLikeError, operation);
  }

  return result.data;
}

function unexpected(operation: string, message: string): DbError {
  return new DbError({ code: 'unknown', operation, message });
}

function text(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

function count(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  return typeof value === 'number' ? value : 0;
}

const STATUSES: readonly BetaAccessStatus[] = [
  'active',
  'expired',
  'revoked',
  'pending',
  'reserved',
];

export const betaAccessRepository = defineRepository<BetaAccessRepository>((context) => ({
  async list() {
    const operation = 'admin_list_beta_access';
    const data = await invoke(context.client, operation, {});
    if (!Array.isArray(data)) throw unexpected(operation, 'la fonction devait rendre des lignes');

    return (data as readonly Record<string, unknown>[]).map((row) => {
      const status = text(row, 'status');
      const email = text(row, 'email');
      if (email === null || status === null || !(STATUSES as readonly string[]).includes(status)) {
        throw unexpected(operation, 'ligne d’accès bêta illisible');
      }

      return {
        grantId: text(row, 'grant_id'),
        email,
        firstName: text(row, 'first_name'),
        lastName: text(row, 'last_name'),
        status: status as BetaAccessStatus,
        startsAt: text(row, 'starts_at') ?? '',
        endsAt: text(row, 'ends_at'),
        reason: text(row, 'reason'),
        reserved: row['reserved'] === true,
      };
    });
  },

  async grant(emails, endsAt, reason) {
    const operation = 'admin_grant_beta_access';
    const data = await invoke(context.client, operation, {
      p_emails: emails,
      p_ends_at: endsAt,
      p_reason: reason,
    });
    if (typeof data !== 'object' || data === null) {
      throw unexpected(operation, 'la fonction devait rendre un bilan');
    }

    const outcome = data as Record<string, unknown>;
    return {
      granted: count(outcome, 'granted'),
      extended: count(outcome, 'extended'),
      reserved: count(outcome, 'reserved'),
      invalid: count(outcome, 'invalid'),
    };
  },

  async revoke(grantId, reason) {
    await invoke(context.client, 'admin_revoke_beta_access', {
      p_grant_id: grantId,
      p_reason: reason,
    });
  },

  async cancelReservation(email) {
    await invoke(context.client, 'admin_cancel_beta_reservation', { p_email: email });
  },
}));

export interface BetaAccessRepositories {
  readonly betaAccess: BetaAccessRepository;
}

export function createBetaAccessRepositories(context: RepositoryContext): BetaAccessRepositories {
  return { betaAccess: betaAccessRepository(context) };
}
