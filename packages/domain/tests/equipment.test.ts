import { DbError, type EditableFactRecord, type FactEditingRepository } from '@pluka/db';
import { describe, expect, it } from 'vitest';

import {
  addRaceEquipment,
  equipmentKey,
  equipmentOf,
  listRaceEquipment,
  reviseRaceEquipment,
  type FactEditingContext,
} from '../src/index.js';

/**
 * Matériel d'une épreuve — migration 0045. Pas de catalogue : le nom est
 * celui du règlement, la clé n'en est qu'un rapprochement. La garde est en
 * base (pgTAP 31) ; ici, la frontière et la lecture.
 */

const RACE_A = '00000000-0000-4000-8000-000000000301';
const RACE_B = '00000000-0000-4000-8000-000000000302';
const FACT = '00000000-0000-4000-8000-000000000303';

function fact(overrides: Partial<EditableFactRecord> = {}): EditableFactRecord {
  return {
    factId: FACT,
    category: 'equipment',
    factKey: 'equipment.gants',
    archivedAt: null,
    versionId: 'v',
    versionNumber: 1,
    valueText: 'Gants',
    valueNumber: null,
    unit: null,
    valueJson: { requirement: 'conditional', condition: 'Si température < 5 °C', detail: null },
    trustLevel: 'official',
    publishedAt: '2026-10-08T10:00:00Z',
    source: { title: 'Saisie manuelle', page: null, excerpt: 'Saisie manuelle' },
    ...overrides,
  };
}

function context(overrides: Partial<FactEditingRepository> = {}): {
  readonly context: FactEditingContext;
  readonly calls: unknown[];
} {
  const calls: unknown[] = [];
  const repository: FactEditingRepository = {
    listForEditing: async () => [fact(), fact({ factId: 'x', category: 'cutoff', factKey: 'c' })],
    history: async () => [],
    revise: async () => 'v',
    retire: async () => undefined,
    restore: async () => undefined,
    addEquipment: async (input) => {
      calls.push(input);
      return input.raceIds.length;
    },
    reviseEquipment: async (input) => {
      calls.push(input);
      return 'v2';
    },
    ...overrides,
  };
  return { context: { repositories: { factEditing: repository }, actor: { userId: 'u' } }, calls };
}

describe('clé de rapprochement', () => {
  it('tire une clé stable du nom, sans accent', () => {
    expect(equipmentKey('  Veste imperméable (membrane) ')).toBe(
      'equipment.veste-impermeable-membrane',
    );
    expect(equipmentKey('Réserve d’eau 1 L')).toBe('equipment.reserve-d-eau-1-l');
    expect(equipmentKey('!!!')).toBeNull();
  });
});

describe('ajouter', () => {
  it('à plusieurs épreuves, une clé tirée du nom, doublons d’épreuve retirés', async () => {
    const { context: ctx, calls } = context();

    await expect(
      addRaceEquipment(ctx, {
        raceIds: [RACE_A, RACE_B, RACE_A],
        label: 'Couverture de survie',
        requirement: 'mandatory',
        condition: '',
        detail: null,
        trustLevel: 'pluka_validated',
      }),
    ).resolves.toEqual({ added: 2 });
    expect(calls[0]).toMatchObject({
      raceIds: [RACE_A, RACE_B],
      factKey: 'equipment.couverture-de-survie',
      condition: null,
    });
  });

  it('un conditionnel sans condition est refusé avant la base', async () => {
    const { context: ctx, calls } = context();
    const error = await addRaceEquipment(ctx, {
      raceIds: [RACE_A],
      label: 'Gants',
      requirement: 'conditional',
      condition: '  ',
      trustLevel: 'official',
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'validation', details: { condition: expect.any(String) } });
    expect(calls).toEqual([]);
  });

  it('déjà présent : le refus se pose contre le nom', async () => {
    const { context: ctx } = context({
      addEquipment: async () => {
        throw new DbError({ code: 'conflict', operation: 'add_race_equipment', message: 'déjà' });
      },
    });
    await expect(
      addRaceEquipment(ctx, {
        raceIds: [RACE_A],
        label: 'Gants',
        requirement: 'mandatory',
        trustLevel: 'official',
      }),
    ).rejects.toMatchObject({ code: 'validation', details: { label: expect.any(String) } });
  });

  it('« Officielle » refusée par la base : la raison suit', async () => {
    const { context: ctx } = context({
      addEquipment: async () => {
        throw new DbError({
          code: 'permission_denied',
          operation: 'add_race_equipment',
          message: 'OFFICIAL_AUTHORIZATION_REQUIRED',
        });
      },
    });
    await expect(
      addRaceEquipment(ctx, {
        raceIds: [RACE_A],
        label: 'Gants',
        requirement: 'mandatory',
        trustLevel: 'official',
      }),
    ).rejects.toMatchObject({
      code: 'forbidden',
      details: { reason: 'OFFICIAL_AUTHORIZATION_REQUIRED' },
    });
  });
});

describe('lire et corriger', () => {
  it('ne liste que le matériel, structure comprise', async () => {
    const items = await listRaceEquipment(context().context, { raceId: RACE_A });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      label: 'Gants',
      requirement: 'conditional',
      condition: 'Si température < 5 °C',
      retired: false,
    });
  });

  it('un matériel extrait sans exigence reste « non précisé », jamais obligatoire', () => {
    expect(equipmentOf(fact({ valueJson: null })).requirement).toBeNull();
    expect(equipmentOf(fact({ valueJson: { requirement: 'peut-être' } })).requirement).toBeNull();
  });

  it('corriger rend la nouvelle version', async () => {
    const { context: ctx, calls } = context();
    await expect(
      reviseRaceEquipment(ctx, {
        factId: FACT,
        label: 'Gants chauds',
        requirement: 'mandatory',
        trustLevel: 'official',
      }),
    ).resolves.toEqual({ versionId: 'v2' });
    expect(calls[0]).toMatchObject({ label: 'Gants chauds', condition: null, detail: null });
  });
});
