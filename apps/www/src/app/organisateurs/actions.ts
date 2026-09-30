'use server';

import type { ContactOutcome } from '@/app/organisateurs/contact-outcome';

/**
 * Demande de présentation organisateur — destination absente.
 *
 * Le prototype simule l'envoi : `sendForm: () => this.setState({ sent: true })`,
 * puis affiche « Demande envoyée · On vous répond sous quelques jours ». Cet
 * accusé serait faux ici, et l'afficher reviendrait à inventer un comportement
 * que le produit n'a pas.
 *
 * Ce qui manque, précisément :
 *
 * - aucune entité de prospect dans `02_DATA_MODEL.md`, et aucune table
 *   correspondante dans `supabase/migrations/0001` à `0027` — ni `leads`, ni
 *   `contact_requests`, ni équivalent ;
 * - `providerEnvSchema` déclare bien `EMAIL_PROVIDER`, `EMAIL_API_KEY` et
 *   `EMAIL_FROM`, mais en optionnel, et aucun adapter `EmailProvider` concret
 *   n'existe dans le dépôt : `packages/notifications` est un paquet pur, sans
 *   accès réseau, et « l'adapter concret vit hors d'ici » ;
 * - ce paquet ne porte qu'un gabarit, `change-impact`. Rien pour une demande de
 *   présentation organisateur ;
 * - `apps/www` ne dépend pas de `@pluka/notifications`, et §4.1 lui interdit la
 *   logique métier ;
 * - aucune adresse de destination n'apparaît dans la configuration ni dans la
 *   documentation.
 *
 * Rien de tout cela n'est inventé ici. L'action ne lit pas le `FormData`, ne le
 * journalise pas et ne le transmet à personne : elle déclare l'état réel de la
 * fonctionnalité, et l'écran l'affiche tel quel. Le `FormData` figure dans la
 * signature parce que `useActionState` l'impose, pas parce qu'il est consommé.
 *
 * `apps/www` ne lit pas la base (01_ARCHITECTURE.md §4.1) : quand la
 * destination existera, la soumission devra passer par un service de domaine
 * appelé depuis cette action, pas par un client construit dans la page.
 */
export async function requestPresentation(
  _previous: ContactOutcome,
  _submitted: FormData,
): Promise<ContactOutcome> {
  return { state: 'unconfigured' };
}
