import type { PlukaClient } from './types.js';

/**
 * Contexte d'exécution d'un repository.
 *
 * Le client est injecté : un repository ne crée jamais son propre client et ne
 * lit jamais l'environnement. C'est l'appelant — Server Action, Route Handler,
 * worker — qui décide s'il agit sous la session de l'utilisateur (RLS active)
 * ou avec une clé de service.
 *
 * `requestId` sert aux logs structurés (01_ARCHITECTURE §34.2). Il ne
 * transporte aucune donnée personnelle.
 */
export interface RepositoryContext {
  readonly client: PlukaClient;
  readonly requestId?: string;
}

export type RepositoryFactory<TRepository> = (context: RepositoryContext) => TRepository;

/**
 * Déclare un repository.
 *
 * Conventions attendues d'une implémentation :
 *
 * - une fonction par intention métier, pas un CRUD générique ;
 * - projection explicite via `selectColumns`, jamais `select *` ;
 * - lignes traduites en DTO nommés en camelCase, pour que la forme SQL ne
 *   traverse pas la frontière ;
 * - erreurs déballées par `unwrap` / `unwrapMaybe` ;
 * - **aucune décision d'autorisation, d'entitlement, de quota ou de
 *   publication** : ces règles vivent dans `packages/domain`
 *   (01_ARCHITECTURE §4.5, §5 règle 5 « `packages/db` ne décide pas d'un
 *   entitlement »).
 *
 * Un repository qui se met à lire un `plan` d'abonnement, à compter un quota
 * ou à filtrer selon un droit commercial a franchi cette frontière : le
 * filtrage appartient au use case, qui l'a résolu explicitement.
 *
 * Aucun repository métier n'est fourni ici : chacun arrive avec le lot qui
 * définit ses requêtes et ses tests d'intégration (01_ARCHITECTURE §36.2).
 */
export function defineRepository<TRepository>(
  factory: RepositoryFactory<TRepository>,
): RepositoryFactory<TRepository> {
  return factory;
}
