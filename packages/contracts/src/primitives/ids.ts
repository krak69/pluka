import { z } from 'zod';

/**
 * Identifiant métier.
 *
 * Tous les identifiants métier sont des UUID (01_ARCHITECTURE §8). Un
 * identifiant fourni par un provider externe n'est pas un UUID : il reste une
 * chaîne opaque de son côté du contrat.
 */
export const uuidSchema = z.uuid();

/** Chaîne non vide, une fois les espaces de bord retirés. */
export const nonEmptyStringSchema = z.string().trim().min(1);

/**
 * Empreinte SHA-256 en hexadécimal minuscule.
 *
 * Correspond aux colonnes `char(64)` du schéma (`content_hash`, `input_hash`,
 * `payload_hash`). Minuscule imposée : une même empreinte ne doit pas exister
 * sous deux écritures, sinon la comparaison d'idempotence devient fausse.
 */
export const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, {
  error: 'empreinte SHA-256 hexadécimale minuscule attendue (64 caractères)',
});
