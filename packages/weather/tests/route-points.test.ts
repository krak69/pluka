import { describe, expect, it } from 'vitest';

import {
  WEATHER_ENGINE_V1,
  assembleWeatherRoutePoints,
  planWeatherRoutePoints,
  type TracePosition,
} from '../src/index.js';
import { HOUR, WITH_VIRTUAL, point, timeline } from './fixtures.js';

/**
 * Les points météo d'un Plan — WEATHER_CONDITIONS §13 à §21, W07 à W09,
 * W11 à W14. En v1, seuls le départ, l’arrivée, les points de passage, les
 * ravitaillements, les sommets et les cols ; rien d’ajouté entre eux.
 */

describe('les passages en vraies dates (§13, §14)', () => {
  it('W07 — un passage à 17:08 est un instant ISO, pas un nombre de minutes', () => {
    // Départ 06:00 à Paris (04:00 UTC), passage 11 h 08 plus tard.
    const plan = planWeatherRoutePoints(
      timeline([point('depart', 0, 0), point('rawil', 8, 11 * HOUR + 8 * 60)]),
      WEATHER_ENGINE_V1,
    );

    expect(plan.waypoints.map((entry) => entry.plannedDatetime)).toEqual([
      '2026-09-12T04:00:00.000Z',
      '2026-09-12T15:08:00.000Z',
    ]);
  });

  it('W08 — un passage après minuit tombe le lendemain', () => {
    const plan = planWeatherRoutePoints(
      timeline([point('depart', 0, 0), point('nuit', 9, 20 * HOUR)]),
      WEATHER_ENGINE_V1,
    );

    expect(plan.waypoints[1]?.plannedDatetime).toBe('2026-09-13T00:00:00.000Z');
  });

  it('W09 — un ultra de plusieurs jours garde des dates croissantes', () => {
    const points = [0, 1, 2, 3, 4].map((day) => point(`p${String(day)}`, day * 9, day * 26 * HOUR));
    const dates = planWeatherRoutePoints(timeline(points), WEATHER_ENGINE_V1).waypoints.map(
      (entry) => entry.plannedDatetime,
    );

    expect(dates).toEqual([...dates].sort());
    expect(dates.at(-1)).toBe('2026-09-16T12:00:00.000Z');
  });
});

describe('les points utiles (§18)', () => {
  it('W11 — départ, points du Plan et arrivée ; un point sans coordonnées est signalé', () => {
    const plan = planWeatherRoutePoints(
      timeline([
        point('depart', 0, 0),
        point('ravito', 6, HOUR),
        point('col', 9, 2 * HOUR, { latitude: null, longitude: null }),
        point('arrivee', 14, 3 * HOUR, { nextSegmentId: null }),
      ]),
      WEATHER_ENGINE_V1,
    );

    expect(plan.waypoints.map((entry) => entry.pointKey)).toEqual([
      'wp-depart',
      'wp-ravito',
      'wp-arrivee',
    ]);
    expect(plan.issues).toEqual([{ kind: 'missing_coordinates', pointId: 'col' }]);
    expect(plan.waypoints[0]).toMatchObject({
      sourceType: 'race_waypoint',
      raceWaypointId: 'depart',
      routeAltitudeM: 1000,
    });
  });

  it('ne retient que départ, arrivée, passages, ravitos, sommets et cols', () => {
    const plan = planWeatherRoutePoints(
      timeline([
        point('depart', 0, 0, { kind: 'start' }),
        point('eau', 4, HOUR, { kind: 'water' }),
        point('ravito', 6, 1.5 * HOUR, { kind: 'aid_station' }),
        point('assistance', 7, 1.8 * HOUR, { kind: 'assistance' }),
        point('barriere', 8, 2 * HOUR, { kind: 'cutoff' }),
        point('col', 10, 2.5 * HOUR, { kind: 'pass' }),
        point('photo', 11, 2.7 * HOUR, { kind: 'other' }),
        point('sommet', 12, 3 * HOUR, { kind: 'summit' }),
        point('pointage', 15, 3.5 * HOUR, { kind: 'checkpoint' }),
        point('arrivee', 20, 4.5 * HOUR, { kind: 'finish', nextSegmentId: null }),
      ]),
      WEATHER_ENGINE_V1,
    );

    expect(plan.waypoints.map((entry) => entry.pointKey)).toEqual([
      'wp-depart',
      'wp-ravito',
      'wp-col',
      'wp-sommet',
      'wp-pointage',
      'wp-arrivee',
    ]);
    // Un point écarté par choix n'est pas un manque.
    expect(plan.issues).toEqual([]);
  });

  it('garde toujours le départ et l’arrivée, quel que soit leur type', () => {
    const plan = planWeatherRoutePoints(
      timeline([point('a', 0, 0, { kind: 'other' }), point('b', 8, HOUR, { kind: 'water' })]),
      WEATHER_ENGINE_V1,
    );

    expect(plan.waypoints.map((entry) => entry.pointKey)).toEqual(['wp-a', 'wp-b']);
  });

  it('n’ajoute aucun point sur une longue section', () => {
    const plan = planWeatherRoutePoints(
      timeline([point('a', 0, 0), point('b', 40, 6 * HOUR)]),
      WEATHER_ENGINE_V1,
    );

    expect(plan.virtual).toEqual([]);
  });

  it('garde l’altitude du parcours, même nulle', () => {
    const plan = planWeatherRoutePoints(
      timeline([point('depart', 0, 0, { altitudeM: null }), point('b', 5, HOUR)]),
      WEATHER_ENGINE_V1,
    );

    expect(plan.waypoints[0]?.routeAltitudeM).toBeNull();
  });
});

describe('les points virtuels (§19 à §21)', () => {
  it('W12 — une section de 25 km reçoit deux points, à distance et heure régulières', () => {
    const plan = planWeatherRoutePoints(
      timeline([point('a', 0, 0), point('b', 25, 3 * HOUR)]),
      WITH_VIRTUAL,
    );

    // 25 km → 3 tronçons de 8,3 km ; 3 h → 2 tronçons : la distance l'emporte.
    expect(plan.virtual).toEqual([
      {
        pointKey: 'weather-mid-seg-01-01',
        virtualSegmentId: 'seg-a',
        label: 'Entre a et b',
        distanceKm: 8.333,
        elapsedSeconds: HOUR,
      },
      {
        pointKey: 'weather-mid-seg-01-02',
        virtualSegmentId: 'seg-a',
        label: 'Entre a et b',
        distanceKm: 16.667,
        elapsedSeconds: 2 * HOUR,
      },
    ]);
  });

  it('une section courte mais longue en temps en reçoit aussi', () => {
    // 6 km en 4 h 30 (une grosse montée) : la durée l'emporte, un point toutes les 1 h 30.
    const plan = planWeatherRoutePoints(
      timeline([point('a', 0, 0), point('b', 6, 4.5 * HOUR)]),
      WITH_VIRTUAL,
    );

    expect(plan.virtual.map((entry) => entry.elapsedSeconds)).toEqual([1.5 * HOUR, 3 * HOUR]);
    expect(plan.virtual.map((entry) => entry.distanceKm)).toEqual([2, 4]);
  });

  it('compte le temps de déplacement depuis la fin de l’arrêt', () => {
    // Arrêt d'une heure au point a : la section dure 2 h, pas 3.
    const plan = planWeatherRoutePoints(
      timeline([point('a', 0, 0, { departureElapsedSeconds: HOUR }), point('b', 8, 3 * HOUR)]),
      WITH_VIRTUAL,
    );

    expect(plan.virtual.map((entry) => entry.elapsedSeconds)).toEqual([2 * HOUR]);
  });

  it('W13 — plusieurs longues sections : des clés uniques', () => {
    const plan = planWeatherRoutePoints(
      timeline([point('a', 0, 0), point('b', 15, 2 * HOUR), point('c', 40, 5 * HOUR)]),
      WITH_VIRTUAL,
    );
    const keys = plan.virtual.map((entry) => entry.pointKey);

    expect(keys).toEqual([
      'weather-mid-seg-01-01',
      'weather-mid-seg-02-01',
      'weather-mid-seg-02-02',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('W14 — un point virtuel prend la position, l’altitude et l’heure de la trace', () => {
    const line = timeline([point('a', 0, 0), point('b', 15, 2 * HOUR)]);
    const plan = planWeatherRoutePoints(line, WITH_VIRTUAL);
    const positions = new Map<string, TracePosition>([
      ['weather-mid-seg-01-01', { latitude: 45.95, longitude: 6.91, altitudeM: 2429 }],
    ]);
    const { points, issues } = assembleWeatherRoutePoints(line, plan, positions);

    expect(points.map((entry) => entry.pointKey)).toEqual([
      'wp-a',
      'weather-mid-seg-01-01',
      'wp-b',
    ]);
    expect(points[1]).toMatchObject({
      sourceType: 'virtual_checkpoint',
      virtualSegmentId: 'seg-a',
      latitude: 45.95,
      longitude: 6.91,
      routeAltitudeM: 2429,
      distanceKm: 7.5,
      elapsedSeconds: HOUR,
      plannedDatetime: '2026-09-12T05:00:00.000Z',
    });
    expect(issues).toEqual([]);
  });

  it('un point virtuel que la trace ne sait pas placer est écarté, pas inventé', () => {
    const line = timeline([point('a', 0, 0), point('b', 15, 2 * HOUR)]);
    const plan = planWeatherRoutePoints(line, WITH_VIRTUAL);
    const { points, issues } = assembleWeatherRoutePoints(line, plan, new Map());

    expect(points.map((entry) => entry.pointKey)).toEqual(['wp-a', 'wp-b']);
    expect(issues).toEqual([{ kind: 'virtual_unresolved', pointKey: 'weather-mid-seg-01-01' }]);
  });

  it('rejoue à l’identique', () => {
    const line = timeline([point('a', 0, 0), point('b', 33, 5 * HOUR), point('c', 40, 6 * HOUR)]);

    expect(planWeatherRoutePoints(line, WITH_VIRTUAL)).toEqual(
      planWeatherRoutePoints(line, WITH_VIRTUAL),
    );
  });
});
