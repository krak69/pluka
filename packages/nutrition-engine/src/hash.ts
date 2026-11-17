import { createHash } from 'node:crypto';

import type { NutritionEngineConfig } from './config.js';
import type { NutritionInput } from './contracts.js';

/** JSON aux clés triées : même entrée, même chaîne, quel que soit l'ordre d'écriture. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** §79 : l'empreinte de l'entrée et des versions — de quoi rejouer un calcul à l'identique. */
export function computeNutritionHash(input: NutritionInput, config: NutritionEngineConfig): string {
  return createHash('sha256')
    .update(canonical({ input, engine: config.engineVersion, config: config.configVersion }))
    .digest('hex');
}
