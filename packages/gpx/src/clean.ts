import { haversineMeters } from './geodesy.js';
import type { RawTrackPoint } from './parse.js';
import { CLEANING } from './version.js';

/**
 * Nettoyage — docs/engines/PLAN_ENGINE.md §8.1 étape 2 : « supprimer les
 * doublons évidents et points aberrants manifestes ».
 *
 * Deux mots gouvernent cette étape : *évident* et *manifeste*. On retire ce
 * qui ne peut pas être un déplacement réel, pas ce qui semble improbable. Un
 * ultra comporte des arrêts de vingt minutes, des sections à 1 km/h et des
 * passages sous couvert où le signal se dégrade : un filtre zélé y effacerait
 * du parcours réel, et §9.1 interdit de corriger silencieusement.
 */

export interface CleaningReport {
  readonly duplicatesRemoved: number;
  readonly outliersRemoved: number;
  readonly implausibleElevationsDropped: number;
}

export interface CleanedTrack {
  readonly points: readonly RawTrackPoint[];
  readonly report: CleaningReport;
}

export function cleanTrack(points: readonly RawTrackPoint[]): CleanedTrack {
  const kept: RawTrackPoint[] = [];

  let duplicatesRemoved = 0;
  let outliersRemoved = 0;
  let implausibleElevationsDropped = 0;

  for (const point of points) {
    const elevation =
      point.elevationMeters !== null &&
      (point.elevationMeters < CLEANING.minElevationMeters ||
        point.elevationMeters > CLEANING.maxElevationMeters)
        ? null
        : point.elevationMeters;

    if (elevation === null && point.elevationMeters !== null) implausibleElevationsDropped += 1;

    const previous = kept[kept.length - 1];

    if (previous !== undefined) {
      const step = haversineMeters(previous, point);

      // Doublon de capture : le GPS a réémis la même position.
      if (step < CLEANING.duplicateDistanceMeters) {
        duplicatesRemoved += 1;
        continue;
      }

      // Saut manifeste : plusieurs kilomètres entre deux points consécutifs.
      // Le point suivant est écarté, pas la trace entière — un fichier
      // concaténé reste exploitable pour sa partie cohérente.
      if (step > CLEANING.maxJumpMeters) {
        outliersRemoved += 1;
        continue;
      }
    }

    kept.push(
      elevation === point.elevationMeters ? point : { ...point, elevationMeters: elevation },
    );
  }

  return {
    points: kept,
    report: { duplicatesRemoved, outliersRemoved, implausibleElevationsDropped },
  };
}
