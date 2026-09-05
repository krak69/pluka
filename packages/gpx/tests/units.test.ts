import { describe, expect, it } from 'vitest';

import {
  cleanTrack,
  computeElevationProfile,
  cumulativeDistances,
  haversineMeters,
  parseGpx,
  smoothElevations,
} from '../src/index.js';

/** Un degré de latitude vaut environ 111,2 km — la référence la plus stable. */
const ONE_DEGREE_LATITUDE_METERS = 111195;

describe('haversine', () => {
  it('rend zéro pour un point sur lui-même', () => {
    expect(
      haversineMeters({ latitude: 45.9, longitude: 6.8 }, { latitude: 45.9, longitude: 6.8 }),
    ).toBe(0);
  });

  it('mesure un degré de latitude', () => {
    const distance = haversineMeters(
      { latitude: 45, longitude: 6 },
      { latitude: 46, longitude: 6 },
    );

    expect(distance).toBeGreaterThan(ONE_DEGREE_LATITUDE_METERS - 300);
    expect(distance).toBeLessThan(ONE_DEGREE_LATITUDE_METERS + 300);
  });

  it('est symétrique', () => {
    const a = { latitude: 45.9, longitude: 6.8 };
    const b = { latitude: 46.1, longitude: 7.1 };

    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 9);
  });

  it('reste stable sur une très petite distance', () => {
    // Le cas courant entre deux points GPS. La loi des cosinus sphériques y
    // perdrait sa précision ; le haversine la conserve.
    const distance = haversineMeters(
      { latitude: 45.9, longitude: 6.8 },
      { latitude: 45.90001, longitude: 6.8 },
    );

    expect(distance).toBeGreaterThan(1.0);
    expect(distance).toBeLessThan(1.2);
  });

  it('traverse l’antiméridien sans exploser', () => {
    const distance = haversineMeters(
      { latitude: 0, longitude: 179.999 },
      { latitude: 0, longitude: -179.999 },
    );

    // Deux millièmes de degré à l'équateur : environ 222 m, pas la moitié du globe.
    expect(distance).toBeLessThan(300);
  });
});

describe('distance cumulée', () => {
  it('commence à zéro et croît', () => {
    const distances = cumulativeDistances([
      { latitude: 45.9, longitude: 6.8 },
      { latitude: 45.901, longitude: 6.8 },
      { latitude: 45.902, longitude: 6.8 },
    ]);

    expect(distances[0]).toBe(0);
    expect(distances[1]).toBeGreaterThan(0);
    expect(distances[2]).toBeGreaterThan(distances[1] as number);
  });

  it('ignore l’altitude : la distance est horizontale', () => {
    // La distance officielle d'une course est mesurée au sol. Intégrer la
    // composante verticale la gonflerait et déclencherait à tort le contrôle
    // « distance GPX vs officielle » de §9.
    const flat = cumulativeDistances([
      { latitude: 45.9, longitude: 6.8 },
      { latitude: 45.901, longitude: 6.8 },
    ]);

    expect(flat[1]).toBeGreaterThan(110);
    expect(flat[1]).toBeLessThan(115);
  });

  it('rend un tableau de même longueur que l’entrée', () => {
    expect(cumulativeDistances([{ latitude: 0, longitude: 0 }])).toEqual([0]);
    expect(cumulativeDistances([])).toEqual([]);
  });
});

describe('lissage d’altitude', () => {
  it('atténue un pic isolé', () => {
    // Bruit GPS vertical typique : un point à +30 m au milieu d'un plat.
    const elevations = [1000, 1000, 1030, 1000, 1000];
    const distances = [0, 10, 20, 30, 40];

    const smoothed = smoothElevations(elevations, distances, 50);

    expect(smoothed[2]).toBeLessThan(1030);
    expect(smoothed[2]).toBeGreaterThan(1000);
  });

  it('n’invente pas d’altitude là où elle manque', () => {
    // Combler un trou par interpolation rendrait une altitude inventée
    // indiscernable d'une altitude mesurée.
    const smoothed = smoothElevations([1000, null, 1010], [0, 10, 20], 50);

    expect(smoothed[1]).toBeNull();
  });

  it('utilise une fenêtre horizontale, pas un nombre de points', () => {
    // Points serrés puis espacés : avec une fenêtre en nombre de points, le
    // lissage serait plus fort là où les points sont denses — c'est-à-dire en
    // montée, exactement là où le relief compte.
    const distances = [0, 1, 2, 3, 1000];
    const elevations = [1000, 1000, 1000, 1000, 2000];

    const smoothed = smoothElevations(elevations, distances, 50);

    // Le point lointain n'entre dans aucune fenêtre des quatre premiers.
    expect(smoothed[0]).toBe(1000);
    expect(smoothed[4]).toBe(2000);
  });
});

describe('profil altimétrique', () => {
  it('somme les montées et les descentes séparément', () => {
    // Fenêtre nulle : on teste la somme, pas le lissage.
    const profile = computeElevationProfile([100, 110, 105, 125], [0, 100, 200, 300], 0);

    expect(profile.gainMeters).toBeCloseTo(30, 6);
    expect(profile.lossMeters).toBeCloseTo(5, 6);
  });

  it('ne relie pas deux tronçons séparés par une altitude manquante', () => {
    // Le dénivelé de l'intervalle inconnu ne peut pas être attribué à la
    // première mesure retrouvée : ce serait inventer une marche.
    const profile = computeElevationProfile([100, null, 500], [0, 100, 200], 0);

    expect(profile.gainMeters).toBe(0);
    expect(profile.lossMeters).toBe(0);
  });

  it('rend des extrêmes nuls sur un profil sans altitude', () => {
    const profile = computeElevationProfile([null, null], [0, 10], 0);

    expect(profile.minMeters).toBeNull();
    expect(profile.maxMeters).toBeNull();
    expect(profile.gainMeters).toBe(0);
  });
});

describe('nettoyage', () => {
  function point(latitude: number, elevationMeters: number | null = 1000) {
    return { latitude, longitude: 6.8, elevationMeters, time: null };
  }

  it('retire les doublons de capture', () => {
    const { points, report } = cleanTrack([point(45.9), point(45.9), point(45.901)]);

    expect(points).toHaveLength(2);
    expect(report.duplicatesRemoved).toBe(1);
  });

  it('écarte un saut manifeste sans jeter la trace', () => {
    // Fichier concaténé : la partie cohérente reste exploitable.
    const { points, report } = cleanTrack([point(45.9), point(60.0), point(45.901)]);

    expect(report.outliersRemoved).toBe(1);
    expect(points).toHaveLength(2);
  });

  it('écarte une altitude non terrestre sans écarter le point', () => {
    // La position reste bonne ; seule l'altitude est fausse.
    const { points, report } = cleanTrack([point(45.9, 99999), point(45.901)]);

    expect(report.implausibleElevationsDropped).toBe(1);
    expect(points).toHaveLength(2);
    expect(points[0]?.elevationMeters).toBeNull();
  });

  it('conserve une section lente : ce n’est pas une aberration', () => {
    // Un ultra comporte des sections à 1 km/h. Un filtre zélé y effacerait du
    // parcours réel, ce que §9.1 interdit.
    const slow = [point(45.9), point(45.90005), point(45.9001)];
    const { points } = cleanTrack(slow);

    expect(points).toHaveLength(3);
  });
});

describe('lecture GPX', () => {
  it('lit les points de route comme les points de trace', () => {
    // Certains organisateurs publient le parcours en <rtept>.
    const gpx = '<gpx><rte><rtept lat="45.9" lon="6.8"><ele>1000</ele></rtept></rte></gpx>';

    expect(parseGpx(gpx).points).toHaveLength(1);
  });

  it('accepte un point auto-fermant, sans altitude', () => {
    const gpx = '<gpx><trk><trkseg><trkpt lat="45.9" lon="6.8"/></trkseg></trk></gpx>';
    const { points } = parseGpx(gpx);

    expect(points[0]?.elevationMeters).toBeNull();
  });

  it('ignore les extensions propriétaires', () => {
    // Fréquence cardiaque, cadence, température : hors géométrie.
    const gpx =
      '<gpx><trk><trkseg><trkpt lat="45.9" lon="6.8"><ele>1000</ele>' +
      '<extensions><gpxtpx:hr>150</gpxtpx:hr></extensions></trkpt></trkseg></trk></gpx>';

    expect(parseGpx(gpx).points[0]?.elevationMeters).toBe(1000);
  });

  it('ne résout aucune entité externe', () => {
    // XXE : la capacité n'existe pas dans ce scanner, l'entité reste un texte
    // inerte et ne devient jamais le contenu d'un fichier local.
    const gpx =
      '<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' +
      '<gpx><trk><name>&xxe;</name><trkseg>' +
      '<trkpt lat="45.9" lon="6.8"/><trkpt lat="45.901" lon="6.8"/></trkseg></trk></gpx>';

    const parsed = parseGpx(gpx);

    expect(parsed.trackName).toBe('&xxe;');
    expect(parsed.points).toHaveLength(2);
  });

  it('décode les entités prédéfinies', () => {
    const gpx =
      '<gpx><trk><name>Col d&apos;Aubisque &amp; retour</name><trkseg>' +
      '<trkpt lat="45.9" lon="6.8"/></trkseg></trk></gpx>';

    expect(parseGpx(gpx).trackName).toBe("Col d'Aubisque & retour");
  });

  it('refuse un nombre malformé plutôt que de le deviner', () => {
    // `Number('')` vaut 0 : une coordonnée vide deviendrait le point (0, 0).
    const gpx = '<gpx><trk><trkseg><trkpt lat="" lon="6.8"/></trkseg></trk></gpx>';

    expect(() => parseGpx(gpx)).toThrow(/malformed_number/);
  });
});
