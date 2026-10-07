import type { CreateOrganizationCommand, UpdateOrganizationCommand } from '@pluka/domain';

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
 * Case à cocher : `FormData` ne porte le champ que coché, valant `on`.
 *
 * Rend un booléen strict, et c'est le schéma du use case qui exige `true` —
 * une case de confirmation décochée devient un refus nommé, pas un oubli.
 */
export function checked(form: FormData, field: string): boolean {
  return form.get(field) === 'on';
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
 * Commande de création d'un événement — les trois premières étapes du
 * parcours (0042) : événement, édition, épreuves.
 *
 * Les champs portent le chemin de la commande (`event.name`,
 * `races.0.startTime`) : c'est aussi la clé des refus du domaine, qui se
 * posent donc contre leur champ. Les épreuves arrivent indexées ; leurs
 * indices sont relus dans le formulaire, dans l'ordre.
 *
 * Le type de retour est `unknown` en substance : `createEventWithEdition`
 * valide son entrée lui-même. Un champ facultatif vide devient `null`.
 */
export function createEventWithEditionCommand(form: FormData): Record<string, unknown> {
  const indexes = new Set<number>();
  for (const key of form.keys()) {
    const match = /^races\.(\d+)\.name$/.exec(key);
    if (match !== null) indexes.add(Number(match[1]));
  }

  const orNull = (field: string): string | null => text(form, field) ?? null;
  const numberOrNull = (field: string): number | null | undefined =>
    text(form, field) === undefined ? null : optionalNumber(form, field);

  return {
    event: {
      name: text(form, 'event.name'),
      slug: text(form, 'event.slug'),
      // Champ vide : événement maintenu par PLUKA, sans organisation (§4.1).
      organizationId: orNull('event.organizationId'),
      city: orNull('event.city'),
      officialWebsiteUrl: orNull('event.officialWebsiteUrl'),
    },
    edition: {
      year: optionalNumber(form, 'edition.year'),
      slug: text(form, 'edition.slug'),
      startDate: text(form, 'edition.startDate'),
      endDate: orNull('edition.endDate'),
    },
    races: [...indexes]
      .sort((left, right) => left - right)
      .map((index) => ({
        name: text(form, `races.${index}.name`),
        slug: text(form, `races.${index}.slug`),
        distanceKm: optionalNumber(form, `races.${index}.distanceKm`),
        elevationGainM: numberOrNull(`races.${index}.elevationGainM`),
        startDate: text(form, `races.${index}.startDate`),
        startTime: text(form, `races.${index}.startTime`),
        timezone: text(form, `races.${index}.timezone`),
      })),
  };
}

/**
 * Commande de création d'organisation — même principe que `createEventWithEditionCommand`.
 * Un champ facultatif laissé vide devient `null` : la colonne reste vide plutôt
 * que de recevoir une chaîne vide.
 */
export function createOrganizationCommand(
  form: FormData,
): Record<keyof CreateOrganizationCommand, unknown> {
  return {
    name: text(form, 'name'),
    slug: text(form, 'slug'),
    contactEmail: text(form, 'contactEmail') ?? null,
    websiteUrl: text(form, 'websiteUrl') ?? null,
  };
}

/** Commande d'édition d'organisation. Pas de slug : il ne se modifie pas. */
export function updateOrganizationCommand(
  form: FormData,
): Record<keyof UpdateOrganizationCommand, unknown> {
  return {
    organizationId: text(form, 'organizationId'),
    name: text(form, 'name'),
    contactEmail: text(form, 'contactEmail') ?? null,
    websiteUrl: text(form, 'websiteUrl') ?? null,
    status: text(form, 'status'),
  };
}

/**
 * Fiche produit telle que le formulaire la poste — migration 0039. Rien n'est
 * validé ici : `saveNutritionProduct` a son schéma. Un nombre vide devient
 * `null`, jamais 0 (AGENTS §38) ; la virgule décimale est acceptée ; une case
 * à trois états (« oui », « non », « non renseigné ») rend `true`, `false` ou
 * `null`.
 */
export function nutritionProductFromForm(form: FormData): Record<string, unknown> {
  const decimal = (field: string): number | null => {
    const value = text(form, field);
    if (value === undefined) return null;
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };
  const triState = (field: string): boolean | null => {
    const value = text(form, field);
    return value === 'true' ? true : value === 'false' ? false : null;
  };
  const servingQuantity = decimal('servingQuantity');

  return {
    category: text(form, 'category'),
    brand: text(form, 'brand') ?? null,
    name: text(form, 'name') ?? '',
    variant: text(form, 'variant') ?? null,
    servingQuantity,
    servingUnit: servingQuantity === null ? null : 'g',
    caloriesKcal: decimal('caloriesKcal'),
    carbsG: decimal('carbsG'),
    sodiumMg: decimal('sodiumMg'),
    caffeineMg: decimal('caffeineMg'),
    hydrationMl: decimal('hydrationMl'),
    potassiumMg: decimal('potassiumMg'),
    magnesiumMg: decimal('magnesiumMg'),
    proteinG: decimal('proteinG'),
    fatG: decimal('fatG'),
    fiberG: decimal('fiberG'),
    texture: text(form, 'texture') ?? null,
    glucoseFructoseRatio: text(form, 'glucoseFructoseRatio') ?? null,
    isVegan: triState('isVegan'),
    isOrganic: triState('isOrganic'),
    isGlutenFree: triState('isGlutenFree'),
    tags: form.getAll('tags').filter((tag): tag is string => typeof tag === 'string'),
    imageUrl: text(form, 'imageUrl') ?? null,
    purchaseUrl: text(form, 'purchaseUrl') ?? null,
    purchaseIsAffiliate: form.get('purchaseIsAffiliate') === 'on',
    sourceUrl: text(form, 'sourceUrl') ?? null,
    status: text(form, 'status'),
  };
}

/**
 * La valeur corrigée, si elle diffère de la proposition. Les originaux
 * arrivent en champs cachés : le formulaire est prérempli, donc « non vide »
 * ne veut plus dire « corrigé ».
 */
export function candidateCorrection(form: FormData): {
  valueText?: string | null;
  valueNumber?: number | null;
  unit?: string | null;
} {
  const valueText = text(form, 'valueText') ?? null;
  const rawNumber = text(form, 'valueNumber');
  const valueNumber = rawNumber === undefined ? null : Number(rawNumber.replace(',', '.'));
  const unit = text(form, 'unit') ?? null;

  const edited =
    valueText !== (text(form, 'original.valueText') ?? null) ||
    (rawNumber ?? null) !== (text(form, 'original.valueNumber') ?? null) ||
    unit !== (text(form, 'original.unit') ?? null);

  return edited ? { valueText, valueNumber, unit } : {};
}
