import { cleanTrack, type CleaningReport } from './clean.js';
import { computeElevationProfile } from './elevation.js';
import { cumulativeDistances } from './geodesy.js';
import { GpxError } from './errors.js';
import { parseGpx } from './parse.js';
import { PREPROCESSING, PROCESSOR_VERSION, QUALITY } from './version.js';

/**
 * Pipeline de traitement GPX — docs/engines/PLAN_ENGINE.md §8.1, étapes 1 à 4,
 * et 01_ARCHITECTURE §15 étapes 1 à 5.
 *
 * Ce lot s'arrête à la trace normalisée : le ré-échantillonnage, les
 * micro-segments et le raccordement des waypoints appartiennent au moteur
 * Plan, qui consomme cette sortie sans reparser le fichier — « le GPX brut
 * n'est pas reparsé à chaque recalcul du Plan » (§15).
 *
 * Fonction pure : une chaîne en entrée, une structure en sortie. Aucune I/O,
 * aucune horloge, aucun aléa. Le même fichier produit toujours exactement le
 * même résultat, ce qui rend la géométrie persistée reproductible et
 * comparable d'une version de processeur à l'autre.
 */

export interface TrackPoint {
  readonly latitude: number;
  readonly longitude: number;
  /** Altitude lissée. `null` là où le fichier n'en portait pas. */
  readonly elevationMeters: number | null;
  /** Distance depuis le départ, en mètres. */
  readonly distanceMeters: number;
}

/**
 * Contrôles qualité — §9. Ils constatent, ils ne corrigent pas.
 *
 * `eligibleForReliefModel` traduit la ligne « Altitude manquante > 5 % des
 * points → parcours non éligible au modèle relief V1 ».
 */
export interface QualityReport {
  readonly pointCount: number;
  readonly missingElevationCount: number;
  readonly missingElevationRatio: number;
  readonly eligibleForReliefModel: boolean;
  /** Nombre de transitions dont la pente brute dépasse le seuil extrême. */
  readonly extremeGradeCount: number;
  readonly cleaning: CleaningReport;
}

export interface ProcessedTrack {
  readonly processorVersion: string;
  readonly trackName: string | null;
  readonly points: readonly TrackPoint[];
  readonly pointCount: number;
  readonly lengthMeters: number;
  readonly elevationGainMeters: number;
  readonly elevationLossMeters: number;
  readonly minElevationMeters: number | null;
  readonly maxElevationMeters: number | null;
  readonly quality: QualityReport;
}

/** Une géométrie PostGIS a besoin d'au moins deux points distincts. */
const MINIMUM_POINTS = 2;

export interface ProcessOptions {
  readonly elevationSmoothingWindowMeters?: number;
}

export function processGpx(source: string, options: ProcessOptions = {}): ProcessedTrack {
  const windowMeters =
    options.elevationSmoothingWindowMeters ?? PREPROCESSING.elevationSmoothingWindowMeters;

  const parsed = parseGpx(source);
  const { points: cleaned, report: cleaning } = cleanTrack(parsed.points);

  if (cleaned.length < MINIMUM_POINTS) {
    throw new GpxError(
      'too_few_points',
      'moins de deux points exploitables après nettoyage',
      `${cleaned.length} point(s)`,
    );
  }

  const distances = cumulativeDistances(cleaned);
  const elevations = cleaned.map((point) => point.elevationMeters);
  const profile = computeElevationProfile(elevations, distances, windowMeters);

  const points: TrackPoint[] = cleaned.map((point, index) => ({
    latitude: point.latitude,
    longitude: point.longitude,
    elevationMeters: profile.smoothed[index] ?? null,
    distanceMeters: distances[index] as number,
  }));

  const missingElevationCount = elevations.filter((value) => value === null).length;

  return {
    processorVersion: PROCESSOR_VERSION,
    trackName: parsed.trackName,
    points,
    pointCount: points.length,
    lengthMeters: distances[distances.length - 1] as number,
    elevationGainMeters: profile.gainMeters,
    elevationLossMeters: profile.lossMeters,
    minElevationMeters: profile.minMeters,
    maxElevationMeters: profile.maxMeters,
    quality: {
      pointCount: points.length,
      missingElevationCount,
      missingElevationRatio: missingElevationCount / points.length,
      eligibleForReliefModel:
        missingElevationCount / points.length <= QUALITY.maxMissingElevationRatio,
      extremeGradeCount: countExtremeGrades(points),
      cleaning,
    },
  };
}

/**
 * Pentes brutes extrêmes — §9.
 *
 * « Conserver le signal mais caper le modèle à ±40 % » : le cap appartient au
 * moteur Plan. Ici on se contente de compter, pour que la qualité du fichier
 * soit visible sans que la trace soit altérée.
 */
function countExtremeGrades(points: readonly TrackPoint[]): number {
  let count = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1] as TrackPoint;
    const current = points[index] as TrackPoint;

    if (previous.elevationMeters === null || current.elevationMeters === null) continue;

    const run = current.distanceMeters - previous.distanceMeters;
    if (run <= 0) continue;

    const grade = Math.abs(current.elevationMeters - previous.elevationMeters) / run;
    if (grade > QUALITY.extremeGradeRatio) count += 1;
  }

  return count;
}

/**
 * Représentation WKT de la trace, en `LINESTRING Z`.
 *
 * Produite ici parce qu'elle dépend de la géométrie, pas de la base : le
 * paquet reste sans dépendance PostGIS, et l'appelant se contente de passer
 * cette chaîne à `ST_GeomFromEWKT`.
 *
 * Les points sans altitude prennent 0 : `LineStringZ` est une colonne 3D, une
 * coordonnée Z manquante y est impossible. Le taux d'altitudes absentes reste
 * porté par le rapport qualité, qui dit si le relief est exploitable.
 */
export function toEwktLineStringZ(points: readonly TrackPoint[], srid = 4326): string {
  const coordinates = points
    .map((point) => `${point.longitude} ${point.latitude} ${point.elevationMeters ?? 0}`)
    .join(',');

  return `SRID=${srid};LINESTRING Z (${coordinates})`;
}
