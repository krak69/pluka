import type { ConfiguredAI } from '../ports.js';
import { createAnthropicProvider } from './anthropic.js';

/**
 * Choix du fournisseur IA, à partir de la configuration.
 *
 * `01_ARCHITECTURE` §28 : le choix des fournisseurs n'est pas figé, et une
 * brique dont le provider n'est pas configuré « doit se désactiver proprement,
 * pas fabriquer une valeur ». Rendre `null` est donc un résultat de plein
 * droit : l'extraction déterministe de §29 continue de tourner, et les
 * candidats qu'elle produit sont exactement les mêmes.
 *
 * C'est ici, et nulle part ailleurs en amont, que le nom d'un fournisseur est
 * comparé à quoi que ce soit.
 */
export interface AIEnvironment {
  readonly AI_PROVIDER?: string | undefined;
  readonly AI_API_KEY?: string | undefined;
  readonly AI_MODEL?: string | undefined;
}

export function createAI(env: AIEnvironment): ConfiguredAI | null {
  const name = env.AI_PROVIDER;

  if (name === undefined || name === '') return null;

  // `packages/config` refuse déjà un fournisseur nommé sans ses identifiants.
  // La vérification est répétée ici parce que ce module est appelable sans
  // passer par lui, et qu'un fournisseur à moitié configuré vaut moins qu'aucun.
  const apiKey = env.AI_API_KEY;
  const model = env.AI_MODEL;

  if (apiKey === undefined || apiKey === '' || model === undefined || model === '') return null;

  if (name === 'anthropic') {
    return { provider: createAnthropicProvider({ apiKey, model }), model };
  }

  // Un fournisseur nommé mais sans adapter n'est pas un fournisseur. Se taire
  // et continuer en déterministe vaut mieux qu'échouer au démarrage : les
  // candidats structurés continuent d'arriver.
  return null;
}

export { createAnthropicProvider, type AnthropicOptions } from './anthropic.js';
