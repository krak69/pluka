/**
 * Résultat de la demande de présentation.
 *
 * Dans un module à part : un fichier `'use server'` ne peut exporter que des
 * fonctions asynchrones, et l'état initial est une valeur.
 */
export type ContactOutcome =
  | { readonly state: 'idle' }
  /** Le formulaire a été soumis ; aucune destination n'est branchée. */
  | { readonly state: 'unconfigured' };

export const initialContactOutcome: ContactOutcome = { state: 'idle' };
