/**
 * `@pluka/gpx` — traitement GPX pur.
 *
 * Aucune dépendance : ni Next.js, ni Supabase, ni réseau, ni bibliothèque
 * tierce. Le paquet reçoit le contenu d'un fichier et rend une trace
 * normalisée (01_ARCHITECTURE §5 : un moteur pur ne dépend de rien de tout
 * cela).
 *
 * Déterministe : mêmes octets en entrée, même sortie, toujours. C'est ce qui
 * permet de persister `processor_version` avec la géométrie et de savoir
 * exactement comment elle a été produite (02_DATA_MODEL §6.8).
 */

export { cleanTrack, type CleanedTrack, type CleaningReport } from './clean.js';
export { computeElevationProfile, smoothElevations, type ElevationProfile } from './elevation.js';
export { GPX_ERROR_REASONS, GpxError, isGpxError, type GpxErrorReason } from './errors.js';
export { cumulativeDistances, haversineMeters, type Coordinate } from './geodesy.js';
export { parseGpx, type ParsedGpx, type RawTrackPoint } from './parse.js';
export {
  processGpx,
  toEwktLineStringZ,
  type ProcessedTrack,
  type ProcessOptions,
  type QualityReport,
  type TrackPoint,
} from './process.js';
export { CLEANING, PREPROCESSING, PROCESSOR_VERSION, QUALITY } from './version.js';
