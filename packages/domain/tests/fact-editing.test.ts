import { DbError, type FactEditingRepository } from '@pluka/db';
import { describe, expect, it } from 'vitest';

import {
  restoreRaceFact,
  retireRaceFact,
  reviseRaceFact,
  type FactEditingContext,
} from '../src/index.js';

/** Corriger, retirer, restaurer une information publiée — migration 0043. */

const FACT = '00000000-0000-4000-8000-000000000193';

function context(overrides: Partial<FactEditingRepository> = {}): {
  readonly context: FactEditingContext;
  readonly calls: unknown[];
} {
  const calls: unknown[] = [];
  const repository: FactEditingRepository = {
    listForEditing: async () => [],
    history: async () => [],
    revise: async (input) => {
      calls.push(input);
      return 'version-id';
    },
    retire: async (factId, note) => {
      calls.push({ retire: factId, note });
    },
    restore: async (factId, note) => {
      calls.push({ restore: factId, note });
    },
    addEquipment: async () => 0,
    reviseEquipment: async () => 'version-id',
    ...overrides,
  };

  return { context: { repositories: { factEditing: repository }, actor: { userId: 'u' } }, calls };
}

const VALID = {
  factId: FACT,
  valueText: 'Veste imperméable avec capuche',
  valueNumber: null,
  unit: '',
  trustLevel: 'pluka_validated',
  note: '',
};

describe('corriger', () => {
  it('transmet la correction, une unité vide devenue nulle', async () => {
    const { context: ctx, calls } = context();

    expect(await reviseRaceFact(ctx, VALID)).toEqual({ versionId: 'version-id' });
    expect(calls[0]).toMatchObject({ valueText: VALID.valueText, unit: null });
  });

  it('refuse une correction sans valeur, ou un niveau non publiable', async () => {
    const { context: ctx, calls } = context();

    for (const input of [
      { ...VALID, valueText: '', valueNumber: null },
      { ...VALID, trustLevel: 'community' },
    ]) {
      await expect(reviseRaceFact(ctx, input)).rejects.toMatchObject({ code: 'validation' });
    }
    expect(calls).toEqual([]);
  });

  it('pose « identique » contre la valeur, pas comme un état', async () => {
    const { context: ctx } = context({
      revise: async () => {
        throw new DbError({
          code: 'invalid_state',
          operation: 'revise_race_fact',
          message: 'aucune modification',
        });
      },
    });

    await expect(reviseRaceFact(ctx, VALID)).rejects.toMatchObject({
      code: 'validation',
      details: { valueText: expect.any(String) },
    });
  });

  it('nomme un refus d’autorité comme tel', async () => {
    const { context: ctx } = context({
      revise: async () => {
        throw new DbError({ code: 'permission_denied', operation: 'x', message: 'x' });
      },
    });

    await expect(reviseRaceFact(ctx, VALID)).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('retirer, restaurer', () => {
  it('passent l’intention, la note vide devenue nulle', async () => {
    const { context: ctx, calls } = context();

    await retireRaceFact(ctx, { factId: FACT, note: null });
    await restoreRaceFact(ctx, { factId: FACT });

    expect(calls).toEqual([
      { retire: FACT, note: null },
      { restore: FACT, note: null },
    ]);
  });

  it('un retrait déjà fait est un état, pas une panne', async () => {
    const { context: ctx } = context({
      retire: async () => {
        throw new DbError({ code: 'invalid_state', operation: 'x', message: 'x' });
      },
    });

    await expect(retireRaceFact(ctx, { factId: FACT })).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });
});
