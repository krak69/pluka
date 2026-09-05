import { DbError } from './errors.js';
import type { ColumnName, TableName } from './types.js';

/**
 * Projection assemblée au niveau du type.
 *
 * supabase-js déduit la forme de la ligne en analysant la *chaîne littérale*
 * passée à `.select()`. Une projection typée `string` lui fait rendre `{}` :
 * le helper doit donc produire le littéral `'id,version'`, pas un `string`.
 *
 * Le dernier cas couvre un tableau non littéral (colonnes calculées à
 * l'exécution) : on retombe alors sur `string`, et l'appelant perd l'inférence
 * — comme s'il avait écrit la chaîne lui-même.
 */
export type JoinColumns<TColumns extends readonly string[]> = TColumns extends readonly []
  ? never
  : TColumns extends readonly [infer TOnly extends string]
    ? TOnly
    : TColumns extends readonly [
          infer THead extends string,
          ...infer TRest extends readonly string[],
        ]
      ? `${THead},${JoinColumns<TRest>}`
      : string;

/**
 * Construit une projection explicite pour un `select`.
 *
 * `select *` est proscrit : à chaque colonne ajoutée au schéma, une requête
 * étoilée élargit silencieusement ce qui sort de la base. Le problème n'est
 * pas théorique — les grants de colonnes de `03_PRIVACY_RLS` reposent sur des
 * projections nommées, et une étoile y échoue de toute façon.
 *
 * Le nom de table sert à typer les colonnes contre les types générés : une
 * colonne renommée en migration devient une erreur de compilation.
 *
 * ```ts
 * const columns = selectColumns('race_plans', ['id', 'version']);
 * //    ^? 'id,version' — supabase-js en déduit { id: string; version: number }
 * ```
 *
 * Le modificateur `const` conserve le tuple littéral sans imposer `as const`
 * au point d'appel.
 */
export function selectColumns<
  TTable extends TableName,
  const TColumns extends readonly ColumnName<TTable>[],
>(table: TTable, columns: TColumns): JoinColumns<TColumns> {
  if (columns.length === 0) {
    throw new DbError({
      code: 'invalid_configuration',
      operation: `select ${table}`,
      message: 'projection vide : lister explicitement les colonnes nécessaires',
    });
  }

  const seen = new Set<string>();
  for (const column of columns) {
    if (column === '*') {
      throw new DbError({
        code: 'invalid_configuration',
        operation: `select ${table}`,
        message: 'projection étoilée interdite : lister les colonnes nécessaires',
      });
    }

    if (seen.has(column)) {
      throw new DbError({
        code: 'invalid_configuration',
        operation: `select ${table}`,
        message: `colonne ${column} listée deux fois`,
      });
    }

    seen.add(column);
  }

  // `join` rend `string` ; le type de retour est calculé à partir du tuple.
  return columns.join(',') as JoinColumns<TColumns>;
}
