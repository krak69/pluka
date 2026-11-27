import type { RaceConditionsView } from '@pluka/domain';
import { describe, expect, it } from 'vitest';

import {
  conditionsNextPoint,
  conditionsRaceLine,
  conditionsScreen,
  conditionsTeaser,
  profileWeather,
} from '@/lib/conditions-format';

/**
 * L'écran Conditions — WEATHER_CONDITIONS §7, §9, §11, §50 à §59. Départ
 * samedi 12 septembre 2026, 08:00 à Paris.
 */

const PR = 'pr-1';

function view(patch: Partial<RaceConditionsView> = {}): RaceConditionsView {
  return {
    status: 'eligible',
    daysToStart: 2,
    opensOn: '2026-08-29',
    horizon: 'near',
    timezone: 'Europe/Paris',
    startAt: '2026-09-12T06:00:00.000Z',
    forecast: {
      fetchedAt: '2026-09-10T16:20:00.000Z',
      completeness: 'complete',
      points: [
        {
          pointKey: 'wp-depart',
          raceWaypointId: 'depart',
          label: 'Départ',
          distanceKm: 0,
          elapsedSeconds: 0,
          routeAltitudeM: 1035,
          plannedDatetime: '2026-09-12T06:00:00.000Z',
          temperatureC: 6.4,
          apparentTemperatureC: 3.2,
          precipitationProbabilityPct: 0,
          precipitationAmountMm: 0,
          windSpeedKmh: 8,
          windGustKmh: 20,
          windDirectionDeg: 180,
          weatherCode: 'clear',
          fetchedAt: '2026-09-10T16:20:00.000Z',
        },
        {
          pointKey: 'wp-rawil',
          raceWaypointId: 'rawil',
          label: 'Col du Rawil',
          distanceKm: 40.5,
          elapsedSeconds: 33600,
          routeAltitudeM: 2429,
          plannedDatetime: '2026-09-12T15:20:00.000Z',
          temperatureC: 4,
          apparentTemperatureC: null,
          precipitationProbabilityPct: 60,
          precipitationAmountMm: 1.2,
          windSpeedKmh: 22,
          windGustKmh: 52,
          windDirectionDeg: 280,
          weatherCode: 'rain',
          fetchedAt: '2026-09-10T16:20:00.000Z',
        },
      ],
      nights: [
        {
          startDatetime: '2026-09-12T18:10:00.000Z',
          endDatetime: '2026-09-12T20:00:00.000Z',
          startElapsedSeconds: 43800,
          endElapsedSeconds: 50400,
          fromStart: false,
          untilFinish: true,
        },
      ],
    },
    lastFailureAt: null,
    refreshDue: false,
    attribution: {
      text: 'Weather data by Open-Meteo.com',
      url: 'https://open-meteo.com/',
      licence: 'CC BY 4.0',
      licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    },
    ...patch,
  };
}

describe('l’écran Conditions', () => {
  it('§7 — avant J-14, le jour d’ouverture, sans aucune tendance', () => {
    expect(
      conditionsScreen(view({ status: 'too_early', forecast: null, horizon: null }), PR),
    ).toMatchObject({
      kind: 'unavailable',
      title: 'Conditions disponibles à partir du samedi 29 août',
      action: null,
    });
  });

  it('§11 — sans Plan, propose de le créer', () => {
    expect(conditionsScreen(view({ status: 'no_plan', forecast: null }), PR)).toMatchObject({
      kind: 'unavailable',
      title: 'Crée ton Plan pour voir les conditions selon tes heures de passage',
      action: { href: '/courses/pr-1/plan' },
    });
  });

  it('W03 — sans Race Pass, l’offre, et les informations officielles restent à tous', () => {
    const screen = conditionsScreen(view({ status: 'not_entitled', forecast: null }), PR);

    expect(screen).toMatchObject({
      kind: 'unavailable',
      action: { href: '/offre?course=pr-1', primary: true },
    });
    expect(screen.kind === 'unavailable' && screen.body).toContain('officielles');
  });

  it('attend la première prévision, ou dit qu’elle est indisponible (§54)', () => {
    expect(conditionsScreen(view({ forecast: null }), PR)).toEqual({
      kind: 'waiting',
      failed: false,
    });
    expect(
      conditionsScreen(view({ forecast: null, lastFailureAt: '2026-09-10T16:00:00.000Z' }), PR),
    ).toEqual({ kind: 'waiting', failed: true });
  });

  it('§9, §53 — horizon qualitatif et heure de mise à jour', () => {
    expect(conditionsScreen(view(), PR)).toMatchObject({
      kind: 'forecast',
      horizon: 'Prévision rapprochée',
      updated: 'jeu. 10 sept. à 18:20',
      notices: [],
    });
    expect(conditionsRaceLine(view())).toBe('sam. 12 sept. · 08:00 · Départ');
  });

  it('§50 — « Sur ton parcours » : les extrêmes, et où ils tombent', () => {
    const screen = conditionsScreen(view(), PR);

    expect(screen.kind === 'forecast' && screen.summary).toEqual({
      range: '4 → 6 °C',
      feelsMin: '3 °C',
      feelsMinAt: 'ressenti minimum · Départ',
      gustMax: '52 km/h',
      gustMaxAt: 'rafales max · Col du Rawil',
      rain: 'Pluie jusqu’à 60 %',
      rainAt: 'Col du Rawil · 17:20',
    });
    expect(screen.kind === 'forecast' && screen.nights).toEqual([
      'Nuit : sam. 12 sept. 20:10 → jusqu’à l’arrivée',
    ]);
  });

  it('§52, §54 — chaque point à son heure de passage, une mesure absente en « — »', () => {
    const screen = conditionsScreen(view(), PR);

    expect(screen.kind === 'forecast' && screen.points[1]).toEqual({
      key: 'wp-rawil',
      eta: '17:20',
      passage: 'sam. 12 sept. · 17:20',
      name: 'Col du Rawil',
      // Le format français sépare les milliers par une espace fine insécable.
      meta: 'km 40,5 · 2 429 m',
      sky: 'Pluie',
      icon: 'CloudRain',
      temperature: '4 °C',
      feelsLike: 'ressenti —',
      gust: 'rafales 52 km/h',
      rain: '60 %',
      rainAmount: '1,2 mm',
      wind: '22 km/h',
      windFrom: 'O',
    });
  });

  it('§55, §90 — un run partiel et un échec récent sont dits', () => {
    const screen = conditionsScreen(
      view({
        lastFailureAt: '2026-09-10T17:00:00.000Z',
        forecast: { ...view().forecast!, completeness: 'partial' },
      }),
      PR,
    );

    expect(screen.kind === 'forecast' && screen.notices).toHaveLength(2);
    expect(screen.kind === 'forecast' && screen.notices[1]).toContain('19:00');
  });

  it('Accueil — « Conditions disponibles » seulement une fois J-14 ouvert', () => {
    expect(conditionsTeaser(view())).toBe('Prévision rapprochée');
    expect(conditionsTeaser(view({ status: 'not_entitled', forecast: null }))).toBe(
      'Race Pass · PLUKA+',
    );
    expect(conditionsTeaser(view({ status: 'too_early', forecast: null, horizon: null }))).toBe(
      null,
    );
  });

  it('Accueil — le prochain point clé et ce qui l’y attend', () => {
    // Avant le départ, c'est le départ ; dans la journée, le point suivant.
    expect(conditionsNextPoint(view(), new Date('2026-09-10T08:00:00.000Z'))).toMatchObject({
      name: 'Départ',
      temperature: '6 °',
      feelsLike: 'ressenti 3 °',
      wind: 'vent 8 km/h',
      icon: 'Sun',
    });
    expect(conditionsNextPoint(view(), new Date('2026-09-12T09:00:00.000Z'))?.name).toBe(
      'Col du Rawil',
    );
    expect(conditionsNextPoint(view(), new Date('2026-09-13T09:00:00.000Z'))).toBeNull();
  });
});

describe('la météo sur le profil du Plan', () => {
  it('le ciel et la température de chaque point, datés et sourcés (§53)', () => {
    const weather = profileWeather(view());

    expect(weather?.updated).toBe('jeu. 10 sept. à 18:20');
    expect(weather?.attribution.text).toBe('Weather data by Open-Meteo.com');
    expect(weather?.marks).toEqual([
      {
        key: 'wp-depart',
        raceWaypointId: 'depart',
        distanceKm: 0,
        icon: 'Sun',
        temperature: '6 °',
        text: 'Ciel dégagé, 6 °C',
      },
      {
        key: 'wp-rawil',
        raceWaypointId: 'rawil',
        distanceKm: 40.5,
        icon: 'CloudRain',
        temperature: '4 °',
        text: 'Pluie, 4 °C',
      },
    ]);
  });

  it('W01, W03 — rien avant J-14, sans Race Pass ou sans prévision : pas de teaser', () => {
    expect(profileWeather(view({ status: 'too_early', forecast: null, horizon: null }))).toBeNull();
    expect(profileWeather(view({ status: 'not_entitled', forecast: null }))).toBeNull();
    expect(profileWeather(view({ forecast: null }))).toBeNull();
  });

  it('§54 — une mesure absente n’est jamais remplacée ; un point sans rien n’est pas posé', () => {
    const base = view().forecast;
    if (base === null) throw new Error('fixture');
    const [depart, rawil] = base.points as [
      (typeof base.points)[number],
      (typeof base.points)[number],
    ];
    const weather = profileWeather(
      view({
        forecast: {
          ...base,
          points: [
            { ...depart, weatherCode: null },
            { ...rawil, temperatureC: null, weatherCode: null },
            { ...rawil, pointKey: 'sans-km', distanceKm: null },
          ],
        },
      }),
    );

    expect(weather?.marks).toEqual([
      expect.objectContaining({ key: 'wp-depart', icon: null, temperature: '6 °', text: '6 °C' }),
    ]);
    expect(
      profileWeather(
        view({
          forecast: { ...base, points: [{ ...rawil, temperatureC: null, weatherCode: null }] },
        }),
      ),
    ).toBeNull();
  });
});
