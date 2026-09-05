import type { EmailProvider } from '@pluka/contracts';

import { createResendProvider } from './resend.js';

/**
 * Choix du fournisseur email, à partir de la configuration.
 *
 * `01_ARCHITECTURE` §28 : le choix des fournisseurs n'est pas figé, et une
 * brique dont le provider n'est pas configuré « doit se désactiver proprement,
 * pas fabriquer une valeur ».
 *
 * Rendre `null` n'est donc pas un échec silencieux. §35 décrit la dégradation
 * attendue — « l'invitation reste persistée et le job est retenté » — et c'est
 * exactement ce qui se passe : la livraison reste en attente, l'impact reste
 * lisible dans l'application, et l'envoi repartira quand un fournisseur sera
 * configuré. Rien n'est perdu.
 *
 * C'est ici, et nulle part ailleurs en amont, que le nom d'un fournisseur est
 * comparé à quoi que ce soit.
 */
export interface EmailEnvironment {
  readonly EMAIL_PROVIDER?: string | undefined;
  readonly EMAIL_API_KEY?: string | undefined;
  readonly EMAIL_FROM?: string | undefined;
}

export function createEmail(env: EmailEnvironment): EmailProvider | null {
  const name = env.EMAIL_PROVIDER;

  if (name === undefined || name === '') return null;

  // `packages/config` refuse déjà un fournisseur nommé sans ses compagnons. La
  // vérification est répétée ici parce que ce module est appelable sans passer
  // par lui, et qu'un fournisseur à moitié configuré vaut moins qu'aucun.
  const apiKey = env.EMAIL_API_KEY;
  const from = env.EMAIL_FROM;

  if (apiKey === undefined || apiKey === '' || from === undefined || from === '') return null;

  if (name === 'resend') return createResendProvider({ apiKey, from });

  // Un fournisseur nommé mais sans adapter n'est pas un fournisseur. Se taire
  // et laisser la livraison en attente vaut mieux qu'échouer au démarrage.
  return null;
}

export { createResendProvider, type ResendOptions } from './resend.js';
