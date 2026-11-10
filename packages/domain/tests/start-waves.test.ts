import { DbError, type ParticipantImportRepository } from '@pluka/db';
import { describe, expect, it } from 'vitest';

import {
  DomainError,
  declareStartWave,
  updateStartWave,
  type ParticipantImportContext,
} from '../src/index.js';

/** Vagues de départ — migration 0081. */

const RACE_ID = '00000000-0000-4000-8000-000000000013';
const WAVE_ID = '00000000-0000-4000-8000-000000000081';

function context(behaviour: 'ok' | DbError = 'ok') {
  const calls: unknown[][] = [];
  const repository = {
    declareStartWave: (...args: unknown[]) => {
      calls.push(['declare', ...args]);
      return behaviour === 'ok' ? Promise.resolve(WAVE_ID) : Promise.reject(behaviour);
    },
    updateStartWave: (...args: unknown[]) => {
      calls.push(['update', ...args]);
      return behaviour === 'ok' ? Promise.resolve() : Promise.reject(behaviour);
    },
  } as unknown as ParticipantImportRepository;
  const value: ParticipantImportContext = { repositories: { participantImports: repository } };
  return { value, calls };
}

describe('déclarer une vague', () => {
  it('convertit le jour et l’heure civils de l’épreuve en instant, heure d’été comprise', async () => {
    const { value, calls } = context();

    await expect(
      declareStartWave(value, {
        raceId: RACE_ID,
        name: '  Élite ',
        day: '2026-06-20',
        time: '06:30',
        timeZone: 'Europe/Paris',
      }),
    ).resolves.toBe(WAVE_ID);
    expect(calls).toEqual([['declare', RACE_ID, 'Élite', '2026-06-20T04:30:00.000Z']]);
  });

  it('suit l’heure d’hiver', async () => {
    const { value, calls } = context();

    await updateStartWave(value, {
      waveId: WAVE_ID,
      name: 'Élite',
      day: '2026-12-05',
      time: '06:30',
      timeZone: 'Europe/Paris',
    });
    expect(calls[0]?.[3]).toBe('2026-12-05T05:30:00.000Z');
  });

  it('refuse un nom vide ou une heure illisible avant d’appeler la base', async () => {
    const { value, calls } = context();

    await expect(
      declareStartWave(value, {
        raceId: RACE_ID,
        name: ' ',
        day: '2026-06-20',
        time: '25:00',
        timeZone: 'Europe/Paris',
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(calls).toEqual([]);
  });

  it('dit qu’une vague porte déjà ce nom', async () => {
    const { value } = context(
      new DbError({ code: 'conflict', operation: 'org_declare_start_wave', message: 'x' }),
    );

    await expect(
      declareStartWave(value, {
        raceId: RACE_ID,
        name: 'Élite',
        day: '2026-06-20',
        time: '06:30',
        timeZone: 'Europe/Paris',
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('traduit le refus de rôle', async () => {
    const { value } = context(
      new DbError({ code: 'permission_denied', operation: 'org_update_start_wave', message: 'x' }),
    );

    await expect(
      updateStartWave(value, {
        waveId: WAVE_ID,
        name: 'Élite',
        day: '2026-06-20',
        time: '06:30',
        timeZone: 'Europe/Paris',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
