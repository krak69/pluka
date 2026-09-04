import { z } from 'zod';

/**
 * Instant réel, ISO 8601 avec décalage explicite (`Z` ou `+02:00`).
 *
 * Une date-heure sans fuseau est refusée : elle ne désigne aucun instant.
 * Les instants sont stockés en `timestamptz` et l'ultra multi-jour interdit de
 * raisonner en « minutes depuis le départ » aux frontières
 * (01_ARCHITECTURE §29, AGENTS §34, ACCEPTANCE AC-TIME-01 / AC-TIME-03).
 */
export const instantSchema = z.iso.datetime({ offset: true });

function isKnownTimeZone(value: string): boolean {
  try {
    // Lève RangeError sur un fuseau inconnu.
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fuseau IANA de la course, conservé tel quel (`Europe/Paris`).
 *
 * Validé contre la base de fuseaux du runtime plutôt que contre une expression
 * régulière : un fuseau inexistant doit échouer ici, pas au moment de résoudre
 * une heure de passage (01_ARCHITECTURE §29, ACCEPTANCE AC-TIME-02).
 */
export const ianaTimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isKnownTimeZone, { error: 'fuseau horaire IANA inconnu' });
