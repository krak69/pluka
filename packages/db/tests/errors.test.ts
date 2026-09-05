import { describe, expect, it } from 'vitest';

import {
  DB_ERROR_CODES,
  DbError,
  mapPostgrestError,
  unwrap,
  unwrapMaybe,
  type PostgrestLikeResult,
} from '../src/index.js';

describe('DbError', () => {
  it('nomme l’opération sans exposer la requête', () => {
    const error = new DbError({
      code: 'conflict',
      operation: 'races.insert',
      message: 'slug déjà utilisé',
    });

    expect(error.message).toBe('[races.insert] conflict : slug déjà utilisé');
    expect(error.name).toBe('DbError');
    expect(error).toBeInstanceOf(Error);
  });

  it('conserve la cause pour les logs serveur', () => {
    const cause = { code: '23505' };
    const error = new DbError({ code: 'conflict', operation: 'x', message: 'y', cause });

    expect(error.cause).toBe(cause);
  });

  it('ne déclare aucun code parlant d’entitlement', () => {
    // `packages/db` ne décide pas d'un droit commercial : son vocabulaire
    // d'erreur ne doit pas laisser croire qu'il pourrait le faire
    // (01_ARCHITECTURE §5 règle 5).
    const commercial = DB_ERROR_CODES.filter((code) =>
      /entitlement|quota|paywall|plan|subscription/.test(code),
    );

    expect(commercial).toEqual([]);
  });
});

describe('mapPostgrestError', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['23505', 'conflict'],
    ['23503', 'constraint_violation'],
    ['23514', 'constraint_violation'],
    ['42501', 'permission_denied'],
    ['08006', 'unavailable'],
    ['57014', 'unavailable'],
    ['PGRST116', 'not_found'],
    ['XX000', 'unknown'],
  ];

  for (const [sqlState, expected] of cases) {
    it(`classe ${sqlState} en ${expected}`, () => {
      expect(mapPostgrestError({ code: sqlState, message: 'x' }, 'op').code).toBe(expected);
    });
  }

  it('classe une erreur sans code en unknown plutôt que d’inventer', () => {
    expect(mapPostgrestError({ message: 'boom' }, 'op').code).toBe('unknown');
  });

  it('traduit un refus de policy en permission_denied', () => {
    // Une écriture refusée par RLS remonte en 42501. La lecture, elle, rend
    // simplement zéro ligne : c'est voulu (03_PRIVACY_RLS §120).
    const error = mapPostgrestError(
      { code: '42501', message: 'new row violates policy' },
      'insert',
    );

    expect(error.code).toBe('permission_denied');
  });
});

describe('unwrap', () => {
  it('rend les données d’un succès', () => {
    const result: PostgrestLikeResult<{ id: string }> = { data: { id: 'a' }, error: null };

    expect(unwrap(result, 'op')).toEqual({ id: 'a' });
  });

  it('lève une DbError traduite en cas d’erreur', () => {
    const result: PostgrestLikeResult<unknown> = {
      data: null,
      error: { code: '23505', message: 'doublon' },
    };

    expect(() => unwrap(result, 'races.insert')).toThrow(DbError);
    try {
      unwrap(result, 'races.insert');
    } catch (error) {
      expect((error as DbError).code).toBe('conflict');
    }
  });

  it('lève quand une ligne attendue est absente', () => {
    const result: PostgrestLikeResult<unknown> = { data: null, error: null };

    try {
      unwrap(result, 'races.findById');
      expect.unreachable('une DbError était attendue');
    } catch (error) {
      expect((error as DbError).code).toBe('not_found');
    }
  });

  it('laisse passer un tableau vide, qui est une réponse valide', () => {
    const result: PostgrestLikeResult<readonly unknown[]> = { data: [], error: null };

    expect(unwrap(result, 'races.list')).toEqual([]);
  });
});

describe('unwrapMaybe', () => {
  it('rend null sur absence, sans lever', () => {
    const result: PostgrestLikeResult<{ id: string } | null> = { data: null, error: null };

    expect(unwrapMaybe(result, 'op')).toBeNull();
  });

  it('lève quand même sur une vraie erreur', () => {
    const result: PostgrestLikeResult<unknown> = {
      data: null,
      error: { code: '08006', message: 'connexion perdue' },
    };

    expect(() => unwrapMaybe(result, 'op')).toThrow(DbError);
  });

  it('distingue l’absence de l’échec', () => {
    // Sous RLS, « interdit » et « inexistant » se présentent pareil : c'est à
    // l'appelant de trancher ce qu'il en dit, pas à ce paquet.
    const absent: PostgrestLikeResult<{ id: string } | null> = { data: null, error: null };
    const failed: PostgrestLikeResult<{ id: string } | null> = {
      data: null,
      error: { code: '42501', message: 'refus' },
    };

    expect(unwrapMaybe(absent, 'op')).toBeNull();
    expect(() => unwrapMaybe(failed, 'op')).toThrow(DbError);
  });
});

/**
 * Le typage du déballage, vérifié à la compilation.
 *
 * Un résultat réel est une union succès | échec. Si `SuccessData` inférait
 * aussi depuis la branche d'échec, il retomberait sur `unknown` et tout le
 * typage des repositories s'effondrerait en silence : `.select()` rendrait
 * `{}` sans qu'aucun test d'exécution n'échoue. Ces affectations sont la
 * garde — elles ne compilent que si l'inférence porte bien sur le succès seul.
 */
describe('inférence du déballage', () => {
  it('traverse une union succès | échec sans retomber sur unknown', () => {
    type Row = { id: string; name: string };

    // Forme d'un `.single()` : la donnée est présente ou l'appel a échoué.
    type SingleResponse =
      | { data: Row; error: null; count: number | null }
      | { data: null; error: { code: string; message: string } };

    // Forme d'un `.maybeSingle()` : l'absence est un cas normal.
    type MaybeSingleResponse =
      | { data: Row | null; error: null; count: number | null }
      | { data: null; error: { code: string; message: string } };

    const single = { data: { id: 'a', name: 'A' }, error: null, count: 1 } as SingleResponse;
    const maybe = { data: null, error: null, count: 0 } as MaybeSingleResponse;

    const row: Row = unwrap(single, 'op');
    const maybeRow: Row | null = unwrapMaybe(maybe, 'op');

    expect(row.name).toBe('A');
    expect(maybeRow).toBeNull();
  });
});
