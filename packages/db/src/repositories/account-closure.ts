import { defineRepository, type RepositoryContext } from '../repository.js';
import { unwrapMaybe } from '../results.js';

/*
 * Le compte du coureur : suppression et export — migration 0078.
 *
 * Tout passe sous la session du coureur : la base lit `auth.uid()`, aucun
 * identifiant n'est transmis. C'est elle qui décide si le compte peut partir
 * (§94), l'application ne fait que dire pourquoi.
 */

/** Ce qui empêche une suppression : le support tranche. */
export type AccountDeletionBlocker = 'pluka_staff' | 'sole_owner' | 'publisher';

export type AccountDeletionOutcome =
  | { readonly status: 'scheduled'; readonly purgeAfter: string }
  | { readonly status: 'blocked'; readonly reason: AccountDeletionBlocker };

export interface AccountClosureRepository {
  /** Ferme le compte ; l'effacement suit 30 jours plus tard, sauf reconnexion. */
  requestDeletion(): Promise<AccountDeletionOutcome>;
  /** `true` quand une demande en cours a été annulée. */
  cancelDeletion(): Promise<boolean>;
  /** Toutes les données du compte, telles que la base les rend. */
  exportData(): Promise<unknown>;
}

const BLOCKERS: readonly AccountDeletionBlocker[] = ['pluka_staff', 'sole_owner', 'publisher'];

export const accountClosureRepository = defineRepository<AccountClosureRepository>((context) => ({
  async requestDeletion() {
    const data = unwrapMaybe(
      await context.client.rpc('request_account_deletion'),
      'request_account_deletion',
    ) as { status?: unknown; reason?: unknown; purgeAfter?: unknown } | null;

    if (data?.status === 'scheduled' && typeof data.purgeAfter === 'string') {
      return { status: 'scheduled', purgeAfter: data.purgeAfter };
    }

    const reason = BLOCKERS.find((blocker) => blocker === data?.reason);
    // Une réponse illisible ne ferme rien : on la traite comme un refus.
    return { status: 'blocked', reason: reason ?? 'pluka_staff' };
  },

  async cancelDeletion() {
    const data = unwrapMaybe(
      await context.client.rpc('cancel_account_deletion'),
      'cancel_account_deletion',
    );
    return data === true;
  },

  async exportData() {
    return unwrapMaybe(await context.client.rpc('export_my_data'), 'export_my_data');
  },
}));

export interface AccountClosureRepositories {
  readonly accountClosure: AccountClosureRepository;
}

export function createAccountClosureRepositories(
  context: RepositoryContext,
): AccountClosureRepositories {
  return { accountClosure: accountClosureRepository(context) };
}
