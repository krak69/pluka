import { describe, expect, it } from 'vitest';

import {
  cutoffValue,
  dayLabel,
  elapsedMinutes,
  formatDuration,
  gapsOf,
  sortByKm,
  type WaypointRow,
} from '@/app/courses/[raceId]/waypoints-draft';

/**
 * La saisie des points de passage, sans écran. Une barrière se dit en jour de
 * course et heure ; un temps de course ne repart pas à minuit (AGENTS §34).
 */

const START = { date: '2026-08-28', time: '18:00' };

function row(overrides: Partial<WaypointRow>): WaypointRow {
  return {
    key: 'k',
    id: '',
    name: 'Point',
    waypointType: 'aid_station',
    distanceKm: '',
    cutoffDay: '',
    cutoffTime: '',
    ...overrides,
  };
}

describe('une barrière en jour de course et heure', () => {
  it('compose la date murale du jour choisi, y compris en changeant de mois', () => {
    expect(cutoffValue(row({ cutoffDay: '0', cutoffTime: '23:30' }), START)).toBe(
      '2026-08-28T23:30',
    );
    expect(cutoffValue(row({ cutoffDay: '4', cutoffTime: '06:15' }), START)).toBe(
      '2026-09-01T06:15',
    );
    expect(cutoffValue(row({ cutoffDay: '1', cutoffTime: '' }), START)).toBe('');
  });

  it('nomme le jour comme un règlement', () => {
    expect(dayLabel(START, 0)).toBe('ven. 28 août');
    expect(dayLabel(START, 1)).toBe('sam. 29 août');
  });

  it('compte le temps de course sans repartir à minuit', () => {
    // Départ vendredi 18:00, barrière dimanche 14:00 : 44 heures.
    const minutes = elapsedMinutes(row({ cutoffDay: '2', cutoffTime: '14:00' }), START);
    expect(minutes).toBe(44 * 60);
    expect(formatDuration(minutes ?? 0)).toBe('44 h');
    expect(formatDuration(9 * 60 + 5)).toBe('9 h 05');
  });
});

describe('la chaîne, au kilomètre', () => {
  it('se range par kilomètre, stable, les points sans kilomètre en fin', () => {
    const rows = [
      row({ key: 'a', distanceKm: '0' }),
      row({ key: 'b', distanceKm: '42,2' }),
      row({ key: 'c', distanceKm: '' }),
      row({ key: 'd', distanceKm: '12,5' }),
      row({ key: 'e', distanceKm: '12.5' }),
    ];

    expect(sortByKm(rows).map((entry) => entry.key)).toEqual(['a', 'd', 'e', 'b', 'c']);
  });

  it('dit l’écart avec le point précédent qui a un kilomètre', () => {
    const rows = [
      row({ distanceKm: '0' }),
      row({ distanceKm: '' }),
      row({ distanceKm: '18,5' }),
      row({ distanceKm: '30' }),
    ];

    expect(gapsOf(rows)).toEqual([null, null, 18.5, 11.5]);
  });
});
