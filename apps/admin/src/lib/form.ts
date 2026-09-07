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

/**
 * Fichier déposé, ou `undefined` si le champ est vide.
 *
 * `FormData` rend un `File` de taille nulle quand aucun fichier n'a été
 * choisi : sans cette borne, un formulaire soumis vide produirait un dépôt
 * vide au lieu d'un refus nommé.
 */
export function file(form: FormData, field: string): File | undefined {
  const value = form.get(field);
  if (!(value instanceof File) || value.size === 0) return undefined;

  return value;
}

export function optionalNumber(form: FormData, field: string): number | null | undefined {
  const value = text(form, field);
  if (value === undefined) return undefined;

  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Valeurs d'un champ répété, dans l'ordre du document.
 *
 * Une liste postée en champs de même nom — `getAll` — plutôt qu'en indices :
 * l'ordre du formulaire est celui de la chaîne, et un indice saisi serait une
 * seconde façon de dire la même chose.
 */
export function texts(form: FormData, field: string): readonly string[] {
  return form.getAll(field).map((value) => (typeof value === 'string' ? value.trim() : ''));
}

/**
 * Commande de réécriture du référentiel de parcours.
 *
 * Les quatre colonnes sont lues en parallèle : chaque `fieldset` du formulaire
 * en pose une valeur, donc les tableaux ont la même longueur et le même ordre.
 * Rien n'est validé ici — `setRaceWaypoints` a un schéma, et les invariants de
 * chaîne sont dans le domaine.
 */
export function raceWaypointsCommand(form: FormData): Record<string, unknown> {
  const ids = texts(form, 'waypointId');
  const names = texts(form, 'name');
  const types = texts(form, 'waypointType');
  const distances = texts(form, 'distanceKm');
  const cutoffs = texts(form, 'cutoffAt');

  return {
    raceId: text(form, 'raceId'),
    waypoints: names.map((name, index) => ({
      // Chaîne vide : point ajouté, sans identité encore.
      ...(ids[index] === undefined || ids[index] === '' ? {} : { id: ids[index] }),
      name,
      waypointType: types[index],
      distanceKm: toNumber(distances[index]),
      cutoffAt: toInstant(cutoffs[index]),
    })),
  };
}

/** `undefined` plutôt que `NaN` : le schéma nomme un champ manquant, pas un calcul raté. */
function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;

  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * `datetime-local` rend `2026-06-20T11:00`, sans fuseau.
 *
 * Le schéma du domaine exige un instant avec décalage : la valeur est donc
 * complétée en UTC. C'est une convention de saisie assumée — l'écran
 * d'administration travaille en temps universel, et la timezone de l'épreuve
 * sert à l'affichage coureur, pas à interpréter une barrière saisie ici.
 */
function toInstant(value: string | undefined): string | null {
  if (value === undefined || value === '') return null;

  return value.length === 16 ? `${value}:00Z` : value;
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
