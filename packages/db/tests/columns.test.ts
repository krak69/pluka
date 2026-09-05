import { describe, expect, it } from 'vitest';

import { DbError, selectColumns } from '../src/index.js';

/**
 * Projections explicites.
 *
 * L'enjeu n'est pas l'esthétique : les grants de colonnes de
 * `03_PRIVACY_RLS` reposent sur des projections nommées, et une étoile
 * élargirait ce qui sort de la base à chaque migration.
 */
describe('selectColumns', () => {
  it('assemble la projection dans l’ordre demandé', () => {
    expect(selectColumns('races', ['id', 'name', 'slug'])).toBe('id,name,slug');
  });

  it('accepte une colonne unique', () => {
    expect(selectColumns('users', ['id'])).toBe('id');
  });

  it('refuse une projection vide', () => {
    expect(() => selectColumns('races', [])).toThrow(DbError);
  });

  it('refuse l’étoile, même déguisée en colonne', () => {
    // `*` n'est pas un `ColumnName`, d'où l'assertion : le test protège le
    // cas où la projection est construite dynamiquement et perd son typage.
    expect(() => selectColumns('races', ['*' as 'id'])).toThrow(/étoilée/);
  });

  it('refuse un doublon, qui trahit une projection recopiée', () => {
    expect(() => selectColumns('races', ['id', 'id' as 'name'])).toThrow(/deux fois/);
  });

  it('rend une DbError de configuration, pas une erreur générique', () => {
    try {
      selectColumns('races', []);
      expect.unreachable('une DbError était attendue');
    } catch (error) {
      expect(error).toBeInstanceOf(DbError);
      expect((error as DbError).code).toBe('invalid_configuration');
      expect((error as DbError).operation).toBe('select races');
    }
  });
});

describe('inférence de la projection', () => {
  it('rend un littéral, pas un string', () => {
    // supabase-js déduit la forme de la ligne de la chaîne littérale : si ce
    // type retombait sur `string`, chaque `.select()` rendrait `{}`.
    const columns = selectColumns('editions', ['id', 'year']);
    const literal: 'id,year' = columns;

    expect(literal).toBe('id,year');
  });
});
