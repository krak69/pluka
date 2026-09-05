/**
 * Géodésie.
 *
 * Fonctions pures et déterministes : mêmes entrées, mêmes sorties, aucune
 * horloge, aucune I/O. Elles sont la base de la distance cumulée, donc de tout
 * ce que le moteur Plan calculera ensuite.
 */

/**
 * Rayon volumétrique moyen de la Terre (IUGG), en mètres.
 *
 * Le haversine suppose une sphère. Sur une course, l'écart avec l'ellipsoïde
 * WGS84 reste sous 0,3 % — largement en deçà du bruit GPS lui-même, et
 * cohérent avec les seuils qualité de §9 exprimés en pourcents.
 */
const EARTH_RADIUS_METERS = 6371008.8;

const DEGREES_TO_RADIANS = Math.PI / 180;

export interface Coordinate {
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * Distance orthodromique entre deux points, en mètres.
 *
 * Formule de haversine : numériquement stable aux très petites distances, là
 * où la loi des cosinus sphériques perd sa précision — précisément le cas
 * entre deux points GPS consécutifs, souvent distants de quelques mètres.
 */
export function haversineMeters(from: Coordinate, to: Coordinate): number {
  const fromLatitude = from.latitude * DEGREES_TO_RADIANS;
  const toLatitude = to.latitude * DEGREES_TO_RADIANS;
  const deltaLatitude = (to.latitude - from.latitude) * DEGREES_TO_RADIANS;
  const deltaLongitude = (to.longitude - from.longitude) * DEGREES_TO_RADIANS;

  const halfChord =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(deltaLongitude / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(halfChord)));
}

/**
 * Distance cumulée le long d'une trace, en mètres.
 *
 * Rend un tableau de même longueur que l'entrée : le premier point est à 0, et
 * chaque valeur est la distance parcourue depuis le départ. C'est cette
 * abscisse curviligne qui sert d'axe à tout le reste — lissage d'altitude,
 * ré-échantillonnage, placement des waypoints.
 *
 * Distance **horizontale** : la composante verticale n'y est pas intégrée, et
 * c'est volontaire. La distance officielle d'une course est mesurée au sol, et
 * mélanger les deux gonflerait la distance de quelques pourcents — assez pour
 * déclencher à tort le contrôle qualité « distance GPX vs officielle » de §9.
 */
export function cumulativeDistances(points: readonly Coordinate[]): readonly number[] {
  const distances: number[] = new Array(points.length).fill(0);

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1] as Coordinate;
    const current = points[index] as Coordinate;

    distances[index] = (distances[index - 1] as number) + haversineMeters(previous, current);
  }

  return distances;
}
