import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  GpxError,
  PROCESSOR_VERSION,
  processGpx,
  toEwktLineStringZ,
  type ProcessedTrack,
} from '../src/index.js';

/**
 * Le fichier de référence est une trace synthétique aux valeurs calculables à
 * la main : 200 points espacés d'environ 10 m plein nord, altitude en
 * triangle — montée de 1000 à 1200 m, puis descente jusqu'à 950 m.
 *
 * Une trace réelle ferait un mauvais test de référence : ses valeurs ne sont
 * vérifiables qu'en refaisant le calcul avec le code testé, ce qui ne prouve
 * rien. Ici les attendus viennent de la géométrie, pas de l'implémentation.
 */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function reference(): string {
  return readFileSync(join(FIXTURES, 'reference.gpx'), 'utf8');
}

let cached: ProcessedTrack | undefined;

function processed(): ProcessedTrack {
  cached ??= processGpx(reference());
  return cached;
}

describe('trace de référence', () => {
  it('lit tous les points', () => {
    expect(processed().pointCount).toBe(200);
  });

  it('retient le nom de la trace', () => {
    // Le premier <name> rencontré est celui des métadonnées.
    expect(processed().trackName).toBe('Trace de reference PLUKA');
  });

  it('mesure la longueur attendue', () => {
    // 199 intervalles de ~10 m. La tolérance couvre l'écart entre le pas
    // calculé en degrés et la distance haversine réelle.
    expect(processed().lengthMeters).toBeGreaterThan(1980);
    expect(processed().lengthMeters).toBeLessThan(2000);
  });

  it('démarre la distance cumulée à zéro', () => {
    expect(processed().points[0]?.distanceMeters).toBe(0);
  });

  it('rend une distance cumulée strictement croissante', () => {
    const { points } = processed();

    for (let index = 1; index < points.length; index += 1) {
      expect(points[index]!.distanceMeters).toBeGreaterThan(points[index - 1]!.distanceMeters);
    }
  });

  it('calcule le D+ et le D- du profil', () => {
    // Montée 1000 → 1200 puis descente 1200 → 950. Le lissage sur 50 m arrondit
    // les deux extrémités du triangle, d'où une tolérance de quelques mètres :
    // c'est exactement l'effet attendu d'une moyenne mobile sur un sommet.
    const { elevationGainMeters, elevationLossMeters } = processed();

    expect(elevationGainMeters).toBeGreaterThan(190);
    expect(elevationGainMeters).toBeLessThanOrEqual(200);
    expect(elevationLossMeters).toBeGreaterThan(240);
    expect(elevationLossMeters).toBeLessThanOrEqual(250);
  });

  it('encadre les altitudes extrêmes', () => {
    const { minElevationMeters, maxElevationMeters } = processed();

    expect(minElevationMeters).toBeGreaterThanOrEqual(950);
    expect(maxElevationMeters).toBeLessThanOrEqual(1200);
  });

  it('juge le parcours éligible au modèle relief', () => {
    // Toutes les altitudes sont présentes : ratio manquant nul (§9).
    expect(processed().quality.missingElevationRatio).toBe(0);
    expect(processed().quality.eligibleForReliefModel).toBe(true);
  });

  it('ne signale aucune pente extrême', () => {
    // 2 m sur 10 m = 20 %, sous le seuil de 60 %.
    expect(processed().quality.extremeGradeCount).toBe(0);
  });

  it('estampille la version du processeur', () => {
    expect(processed().processorVersion).toBe(PROCESSOR_VERSION);
  });
});

describe('déterminisme', () => {
  it('rend exactement le même résultat à chaque exécution', () => {
    // La propriété qui rend la géométrie persistée reproductible : sans elle,
    // `processor_version` ne voudrait rien dire.
    const first = processGpx(reference());
    const second = processGpx(reference());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('ne dépend ni de l’horloge ni d’un aléa', () => {
    const before = processGpx(reference());
    const after = processGpx(reference());

    expect(after.lengthMeters).toBe(before.lengthMeters);
    expect(after.elevationGainMeters).toBe(before.elevationGainMeters);
  });
});

describe('sortie PostGIS', () => {
  it('produit un EWKT LINESTRING Z exploitable', () => {
    const ewkt = toEwktLineStringZ(processed().points);

    expect(ewkt.startsWith('SRID=4326;LINESTRING Z (')).toBe(true);
    expect(ewkt.endsWith(')')).toBe(true);
  });

  it('écrit les coordonnées dans l’ordre longitude latitude altitude', () => {
    // Inverser longitude et latitude est l'erreur classique de PostGIS : elle
    // produit une géométrie valide, au milieu de l'océan Indien.
    const ewkt = toEwktLineStringZ([
      { latitude: 45.9, longitude: 6.8, elevationMeters: 1000, distanceMeters: 0 },
      { latitude: 45.91, longitude: 6.81, elevationMeters: 1010, distanceMeters: 10 },
    ]);

    expect(ewkt).toBe('SRID=4326;LINESTRING Z (6.8 45.9 1000,6.81 45.91 1010)');
  });

  it('remplace une altitude absente par zéro', () => {
    // `LineStringZ` est une colonne 3D : une coordonnée Z manquante n'existe
    // pas. Le taux d'altitudes absentes reste porté par le rapport qualité.
    const ewkt = toEwktLineStringZ([
      { latitude: 45.9, longitude: 6.8, elevationMeters: null, distanceMeters: 0 },
      { latitude: 45.91, longitude: 6.81, elevationMeters: null, distanceMeters: 10 },
    ]);

    expect(ewkt).toContain('6.8 45.9 0');
  });
});

describe('fichiers refusés', () => {
  it('refuse ce qui n’est pas un GPX', () => {
    expect(() => processGpx('<html><body>oups</body></html>')).toThrow(GpxError);
  });

  it('refuse un GPX sans point de trace', () => {
    const empty = '<?xml version="1.0"?><gpx version="1.1"><trk><trkseg></trkseg></trk></gpx>';

    try {
      processGpx(empty);
      expect.unreachable('une GpxError était attendue');
    } catch (error) {
      expect((error as GpxError).reason).toBe('no_track_point');
    }
  });

  it('refuse une trace réduite à un point', () => {
    const single =
      '<gpx version="1.1"><trk><trkseg><trkpt lat="45.9" lon="6.8"><ele>1000</ele></trkpt></trkseg></trk></gpx>';

    try {
      processGpx(single);
      expect.unreachable('une GpxError était attendue');
    } catch (error) {
      expect((error as GpxError).reason).toBe('too_few_points');
    }
  });

  it('refuse une latitude hors bornes', () => {
    const bad = '<gpx><trk><trkseg><trkpt lat="91.0" lon="6.8"></trkpt></trkseg></trk></gpx>';

    try {
      processGpx(bad);
      expect.unreachable('une GpxError était attendue');
    } catch (error) {
      expect((error as GpxError).reason).toBe('invalid_coordinate');
    }
  });

  it('porte un code stable, exploitable par le worker', () => {
    // Le worker normalise ce code dans `ingestion_jobs.last_error` : un
    // fichier invalide ne doit pas être réessayé cinq fois.
    try {
      processGpx('pas du xml');
      expect.unreachable('une GpxError était attendue');
    } catch (error) {
      expect((error as GpxError).code).toBe('GPX_INVALID');
    }
  });
});
