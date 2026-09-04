import { z } from 'zod';

/**
 * Valeur JSON — ce qui peut atterrir dans une colonne `jsonb`.
 *
 * `undefined` et les valeurs non sérialisables sont rejetés : un payload
 * d'événement ou de webhook doit survivre à un aller-retour PostgreSQL sans
 * perdre de champ en silence.
 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema);
