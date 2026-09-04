import { z } from 'zod';

/**
 * Une variable déclarée mais vide (`WEATHER_API_KEY=` dans un fichier `.env`)
 * vaut absente. Sans cela un provider serait considéré comme configuré avec une
 * clé vide, et échouerait plus tard sans message exploitable.
 */
function blankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

/** Variable obligatoire : chaîne non vide. */
export function requiredText(key: string) {
  return z.preprocess(blankToUndefined, z.string({ error: `${key} : variable requise` }));
}

/** Variable facultative : `undefined` si absente ou vide. */
export function optionalText() {
  return z.preprocess(blankToUndefined, z.string().optional());
}

function hasProtocol(value: string, protocols: readonly string[]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * URL de service.
 *
 * Restreinte à `http`/`https` : une URL de configuration finit dans un `fetch`
 * serveur, et les autres schémas (`file:`, `gopher:`…) sont un vecteur SSRF
 * (01_ARCHITECTURE §32.1).
 */
export function httpUrl(key: string) {
  return z.preprocess(
    blankToUndefined,
    z
      .string({ error: `${key} : variable requise` })
      .refine((value) => hasProtocol(value, ['http:', 'https:']), {
        error: `${key} : URL http(s) attendue`,
      }),
  );
}

/** Chaîne de connexion PostgreSQL. */
export function postgresUrl(key: string) {
  return z.preprocess(
    blankToUndefined,
    z
      .string({ error: `${key} : variable requise` })
      .refine((value) => hasProtocol(value, ['postgres:', 'postgresql:']), {
        error: `${key} : URL postgres(ql):// attendue`,
      }),
  );
}

const TRUE_VALUES = new Set(['true', '1']);
const FALSE_VALUES = new Set(['false', '0']);

/**
 * Booléen d'environnement.
 *
 * Aucune tolérance implicite : une valeur non reconnue est une erreur, jamais un
 * `false` silencieux. Un flag mal orthographié doit se voir au démarrage, pas se
 * traduire par une fonctionnalité muette (AGENTS §38).
 */
export function booleanEnv(key: string, fallback: boolean) {
  return z.preprocess(blankToUndefined, z.string().optional()).transform((raw, ctx) => {
    if (raw === undefined) return fallback;

    const normalized = raw.trim().toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;

    ctx.addIssue({
      code: 'custom',
      message: `${key} : valeur booléenne attendue (true, false, 1 ou 0)`,
    });
    return z.NEVER;
  });
}
