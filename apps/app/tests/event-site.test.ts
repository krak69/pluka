import { describe, expect, it } from 'vitest';

import {
  editionDateRange,
  raceDayLabel,
  raceStartLabel,
  raceTimeLabel,
  safeHttpUrl,
} from '@/app/site/format';

/**
 * Le site d'un événement, côté pages — EVENT_SITE §3, §7.2.
 *
 * Un site partage le site navigateur de l'app : un lien venu d'ailleurs ne
 * devient un lien que s'il est http(s). Les dates d'édition sont civiles, les
 * départs se lisent dans le fuseau de l'épreuve.
 */

describe('les liens venus d’ailleurs', () => {
  it('garde http et https', () => {
    expect(safeHttpUrl('https://inscriptions.example/80k')).toBe('https://inscriptions.example/80k');
    expect(safeHttpUrl('http://partenaire.example')).toBe('http://partenaire.example/');
  });

  it('écarte tout autre protocole, et ce qui n’est pas une adresse', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('JavaScript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeHttpUrl('/chemin/relatif')).toBeNull();
    expect(safeHttpUrl('')).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });
});

describe('les dates', () => {
  it('écrit une édition d’un jour, de deux jours, à cheval sur deux mois', () => {
    expect(editionDateRange('2027-06-20', null)).toBe('20 juin 2027');
    expect(editionDateRange('2027-06-19', '2027-06-20')).toBe('19 – 20 juin 2027');
    expect(editionDateRange('2027-06-30', '2027-07-01')).toBe('30 juin – 1 juillet 2027');
  });

  it('lit un départ dans le fuseau de l’épreuve', () => {
    // 04:00 UTC est 06:00 à Paris en juin.
    expect(raceTimeLabel('2026-06-20T04:00:00Z', 'Europe/Paris')).toBe('06:00');
    expect(raceDayLabel('2026-06-20T04:00:00Z', 'Europe/Paris')).toBe('sam. 20 juin');
    // 23:30 UTC le vendredi est déjà samedi à Paris.
    expect(raceStartLabel('2026-06-19T23:30:00Z', 'Europe/Paris')).toBe('sam. 20 juin, 01:30');
  });
});
