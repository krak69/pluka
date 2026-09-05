import { PREPROCESSING } from './version.js';

/**
 * Altitude : lissage puis dénivelés.
 *
 * docs/engines/PLAN_ENGINE.md §8.1 étape 4 : « lisser l'altitude sur une
 * fenêtre horizontale cible de 50 m ». La fenêtre est **horizontale**, pas un
 * nombre de points : un GPX enregistré à la seconde produit des points serrés
 * en montée et espacés en descente, et lisser sur N points appliquerait donc
 * une force de lissage variable selon la pente — exactement là où le relief
 * compte.
 *
 * Le D+ est ensuite calculé sur le profil lissé. C'est l'ordre du pipeline,
 * et il est déterminant : sur une trace brute, le bruit GPS vertical ajoute
 * couramment 20 à 40 % de dénivelé fantôme. Lisser n'est pas « modifier
 * artificiellement le D+ » au sens de §9.1 — c'est mesurer le relief plutôt
 * que le bruit du capteur. Ce qu'interdit §9.1, c'est de tordre le résultat
 * pour le faire coïncider avec une valeur officielle.
 */

export interface ElevationProfile {
  /** Altitudes lissées, alignées sur les points d'entrée. `null` là où l'altitude manque. */
  readonly smoothed: readonly (number | null)[];
  readonly gainMeters: number;
  readonly lossMeters: number;
  readonly minMeters: number | null;
  readonly maxMeters: number | null;
}

/**
 * Moyenne mobile à fenêtre horizontale centrée.
 *
 * Les points sans altitude ne participent pas à la moyenne et restent sans
 * altitude : on ne comble pas un trou par interpolation, parce qu'une altitude
 * inventée serait indiscernable d'une altitude mesurée en aval.
 */
export function smoothElevations(
  elevations: readonly (number | null)[],
  distances: readonly number[],
  windowMeters: number = PREPROCESSING.elevationSmoothingWindowMeters,
): readonly (number | null)[] {
  const halfWindow = windowMeters / 2;
  const smoothed: (number | null)[] = [];

  for (let index = 0; index < elevations.length; index += 1) {
    if (elevations[index] === null || elevations[index] === undefined) {
      smoothed.push(null);
      continue;
    }

    const center = distances[index] as number;
    let sum = 0;
    let count = 0;

    // Vers l'arrière puis vers l'avant, en s'arrêtant dès la sortie de
    // fenêtre : les distances sont croissantes, inutile de balayer tout.
    for (let cursor = index; cursor >= 0; cursor -= 1) {
      if (center - (distances[cursor] as number) > halfWindow) break;
      const value = elevations[cursor];
      if (value !== null && value !== undefined) {
        sum += value;
        count += 1;
      }
    }

    for (let cursor = index + 1; cursor < elevations.length; cursor += 1) {
      if ((distances[cursor] as number) - center > halfWindow) break;
      const value = elevations[cursor];
      if (value !== null && value !== undefined) {
        sum += value;
        count += 1;
      }
    }

    smoothed.push(count === 0 ? null : sum / count);
  }

  return smoothed;
}

/**
 * Dénivelés positif et négatif, en mètres.
 *
 * Somme des variations du profil lissé. Aucun seuil supplémentaire n'est
 * appliqué : le lissage a déjà retiré le bruit, et un « seuil de dénivelé »
 * additionnel serait une constante non spécifiée qui écrêterait le relief
 * réel des parcours vallonnés.
 *
 * Une rupture d'altitude — le profil reprend après des points sans altitude —
 * n'est pas comptée : le dénivelé de l'intervalle manquant est inconnu, et
 * l'attribuer entièrement à la première mesure retrouvée inventerait une
 * marche.
 */
export function computeElevationProfile(
  elevations: readonly (number | null)[],
  distances: readonly number[],
  windowMeters: number = PREPROCESSING.elevationSmoothingWindowMeters,
): ElevationProfile {
  const smoothed = smoothElevations(elevations, distances, windowMeters);

  let gainMeters = 0;
  let lossMeters = 0;
  let minMeters: number | null = null;
  let maxMeters: number | null = null;
  let previous: number | null = null;

  for (const value of smoothed) {
    if (value === null) {
      // Le profil reprendra plus loin, sans relier les deux bords.
      previous = null;
      continue;
    }

    minMeters = minMeters === null ? value : Math.min(minMeters, value);
    maxMeters = maxMeters === null ? value : Math.max(maxMeters, value);

    if (previous !== null) {
      const delta = value - previous;
      if (delta > 0) gainMeters += delta;
      else lossMeters -= delta;
    }

    previous = value;
  }

  return { smoothed, gainMeters, lossMeters, minMeters, maxMeters };
}
