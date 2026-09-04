import { z } from 'zod';

/** Latitude décimale WGS84. Bornes alignées sur les contraintes SQL. */
export const latitudeSchema = z.number().min(-90).max(90);

/** Longitude décimale WGS84. */
export const longitudeSchema = z.number().min(-180).max(180);

/**
 * Altitude du parcours en mètres.
 *
 * C'est l'altitude issue de la trace, jamais une valeur reconstruite par un
 * provider ou corrigée par une formule non spécifiée
 * (ACCEPTANCE AC-WX-06, AGENTS §17).
 */
export const routeAltitudeMetersSchema = z.number().int();
