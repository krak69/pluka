import type { CreateEventCommand } from '@pluka/domain';

/**
 * Lecture d'un `FormData` de Server Action.
 *
 * Ces fonctions vivent hors de `app/actions.ts` parce qu'un module
 * `'use server'` n'expose que des fonctions asynchrones : la traduction d'un
 * formulaire en commande y est donc intestable, et c'est exactement ce qui a
 * manqué le jour où l'on a cru qu'aucun champ n'arrivait jusqu'à l'action.
 *
 * Elles ne valident rien. Un champ absent, vide ou illisible rend `undefined`,
 * et c'est le schéma du use case qui refuse — une seconde liste de règles ici
 * finirait par diverger de la première (01_ARCHITECTURE §7).
 */

/** Champ texte : `FormData` rend `File | string | null`. */
export function text(form: FormData, field: string): string | undefined {
  const value = form.get(field);
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function optionalNumber(form: FormData, field: string): number | null | undefined {
  const value = text(form, field);
  if (value === undefined) return undefined;

  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Commande de création d'événement, telle que le formulaire la transmet.
 *
 * Le type de retour est `unknown` : `createEvent` valide son entrée lui-même,
 * et annoncer ici une `CreateEventCommand` prétendrait d'un `FormData` qu'il
 * porte déjà des valeurs conformes. Le lien avec la commande du domaine est
 * tenu par le nom des champs, que les tests relisent dans le formulaire rendu.
 */
export function createEventCommand(form: FormData): Record<keyof CreateEventCommand, unknown> {
  const organizationId = text(form, 'organizationId');

  return {
    // Champ vide : événement maintenu par PLUKA, sans organisation
    // gestionnaire (§4.1, 02_DATA_MODEL §3.1).
    organizationId: organizationId ?? null,
    name: text(form, 'name'),
    slug: text(form, 'slug'),
  };
}
