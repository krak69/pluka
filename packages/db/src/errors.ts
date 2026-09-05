/**
 * Erreurs de la couche données.
 *
 * Codes stables et pauvres en détail : un message PostgreSQL brut nomme des
 * tables, des contraintes et parfois des valeurs. Il appartient aux logs
 * serveur, jamais à une réponse utilisateur (01_ARCHITECTURE §32, §34.1).
 *
 * Aucun code ne parle d'entitlement, de quota ni de droit commercial : ce
 * paquet exécute des requêtes, il ne décide de rien (01_ARCHITECTURE §5 règle 5).
 */
export const DB_ERROR_CODES = [
  'not_found',
  'conflict',
  'constraint_violation',
  'permission_denied',
  'invalid_configuration',
  'unavailable',
  'unknown',
] as const;

export type DbErrorCode = (typeof DB_ERROR_CODES)[number];

export interface DbErrorParams {
  readonly code: DbErrorCode;
  /** Opération métier tentée, par exemple `races.findById`. Jamais la requête SQL. */
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}

export class DbError extends Error {
  readonly code: DbErrorCode;
  readonly operation: string;

  constructor(params: DbErrorParams) {
    super(`[${params.operation}] ${params.code} : ${params.message}`, {
      ...(params.cause === undefined ? {} : { cause: params.cause }),
    });
    this.name = 'DbError';
    this.code = params.code;
    this.operation = params.operation;
  }
}

/**
 * Forme minimale d'une erreur PostgREST.
 *
 * Déclarée ici plutôt qu'importée : la dépendance porte plusieurs types
 * d'erreur selon la version, et seul ce contrat nous intéresse.
 */
export interface PostgrestLikeError {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly details?: string | null;
  readonly hint?: string | null;
}

/**
 * Traduit un code SQLSTATE en code applicatif.
 *
 * `42501` (insufficient_privilege) et `PGRST116` remontent en
 * `permission_denied` : sous RLS, une ligne interdite est le plus souvent une
 * ligne absente, et c'est volontaire — répondre « interdit » sur un objet
 * qu'on n'a pas le droit de voir confirmerait son existence
 * (03_PRIVACY_RLS §120). L'appelant décide de ce qu'il en montre.
 */
export function mapPostgrestError(error: PostgrestLikeError, operation: string): DbError {
  const code = error.code ?? '';
  const message = error.message ?? 'erreur base de données';

  return new DbError({ code: classify(code), operation, message, cause: error });
}

function classify(sqlState: string): DbErrorCode {
  // Classe 23 : violation d'intégrité.
  if (sqlState === '23505') return 'conflict';
  if (sqlState.startsWith('23')) return 'constraint_violation';

  // Classe 42501 : privilège insuffisant, y compris une policy RLS en écriture.
  if (sqlState === '42501') return 'permission_denied';

  // Classes 08 (connexion) et 57 (intervention opérateur) : réessayable.
  if (sqlState.startsWith('08') || sqlState.startsWith('57')) return 'unavailable';

  // Codes PostgREST : `PGRST116` = aucune ligne là où une seule était attendue.
  if (sqlState === 'PGRST116') return 'not_found';

  return 'unknown';
}
