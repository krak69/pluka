import { mapPostgrestError, type PostgrestLikeError } from './errors.js';

/**
 * Résultat d'une requête PostgREST.
 *
 * Le client rend `{ data, error }` plutôt que de lever : sans déballage
 * explicite, une erreur se lit comme une absence de données et le code
 * continue avec `null`. Ces helpers rendent l'échec bruyant.
 */
export interface PostgrestLikeSuccess<TData> {
  readonly data: TData;
  readonly error: null;
}

export interface PostgrestLikeFailure {
  readonly data: null;
  readonly error: PostgrestLikeError;
}

export type PostgrestLikeResult<TData> = PostgrestLikeSuccess<TData> | PostgrestLikeFailure;

/**
 * Données de la branche succès d'un résultat.
 *
 * L'inférence porte sur `error: null`, et non sur `PostgrestLikeResult<infer
 * TData>` : un résultat réel est une union succès | échec, la branche d'échec
 * correspondrait elle aussi, et `TData` retomberait sur `unknown`. Tout le
 * typage des repositories s'effondrerait en silence — `.select()` rendrait
 * `{}` sans que rien n'échoue.
 *
 * La branche d'échec rend `never`, qui disparaît de l'union.
 */
export type SuccessData<TResult> = TResult extends { data: infer TData; error: null }
  ? TData
  : never;

/**
 * Déballe un résultat dont les données sont attendues.
 *
 * Lève une `DbError` si la requête a échoué, ou si elle a réussi sans rendre
 * de données là où une ligne était attendue.
 */
export function unwrap<TResult extends PostgrestLikeResult<unknown>>(
  result: TResult,
  operation: string,
): NonNullable<SuccessData<TResult>> {
  if (result.error !== null) throw mapPostgrestError(result.error, operation);

  if (result.data === null || result.data === undefined) {
    throw mapPostgrestError({ code: 'PGRST116', message: 'aucune ligne' }, operation);
  }

  return result.data as NonNullable<SuccessData<TResult>>;
}

/**
 * Déballe un résultat dont l'absence est un cas normal — un `maybeSingle()`.
 *
 * L'absence rend `null` ; seule une erreur lève. La distinction compte : sous
 * RLS, « je n'ai pas le droit de voir cette ligne » et « cette ligne n'existe
 * pas » se présentent de la même façon, et c'est l'appelant qui tranche ce
 * qu'il en dit (03_PRIVACY_RLS §120).
 */
export function unwrapMaybe<TResult extends PostgrestLikeResult<unknown>>(
  result: TResult,
  operation: string,
): SuccessData<TResult> | null {
  if (result.error !== null) throw mapPostgrestError(result.error, operation);

  return (result.data ?? null) as SuccessData<TResult> | null;
}
