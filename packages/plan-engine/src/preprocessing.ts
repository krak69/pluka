import type { PlanEngineConfig, TechnicalityLevel } from './config.js';
import type { PlanIssue, PlanMicroSegment, PlanRaceSegmentInput } from './contracts.js';
import { clampGrade } from './grade-factor.js';
import { PlanEngineError, planIssue } from './issues.js';

/**
 * Prétraitement du parcours — docs/engines/PLAN_ENGINE.md §8.1, étapes 5 à 9.
 *
 * Les étapes 1 à 4 — valider, nettoyer, cumuler les distances, lisser
 * l'altitude sur 50 m — appartiennent à `@pluka/gpx`, qui les exécute à
 * l'import. Reprennent ici :
 *
 * 5. ré-échantillonner environ tous les 25 m ;
 * 6. construire des micro-segments d'environ 100 m ;
 * 7. forcer une coupure aux waypoints de référence ;
 * 8. calculer distance, delta d'altitude, pente moyenne, D+, D-, progression ;
 * 9. raccorder les RaceWaypoints au GPX.
 *
 * QUAND
 *
 * Une fois, à l'import ou à la validation du parcours — jamais à chaque
 * recalcul. §8 est explicite : « le prétraitement GPX est effectué lors de
 * l'import / validation du parcours, pas à chaque recalcul du Plan », et §62
 * le répète : « l'important est qu'il ne soit pas recomputé à chaque édition du
 * Plan ». Le moteur consomme le résultat.
 *
 * CE QU'IL NE FAIT PAS
 *
 * §9.1 : « si le GPX et une valeur officielle divergent, le moteur ne falsifie
 * pas le GPX, il ne modifie pas artificiellement le D+, il ne répartit pas
 * l'écart sur les altitudes ; il produit un état de qualité à résoudre. » Les
 * écarts sortent donc en warnings, et les altitudes restent celles du fichier.
 */

/** Un point de la trace normalisée produite par `@pluka/gpx`. */
export interface CourseTrackPoint {
  readonly distanceMeters: number;
  readonly elevationMeters: number | null;
}

export interface CourseWaypointInput {
  readonly id: string;
  readonly sortOrder: number;
  /** Position du waypoint le long du parcours, en mètres. */
  readonly alongDistanceMeters: number;
  /** Écart entre le waypoint déclaré et la trace, en mètres (§9). */
  readonly offRouteMeters?: number;
  readonly technicality?: TechnicalityLevel | null;
}

/** Point de trace géolocalisé, pour le raccordement de §8.1, étape 9. */
export interface GeoTrackPoint {
  readonly latitude: number;
  readonly longitude: number;
  readonly distanceMeters: number;
}

/** Waypoint tel que le référentiel Course le déclare. */
export interface DeclaredWaypoint {
  readonly id: string;
  readonly sortOrder: number;
  readonly latitude: number | null;
  readonly longitude: number | null;
  /** Distance officielle annoncée, en mètres. Repli quand la position manque. */
  readonly declaredDistanceMeters: number | null;
  readonly technicality?: TechnicalityLevel | null;
}

const EARTH_RADIUS_METERS = 6_371_008.8;

/** Distance haversine entre deux positions, en mètres. */
function haversineMeters(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
): number {
  const toRadians = Math.PI / 180;
  const deltaLatitude = (toLatitude - fromLatitude) * toRadians;
  const deltaLongitude = (toLongitude - fromLongitude) * toRadians;

  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(fromLatitude * toRadians) *
      Math.cos(toLatitude * toRadians) *
      Math.sin(deltaLongitude / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Raccordement des RaceWaypoints au GPX — §8.1, étape 9.
 *
 * Chaque waypoint est projeté sur le point de trace le plus proche : l'abscisse
 * curviligne de ce point devient sa position le long du parcours, et la
 * distance qui les sépare son écart de raccordement — la valeur que §9 borne à
 * 200 m.
 *
 * L'abscisse mesurée l'emporte sur la distance officielle annoncée. §9.1 ne
 * demande pas de falsifier le GPX pour le faire coller au référentiel ; ici
 * c'est l'inverse qui compte — la chronologie se calcule sur la trace réelle,
 * et l'écart entre les deux est un fait de qualité, pas une correction à
 * appliquer.
 *
 * Sans position, le waypoint garde sa distance déclarée et un écart nul : on ne
 * mesure pas ce qu'on n'a pas.
 */
export function snapWaypointsToTrack(
  points: readonly GeoTrackPoint[],
  waypoints: readonly DeclaredWaypoint[],
): readonly CourseWaypointInput[] {
  if (points.length === 0) {
    throw new PlanEngineError(planIssue('GPX_INVALID', 'trace vide : rien à raccorder'));
  }

  return [...waypoints]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((waypoint) => {
      if (waypoint.latitude === null || waypoint.longitude === null) {
        if (waypoint.declaredDistanceMeters === null) {
          throw new PlanEngineError(
            planIssue(
              'WAYPOINT_OFF_ROUTE',
              'ce waypoint n’a ni position ni distance : il ne peut pas être placé',
              { waypointId: waypoint.id },
            ),
          );
        }

        return {
          id: waypoint.id,
          sortOrder: waypoint.sortOrder,
          alongDistanceMeters: waypoint.declaredDistanceMeters,
          offRouteMeters: 0,
          technicality: waypoint.technicality ?? null,
        };
      }

      let nearest = points[0] as GeoTrackPoint;
      let nearestMeters = Number.POSITIVE_INFINITY;

      for (const point of points) {
        const distance = haversineMeters(
          waypoint.latitude,
          waypoint.longitude,
          point.latitude,
          point.longitude,
        );

        if (distance < nearestMeters) {
          nearestMeters = distance;
          nearest = point;
        }
      }

      return {
        id: waypoint.id,
        sortOrder: waypoint.sortOrder,
        alongDistanceMeters: nearest.distanceMeters,
        offRouteMeters: nearestMeters,
        technicality: waypoint.technicality ?? null,
      };
    });
}

export interface PreprocessCourseInput {
  readonly points: readonly CourseTrackPoint[];
  readonly waypoints: readonly CourseWaypointInput[];
  readonly raceSegments: readonly PlanRaceSegmentInput[];
  readonly official?: {
    readonly distanceMeters?: number;
    readonly elevationGainMeters?: number;
  };
  readonly config: PlanEngineConfig;
}

export interface PreprocessedCourse {
  readonly preprocessingVersion: string;
  readonly microSegments: readonly PlanMicroSegment[];
  readonly totalDistanceMeters: number;
  readonly elevationGainMeters: number;
  readonly elevationLossMeters: number;
  readonly resampledPointCount: number;
  readonly warnings: readonly PlanIssue[];
}

interface Sample {
  readonly distanceMeters: number;
  readonly elevationMeters: number;
}

/**
 * §8.1, étape 5 — ré-échantillonnage à pas constant.
 *
 * Le pas régulier est ce qui rend les micro-segments comparables : sans lui, un
 * secteur densément enregistré pèserait davantage qu'un secteur échantillonné
 * toutes les 30 secondes, alors que le coût dépend du terrain, pas du GPS.
 *
 * L'altitude est interpolée linéairement entre les deux points encadrants. Les
 * points sans altitude sont ignorés dans l'interpolation : §9 refuse au modèle
 * relief un parcours dont plus de 5 % des points en manquent, et en deçà,
 * inventer une altitude serait ce que §9.1 interdit.
 */
export function resampleTrack(
  points: readonly CourseTrackPoint[],
  stepMeters: number,
): readonly Sample[] {
  const usable = points.filter(
    (point): point is CourseTrackPoint & { elevationMeters: number } =>
      point.elevationMeters !== null,
  );

  if (usable.length < 2) {
    throw new PlanEngineError(
      planIssue('GPX_INVALID', 'moins de deux points altimétriques exploitables'),
    );
  }

  const total = (usable[usable.length - 1] as Sample).distanceMeters;
  const samples: Sample[] = [];

  let cursor = 0;
  for (let distance = 0; distance < total; distance += stepMeters) {
    while (cursor < usable.length - 2 && (usable[cursor + 1] as Sample).distanceMeters < distance) {
      cursor += 1;
    }

    const lower = usable[cursor] as Sample;
    const upper = usable[cursor + 1] as Sample;
    const span = upper.distanceMeters - lower.distanceMeters;
    const ratio = span === 0 ? 0 : (distance - lower.distanceMeters) / span;

    samples.push({
      distanceMeters: distance,
      elevationMeters:
        lower.elevationMeters + (upper.elevationMeters - lower.elevationMeters) * ratio,
    });
  }

  samples.push(usable[usable.length - 1] as Sample);

  return samples;
}

/** Altitude à une abscisse donnée, interpolée sur les échantillons. */
function elevationAt(samples: readonly Sample[], distanceMeters: number): number {
  const first = samples[0] as Sample;
  const last = samples[samples.length - 1] as Sample;

  if (distanceMeters <= first.distanceMeters) return first.elevationMeters;
  if (distanceMeters >= last.distanceMeters) return last.elevationMeters;

  for (let index = 1; index < samples.length; index += 1) {
    const upper = samples[index] as Sample;
    if (upper.distanceMeters < distanceMeters) continue;

    const lower = samples[index - 1] as Sample;
    const span = upper.distanceMeters - lower.distanceMeters;
    if (span === 0) return lower.elevationMeters;

    const ratio = (distanceMeters - lower.distanceMeters) / span;

    return lower.elevationMeters + (upper.elevationMeters - lower.elevationMeters) * ratio;
  }

  return last.elevationMeters;
}

/** D+ et D- accumulés entre deux abscisses, échantillon par échantillon. */
function reliefBetween(
  samples: readonly Sample[],
  fromMeters: number,
  toMeters: number,
): { gain: number; loss: number } {
  const inner = samples.filter(
    (sample) => sample.distanceMeters > fromMeters && sample.distanceMeters < toMeters,
  );

  const chain = [
    { distanceMeters: fromMeters, elevationMeters: elevationAt(samples, fromMeters) },
    ...inner,
    { distanceMeters: toMeters, elevationMeters: elevationAt(samples, toMeters) },
  ];

  let gain = 0;
  let loss = 0;

  for (let index = 1; index < chain.length; index += 1) {
    const delta =
      (chain[index] as Sample).elevationMeters - (chain[index - 1] as Sample).elevationMeters;

    if (delta > 0) gain += delta;
    else loss -= delta;
  }

  return { gain, loss };
}

/**
 * §8.1, étapes 6 à 9.
 *
 * Les coupures aux waypoints sont posées avant le découpage régulier (étape 7) :
 * un micro-segment ne chevauche jamais deux RaceSegments, sans quoi son coût
 * serait attribué à l'un ou à l'autre arbitrairement.
 *
 * Entre deux coupures, la portion est divisée en parts égales dont la longueur
 * approche 100 m — « environ », dit §8.1. Un intervalle de 250 m donne trois
 * parts de 83,3 m plutôt que deux de 100 m et un reliquat de 50 m : des parts
 * régulières rendent les pentes moyennes comparables.
 */
export function preprocessCourse(input: PreprocessCourseInput): PreprocessedCourse {
  const { config } = input;
  const samples = resampleTrack(input.points, config.preprocessing.resampleStepMeters);
  const totalDistanceMeters = (samples[samples.length - 1] as Sample).distanceMeters;

  const warnings: PlanIssue[] = [];
  const waypoints = [...input.waypoints].sort((left, right) => left.sortOrder - right.sortOrder);

  // §9, étape 9 : « Waypoint ↔ GPX > 200 m → erreur, validation requise avant
  // Plan ». Un waypoint qu'on ne sait pas placer rendrait toute la chronologie
  // fausse à partir de lui.
  for (const waypoint of waypoints) {
    const offRoute = waypoint.offRouteMeters ?? 0;
    if (offRoute > config.preprocessing.maxWaypointOffRouteMeters) {
      throw new PlanEngineError(
        planIssue(
          'WAYPOINT_OFF_ROUTE',
          `le waypoint est à ${Math.round(offRoute)} m de la trace (maximum ${config.preprocessing.maxWaypointOffRouteMeters} m)`,
          { waypointId: waypoint.id },
        ),
      );
    }
  }

  const segments = [...input.raceSegments].sort((left, right) => left.sortOrder - right.sortOrder);
  const alongById = new Map(
    waypoints.map((waypoint) => [waypoint.id, waypoint.alongDistanceMeters]),
  );
  const technicalityById = new Map(
    waypoints.map((waypoint) => [waypoint.id, waypoint.technicality ?? null]),
  );

  const microSegments: PlanMicroSegment[] = [];
  let sortOrder = 0;

  for (const segment of segments) {
    const from = alongById.get(segment.fromWaypointId);
    const to = alongById.get(segment.toWaypointId);

    if (from === undefined || to === undefined || to <= from) {
      throw new PlanEngineError(
        planIssue('GPX_INVALID', `le segment ${segment.id} ne couvre aucune distance`, {
          segmentId: segment.id,
        }),
      );
    }

    // La technicité est une donnée de RaceSegment (§12.2), portée ici par le
    // waypoint d'arrivée du segment. Absente, elle reste `null` : le moteur ne
    // l'invente pas (§12.1).
    const technicality = technicalityById.get(segment.toWaypointId) ?? null;

    const span = to - from;
    const parts = Math.max(1, Math.round(span / config.preprocessing.microSegmentLengthMeters));
    const partLength = span / parts;

    for (let part = 0; part < parts; part += 1) {
      const start = from + partLength * part;
      const end = part === parts - 1 ? to : from + partLength * (part + 1);

      const startElevation = elevationAt(samples, start);
      const endElevation = elevationAt(samples, end);
      const distanceMeters = end - start;
      const elevationDeltaMeters = endElevation - startElevation;
      const relief = reliefBetween(samples, start, end);
      const rawGrade = distanceMeters === 0 ? 0 : elevationDeltaMeters / distanceMeters;

      microSegments.push({
        id: `${segment.id}#${part}`,
        raceSegmentId: segment.id,
        sortOrder,
        distanceMeters,
        elevationDeltaMeters,
        elevationGainMeters: relief.gain,
        elevationLossMeters: relief.loss,
        rawGrade,
        modelGrade: clampGrade(rawGrade, config.gradeClampRatio),
        // §13 : la progression est évaluée le long du parcours. Le milieu du
        // micro-segment le représente mieux que son début ou sa fin.
        progress:
          totalDistanceMeters === 0 ? 0 : (start + distanceMeters / 2) / totalDistanceMeters,
        technicality,
      });

      sortOrder += 1;
    }
  }

  const elevationGainMeters = microSegments.reduce(
    (sum, micro) => sum + micro.elevationGainMeters,
    0,
  );
  const elevationLossMeters = microSegments.reduce(
    (sum, micro) => sum + micro.elevationLossMeters,
    0,
  );

  warnings.push(...qualityWarnings(input, config, { totalDistanceMeters, elevationGainMeters }));

  return {
    preprocessingVersion: config.preprocessingVersion,
    microSegments,
    totalDistanceMeters,
    elevationGainMeters,
    elevationLossMeters,
    resampledPointCount: samples.length,
    warnings,
  };
}

/**
 * Contrôles qualité §9 — ils constatent, ils ne corrigent pas.
 *
 * « Distance GPX vs officielle > 10 % → warning qualité. D+ GPX vs officiel
 * > 15 % → warning qualité. » Et §9.1 : la provenance et la qualité du
 * référentiel Course « sont traitées en amont du calcul personnel ». Le moteur
 * signale l'écart et calcule quand même sur ce qu'il a.
 */
function qualityWarnings(
  input: PreprocessCourseInput,
  config: PlanEngineConfig,
  measured: { totalDistanceMeters: number; elevationGainMeters: number },
): readonly PlanIssue[] {
  const warnings: PlanIssue[] = [];
  const official = input.official;
  if (official === undefined) return warnings;

  if (official.distanceMeters !== undefined && official.distanceMeters > 0) {
    const gap =
      Math.abs(measured.totalDistanceMeters - official.distanceMeters) / official.distanceMeters;

    if (gap > config.preprocessing.distanceMismatchRatio) {
      warnings.push(
        planIssue(
          'GPX_DISTANCE_MISMATCH',
          `écart de ${(gap * 100).toFixed(1)} % entre la distance GPX et la distance officielle`,
        ),
      );
    }
  }

  if (official.elevationGainMeters !== undefined && official.elevationGainMeters > 0) {
    const gap =
      Math.abs(measured.elevationGainMeters - official.elevationGainMeters) /
      official.elevationGainMeters;

    if (gap > config.preprocessing.elevationGainMismatchRatio) {
      warnings.push(
        planIssue(
          'GPX_GAIN_MISMATCH',
          `écart de ${(gap * 100).toFixed(1)} % entre le D+ GPX et le D+ officiel`,
        ),
      );
    }
  }

  return warnings;
}
