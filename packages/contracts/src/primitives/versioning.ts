import { z } from 'zod';

import { nonEmptyStringSchema, sha256HexSchema } from './ids.js';
import { instantSchema } from './time.js';

/**
 * Métadonnées de reproductibilité d'un calcul.
 *
 * Champs de `01_ARCHITECTURE.md` §30 : comprendre pourquoi un utilisateur avait
 * obtenu ce résultat à cette date. `engineVersion` et `computedAt` sont exigés ;
 * les autres dépendent du moteur concerné (`processorVersion` pour le GPX,
 * `configVersion` pour la normalisation météo…). La `calibrationVersion` de Race
 * Intelligence appartient à sa spec moteur et n'est pas modélisée ici.
 */
export const computationMetadataSchema = z.object({
  engineVersion: nonEmptyStringSchema,
  processorVersion: nonEmptyStringSchema.optional(),
  configVersion: nonEmptyStringSchema.optional(),
  inputHash: sha256HexSchema.optional(),
  computedAt: instantSchema,
  calculationReason: nonEmptyStringSchema.optional(),
});

export type ComputationMetadata = z.infer<typeof computationMetadataSchema>;
