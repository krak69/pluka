import { GpxError } from './errors.js';

/**
 * Lecture d'un fichier GPX.
 *
 * Scanner dédié plutôt qu'un parseur XML générique, pour trois raisons :
 *
 * 1. le paquet reste sans aucune dépendance, ce que le lot exige ;
 * 2. GPX est un format plat et régulier — des `<trkpt lat lon>` contenant au
 *    plus `<ele>` et `<time>` — qui ne demande pas d'arbre ;
 * 3. **aucune entité externe n'est résolue**. Un parseur XML complet doit être
 *    explicitement bridé contre XXE ; ici la capacité n'existe pas, et un
 *    `<!ENTITY xxe SYSTEM "file:///etc/passwd">` reste un texte inerte
 *    (01_ARCHITECTURE §32.1).
 *
 * Le scanner est volontairement strict sur ce qu'il lit et silencieux sur ce
 * qu'il ignore : un GPX porte souvent des extensions propriétaires — fréquence
 * cardiaque, cadence, température — qui ne concernent pas la géométrie.
 */

/** Point tel qu'il figure dans le fichier, avant tout nettoyage. */
export interface RawTrackPoint {
  readonly latitude: number;
  readonly longitude: number;
  /** Absente si le fichier ne porte pas d'altitude pour ce point. */
  readonly elevationMeters: number | null;
  /** Instant ISO 8601 tel qu'écrit dans le fichier, non réinterprété. */
  readonly time: string | null;
}

export interface ParsedGpx {
  readonly trackName: string | null;
  readonly points: readonly RawTrackPoint[];
}

const TRACK_POINT_PATTERN = /<(trkpt|rtept)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1\s*>)/gi;
const ATTRIBUTE_PATTERN = /(\w+)\s*=\s*"([^"]*)"|(\w+)\s*=\s*'([^']*)'/g;
const NAME_PATTERN = /<name\b[^>]*>([\s\S]*?)<\/name\s*>/i;
const ELEVATION_PATTERN = /<ele\b[^>]*>([\s\S]*?)<\/ele\s*>/i;
const TIME_PATTERN = /<time\b[^>]*>([\s\S]*?)<\/time\s*>/i;

/** Entités XML prédéfinies. Aucune autre n'est résolue — c'est délibéré. */
const PREDEFINED_ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function decodeText(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|apos);/g,
    (entity) => PREDEFINED_ENTITIES[entity] ?? entity,
  );
}

function attributes(source: string): ReadonlyMap<string, string> {
  const found = new Map<string, string>();

  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    const name = match[1] ?? match[3];
    const value = match[2] ?? match[4];
    if (name !== undefined && value !== undefined) found.set(name.toLowerCase(), value);
  }

  return found;
}

/**
 * Lit un nombre décimal.
 *
 * `Number()` accepterait `''`, `'0x10'`, `'Infinity'` et les espaces : autant
 * de valeurs qui produiraient une géométrie absurde plutôt qu'un refus franc.
 */
function decimal(value: string | undefined): number | null {
  if (value === undefined) return null;

  const trimmed = value.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function innerText(source: string, pattern: RegExp): string | null {
  const match = pattern.exec(source);
  return match?.[1] === undefined ? null : decodeText(match[1]).trim();
}

/**
 * Analyse un fichier GPX.
 *
 * Les points de route (`rtept`) sont lus comme les points de trace : certains
 * organisateurs publient le parcours sous cette forme, et refuser le fichier
 * pour cette seule raison serait un faux négatif.
 */
export function parseGpx(source: string): ParsedGpx {
  if (!/<gpx\b/i.test(source)) {
    throw new GpxError('not_xml', 'aucun élément <gpx> trouvé');
  }

  const points: RawTrackPoint[] = [];

  for (const match of source.matchAll(TRACK_POINT_PATTERN)) {
    const attributeSource = match[2] ?? '';
    const body = match[4] ?? '';
    const attribute = attributes(attributeSource);

    const latitude = decimal(attribute.get('lat'));
    const longitude = decimal(attribute.get('lon'));

    // Un point sans coordonnée lisible n'est pas récupérable : le fichier
    // ment sur sa structure, on ne devine pas.
    if (latitude === null || longitude === null) {
      throw new GpxError(
        'malformed_number',
        'coordonnées illisibles sur un point de trace',
        `point ${points.length + 1}`,
      );
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new GpxError(
        'invalid_coordinate',
        'coordonnées hors des bornes terrestres',
        `point ${points.length + 1}`,
      );
    }

    const elevationText = innerText(body, ELEVATION_PATTERN);

    points.push({
      latitude,
      longitude,
      // Une altitude absente et une altitude illisible se valent : dans les
      // deux cas le point n'apporte pas de relief, et le taux de points sans
      // altitude est un contrôle qualité à part entière (§9).
      elevationMeters: elevationText === null ? null : decimal(elevationText),
      time: innerText(body, TIME_PATTERN),
    });
  }

  if (points.length === 0) {
    throw new GpxError('no_track_point', 'le fichier ne contient aucun point de trace');
  }

  return { trackName: innerText(source, NAME_PATTERN), points };
}
