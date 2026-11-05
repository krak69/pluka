import { describe, expect, it } from 'vitest';

import {
  editionDateRange,
  raceDayLabel,
  raceStartLabel,
  raceTimeLabel,
  safeHttpUrl,
} from '@/app/site/format';
import { practicalGuide, type PracticalRaceFacts } from '@/app/site/practical';
import { siteProgram } from '@/app/site/program';

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

describe('infos pratiques du site', () => {
  const fact = (category: PracticalRaceFacts['facts'][number]['category'], valueText: string) =>
    ({ category, valueText, valueNumber: null, unit: null }) as PracticalRaceFacts['facts'][number];

  it('réunit dans la rubrique le fait publié et le texte de l’organisation', () => {
    const guide = practicalGuide(
      [
        { raceName: '10 km', facts: [fact('bib', 'La veille, 16 h')] },
        { raceName: '30 km', facts: [fact('bib', 'La veille, 16 h')] },
      ],
      [{ title: 'Retrait des dossards', body: 'À la salle.', moment: 'before', topicKey: 'bib_pickup' }],
    );

    expect(guide).toEqual([
      {
        moment: 'before',
        title: 'Avant',
        rubrics: [
          {
            key: 'bib_pickup',
            title: 'Retrait des dossards',
            items: [{ value: 'La veille, 16 h', races: [] }],
            body: 'À la salle.',
          },
        ],
      },
    ]);
  });

  it('nomme les épreuves quand une information ne les concerne pas toutes', () => {
    const guide = practicalGuide(
      [
        { raceName: '10 km', facts: [fact('transport', 'Navette à 7 h')] },
        { raceName: '30 km', facts: [] },
      ],
      [],
    );

    expect(guide[0]?.title).toBe('Pendant');
    expect(guide[0]?.rubrics[0]?.items).toEqual([{ value: 'Navette à 7 h', races: ['10 km'] }]);
  });

  it('range par moment, et laisse les départs aux épreuves', () => {
    const guide = practicalGuide(
      [{ raceName: '10 km', facts: [fact('start', '09:00'), fact('contact', '06 00')] }],
      [
        { title: 'Douches', body: 'Au gymnase.', moment: 'after', topicKey: 'showers' },
        { title: 'Garderie', body: 'Pour les enfants.', moment: 'during', topicKey: null },
      ],
    );

    expect(guide.map((moment) => moment.title)).toEqual(['Avant', 'Pendant', 'Après']);
    expect(guide[0]?.rubrics.map((rubric) => rubric.title)).toEqual(['Contact']);
    expect(guide[1]?.rubrics.map((rubric) => rubric.title)).toEqual(['Garderie']);
  });

  it('n’affiche ni rubrique vide ni moment vide', () => {
    expect(practicalGuide([{ raceName: '10 km', facts: [fact('bib', '  ')] }], [])).toEqual([]);
  });
});

describe('programme du site', () => {
  const race = {
    id: 'aaaaaaaa-0000-4000-8000-000000000013',
    slug: '30-km',
    name: '30 km',
    distanceKm: 30,
    elevationGainM: null,
    startDatetime: '2026-06-20T06:00:00Z',
    timezone: 'Europe/Paris',
    startLocationName: 'Place de l’église',
    registrationUrl: null,
  };
  const item = (startsAt: string, title: string) => ({
    startsAt,
    timezone: 'Europe/Paris',
    title,
    location: null,
  });

  it('range par jour et par heure, et y ajoute les départs', () => {
    const days = siteProgram(
      [item('2026-06-20T17:00:00Z', 'Remise des prix'), item('2026-06-19T16:00:00Z', 'Dossards')],
      [race],
    );

    expect(days.map((day) => day.label)).toEqual(['vendredi 19 juin', 'samedi 20 juin']);
    expect(days[1]?.entries).toEqual([
      {
        key: `race-${race.id}`,
        time: '08:00',
        title: 'Départ · 30 km',
        location: 'Place de l’église',
        href: '/epreuves/30-km',
      },
      {
        key: '2026-06-20T17:00:00Z-Remise des prix',
        time: '19:00',
        title: 'Remise des prix',
        location: null,
        href: null,
      },
    ]);
  });

  it('range une ligne au jour de son fuseau, pas au jour UTC', () => {
    const days = siteProgram([item('2026-06-19T22:30:00Z', 'Veillée')], []);

    expect(days[0]?.label).toBe('samedi 20 juin');
    expect(days[0]?.entries[0]?.time).toBe('00:30');
  });

  it('sans ligne écrite, il n’y a pas de programme', () => {
    expect(siteProgram([], [race])).toEqual([]);
  });
});
