import type { EditionRecord, EventRecord, RaceRecord } from '@pluka/db';

import type { RaceGpxImportStage } from './gpx.js';

/**
 * Où en est un événement — ce qui manque pour que les coureurs le voient et
 * le préparent.
 *
 * Une seule lecture de l'état, pour deux écrans : la fiche événement de la
 * console PLUKA et, demain, l'Accueil de l'espace organisateur
 * (05_ROUTES_FLOWS §1.9). Les écrans diffèrent, la vérité est la même.
 *
 * Fonction pure : elle reçoit ce que les use cases ont lu, et ne décide
 * rien. Aucun point n'autorise ni ne bloque un geste — les transitions
 * restent gardées par leurs use cases et par la base. Un état qui n'a pas pu
 * être lu (`null`) donne un point `unknown`, jamais un point réputé fait
 * (AGENTS §38).
 */

// ------------------------------------------------------------
// Visibilité
// ------------------------------------------------------------

/** Statuts d'édition qui laissent passer une épreuve publiée — 0005. */
const READABLE_EDITION: ReadonlySet<string> = new Set(['published', 'completed']);

/**
 * Une épreuve est-elle lisible des coureurs, telle que la base le tranche
 * aujourd'hui (`private.race_is_publicly_readable`, 0005) : épreuve
 * `published` et `public`, édition diffusée ou courue, événement publié.
 *
 * Plus stricte que `isRacePubliclyReadable`, qui suit §4.1 et laisse aussi
 * passer une épreuve annulée, courue ou archivée. L'écart est signalé, pas
 * tranché ici : cette fonction dit ce que les coureurs voient réellement.
 */
export function isRaceVisibleToRunners(
  event: Pick<EventRecord, 'status'>,
  edition: Pick<EditionRecord, 'status'>,
  race: Pick<RaceRecord, 'status' | 'publicVisibility'>,
): boolean {
  return (
    race.status === 'published' &&
    race.publicVisibility === 'public' &&
    READABLE_EDITION.has(edition.status) &&
    event.status === 'published'
  );
}

// ------------------------------------------------------------
// Entrées
// ------------------------------------------------------------

export interface RaceReadinessInput {
  readonly race: Pick<RaceRecord, 'id' | 'name' | 'status' | 'publicVisibility'> &
    Partial<Pick<RaceRecord, 'cutoffDatetime'>>;
  /** Avancement de l'import GPX ; `null` s'il n'a pas pu être lu. */
  readonly gpxStage: RaceGpxImportStage | null;
  /**
   * Catégories qui ont au moins une information publiée, non retirée ;
   * `null` si les informations n'ont pas pu être lues.
   */
  readonly publishedCategories: ReadonlySet<string> | null;
  /**
   * Le référentiel de parcours saisi (PLAN_ENGINE §7) : barrières posées sur
   * les points de passage, points de ravitaillement. C'est lui que le Plan
   * consomme ; `null` s'il n'a pas pu être lu. Absent : non fourni.
   */
  readonly courseReference?: {
    readonly cutoffs: number;
    readonly aidStations: number;
  } | null;
}

export interface EditionReadinessInput {
  readonly edition: Pick<EditionRecord, 'id' | 'year' | 'status'>;
  readonly races: readonly RaceReadinessInput[];
}

export interface EventReadinessInput {
  readonly event: Pick<EventRecord, 'status'>;
  readonly editions: readonly EditionReadinessInput[];
  /** Informations extraites en attente de revue, édition courante ; `null` si non lu. */
  readonly pendingReview: number | null;
}

// ------------------------------------------------------------
// Sorties
// ------------------------------------------------------------

export type ReadinessTodoKind =
  | 'first-edition'
  | 'publish-event'
  | 'publish-edition'
  | 'add-race'
  | 'publish-races'
  | 'open-races'
  | 'review';

export interface ReadinessTodo {
  readonly kind: ReadinessTodoKind;
  readonly title: string;
  readonly detail: string;
  /** Édition concernée, pour l'ancre du geste. */
  readonly editionId?: string;
  /** Une seule épreuve concernée : le geste mène droit à sa fiche. */
  readonly raceId?: string;
}

export type ReadinessItemKey =
  'races' | 'gpx' | 'cutoff' | 'equipment' | 'aid' | 'review' | 'visibility';

export interface ReadinessItem {
  readonly key: ReadinessItemKey;
  readonly label: string;
  readonly state: 'done' | 'todo' | 'unknown';
  /** Le compte qui justifie l'état — « 2 sur 3 épreuves ». */
  readonly detail: string | null;
}

export interface EventReadiness {
  /** L'édition la plus récente : c'est elle que l'état suit. */
  readonly currentEditionId: string | null;
  readonly todos: readonly ReadinessTodo[];
  /** La ligne Aube : le premier point, ou rien à reprendre. */
  readonly nextStep: { readonly text: string; readonly due: boolean };
  readonly checklist: readonly ReadinessItem[];
  /** Points faits sur le total — un compte, jamais un pourcentage (AGENTS §49). */
  readonly done: number;
  readonly total: number;
  readonly visibleRaces: number;
  readonly totalRaces: number;
}

// ------------------------------------------------------------
// Calcul
// ------------------------------------------------------------

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** L'édition la plus récente. */
export function currentEditionOf<T extends { readonly edition: { readonly year: number } }>(
  editions: readonly T[],
): T | undefined {
  return [...editions].sort((left, right) => right.edition.year - left.edition.year)[0];
}

/**
 * Ce qui sépare l'édition courante des coureurs, dans l'ordre de la chaîne
 * (00_PRODUCT_SPEC §4.1) : l'événement, l'édition, ses épreuves — puis les
 * informations extraites qui attendent une revue. Une édition passée ne crée
 * pas de point.
 */
function todosOf(input: EventReadinessInput): readonly ReadinessTodo[] {
  const current = currentEditionOf(input.editions);

  if (current === undefined) {
    return [
      {
        kind: 'first-edition',
        title: 'Créer une première édition',
        detail: 'Les épreuves et les documents de course se rattachent à une édition.',
      },
    ];
  }

  const { edition } = current;
  const races = current.races.map((entry) => entry.race);
  const todos: ReadinessTodo[] = [];

  if (input.event.status === 'draft') {
    todos.push({
      kind: 'publish-event',
      title: 'Publier l’événement',
      detail:
        'Tant qu’il est en préparation, aucune de ses épreuves n’est visible des coureurs, même publiée.',
    });
  }

  if (edition.status === 'draft') {
    todos.push({
      kind: 'publish-edition',
      title: `Diffuser l’édition ${edition.year}`,
      detail: 'Une épreuve ne se publie que sous une édition diffusée.',
      editionId: edition.id,
    });
  }

  if (races.length === 0) {
    todos.push({
      kind: 'add-race',
      title: `Ajouter une épreuve à l’édition ${edition.year}`,
      detail: 'Distance, départ et fuseau suffisent ; le reste se complète ensuite.',
      editionId: edition.id,
    });
  }

  // Une épreuve naît en brouillon et privée (0001) : les deux se règlent au
  // même endroit, le panneau « Publication » de sa fiche.
  const drafts = races.filter((race) => race.status === 'draft');
  if (drafts.length > 0) {
    todos.push({
      kind: 'publish-races',
      title: `${plural(drafts.length, 'épreuve', 'épreuves')} en préparation`,
      detail:
        'Sur sa fiche, panneau « Publication » : passer en « Diffusée », et choisir la visibilité « Publique ».',
      editionId: edition.id,
      ...(drafts.length === 1 && drafts[0] !== undefined ? { raceId: drafts[0].id } : {}),
    });
  }

  const hidden = races.filter(
    (race) => race.status !== 'draft' && race.publicVisibility !== 'public',
  );
  if (hidden.length > 0) {
    todos.push({
      kind: 'open-races',
      title: plural(
        hidden.length,
        'épreuve diffusée mais non publique',
        'épreuves diffusées mais non publiques',
      ),
      detail:
        'Les coureurs ne les trouvent pas. La visibilité se règle sur leur fiche, panneau « Publication ».',
      editionId: edition.id,
      ...(hidden.length === 1 && hidden[0] !== undefined ? { raceId: hidden[0].id } : {}),
    });
  }

  if (input.pendingReview !== null && input.pendingReview > 0) {
    todos.push({
      kind: 'review',
      title: `${plural(input.pendingReview, 'information', 'informations')} à vérifier`,
      detail: 'Extraites des documents de course, elles attendent une décision avant publication.',
    });
  }

  return todos;
}

function nextStepOf(todos: readonly ReadinessTodo[]): EventReadiness['nextStep'] {
  const first = todos[0];
  if (first === undefined) return { text: 'Rien à reprendre', due: false };
  if (todos.length === 1) return { text: first.title, due: true };

  const others = todos.length - 1;
  return {
    text: `${first.title} · ${plural(others, 'autre point', 'autres points')}`,
    due: true,
  };
}

/**
 * Un point « pour chaque épreuve » : fait quand toutes le remplissent,
 * inconnu dès qu'une n'a pas pu être lue, à faire sinon.
 */
function perRace(
  key: ReadinessItemKey,
  label: string,
  races: readonly RaceReadinessInput[],
  test: (race: RaceReadinessInput) => boolean | null,
): ReadinessItem {
  if (races.length === 0) return { key, label, state: 'todo', detail: 'Aucune épreuve' };

  const verdicts = races.map(test);
  if (verdicts.includes(null)) return { key, label, state: 'unknown', detail: 'Non lu' };

  const met = verdicts.filter((verdict) => verdict === true).length;
  return {
    key,
    label,
    state: met === races.length ? 'done' : 'todo',
    detail: `${met} sur ${plural(races.length, 'épreuve', 'épreuves')}`,
  };
}

function hasCategory(category: string) {
  return (entry: RaceReadinessInput): boolean | null =>
    entry.publishedCategories === null ? null : entry.publishedCategories.has(category);
}

/**
 * Plusieurs sources pour un même point : il est rempli dès qu'une source le
 * dit, inconnu si aucune ne le dit et qu'une n'a pas pu être lue.
 */
function anyOf(...verdicts: readonly (boolean | null)[]): boolean | null {
  if (verdicts.includes(true)) return true;
  return verdicts.includes(null) ? null : false;
}

/** Le référentiel de parcours, quand il est fourni. Non fourni : il ne compte pas. */
function reference(
  entry: RaceReadinessInput,
  count: (value: { readonly cutoffs: number; readonly aidStations: number }) => number,
): boolean | null {
  if (entry.courseReference === undefined) return false;
  if (entry.courseReference === null) return null;
  return count(entry.courseReference) > 0;
}

/**
 * Une épreuve a ses barrières dès qu'une source en porte : une barrière
 * finale sur la fiche, une barrière sur un point de passage, ou une
 * information « Barrières horaires » publiée.
 */
function hasCutoffs(entry: RaceReadinessInput): boolean | null {
  return anyOf(
    entry.race.cutoffDatetime !== undefined && entry.race.cutoffDatetime !== null,
    reference(entry, (value) => value.cutoffs),
    hasCategory('cutoff')(entry),
  );
}

/** Un point de ravitaillement au référentiel, ou une information « Ravitaillement » publiée. */
function hasAidStations(entry: RaceReadinessInput): boolean | null {
  return anyOf(
    reference(entry, (value) => value.aidStations),
    hasCategory('aid')(entry),
  );
}

function checklistOf(
  input: EventReadinessInput,
  current: EditionReadinessInput | undefined,
): readonly ReadinessItem[] {
  const races = current?.races ?? [];

  const review: ReadinessItem =
    input.pendingReview === null
      ? { key: 'review', label: 'Informations à vérifier', state: 'unknown', detail: 'Non lu' }
      : input.pendingReview === 0
        ? { key: 'review', label: 'Aucune information à vérifier', state: 'done', detail: null }
        : {
            key: 'review',
            label: `${plural(input.pendingReview, 'information', 'informations')} à vérifier`,
            state: 'todo',
            detail: null,
          };

  return [
    {
      key: 'races',
      label: races.length === 0 ? 'Épreuves à configurer' : 'Épreuves configurées',
      state: races.length === 0 ? 'todo' : 'done',
      detail: races.length === 0 ? null : plural(races.length, 'épreuve', 'épreuves'),
    },
    perRace('gpx', 'Traces GPX importées', races, (entry) =>
      entry.gpxStage === null ? null : entry.gpxStage === 'completed',
    ),
    perRace('cutoff', 'Barrières horaires renseignées', races, hasCutoffs),
    perRace('equipment', 'Matériel renseigné', races, hasCategory('equipment')),
    perRace('aid', 'Ravitaillements renseignés', races, hasAidStations),
    review,
    perRace('visibility', 'Épreuves visibles des coureurs', races, (entry) =>
      current === undefined
        ? false
        : isRaceVisibleToRunners(input.event, current.edition, entry.race),
    ),
  ];
}

export function eventReadiness(input: EventReadinessInput): EventReadiness {
  const current = currentEditionOf(input.editions);
  const todos = todosOf(input);
  const checklist = checklistOf(input, current);
  const allRaces = input.editions.flatMap(({ edition, races }) =>
    races.map((entry) => ({ edition, race: entry.race })),
  );

  return {
    currentEditionId: current?.edition.id ?? null,
    todos,
    nextStep: nextStepOf(todos),
    checklist,
    done: checklist.filter((item) => item.state === 'done').length,
    total: checklist.length,
    visibleRaces: allRaces.filter(({ edition, race }) =>
      isRaceVisibleToRunners(input.event, edition, race),
    ).length,
    totalRaces: allRaces.length,
  };
}

// ------------------------------------------------------------
// Chaîne de visibilité d'une épreuve
// ------------------------------------------------------------

export type VisibilityConditionKey = 'event' | 'edition' | 'race' | 'visibility';

export interface VisibilityCondition {
  readonly key: VisibilityConditionKey;
  readonly ok: boolean;
}

export interface RaceVisibilityChain {
  readonly visible: boolean;
  /** Les quatre conditions, dans l'ordre où elles se remplissent. */
  readonly conditions: readonly VisibilityCondition[];
  /** La première condition manquante — le prochain geste. */
  readonly blocking: VisibilityConditionKey | null;
}

/**
 * Les quatre conditions d'`isRaceVisibleToRunners`, une par une : la fiche
 * épreuve dit laquelle manque, et dans quel ordre les remplir.
 */
export function raceVisibilityChain(
  event: Pick<EventRecord, 'status'>,
  edition: Pick<EditionRecord, 'status'>,
  race: Pick<RaceRecord, 'status' | 'publicVisibility'>,
): RaceVisibilityChain {
  const conditions: readonly VisibilityCondition[] = [
    { key: 'event', ok: event.status === 'published' },
    { key: 'edition', ok: READABLE_EDITION.has(edition.status) },
    { key: 'race', ok: race.status === 'published' },
    { key: 'visibility', ok: race.publicVisibility === 'public' },
  ];

  return {
    visible: isRaceVisibleToRunners(event, edition, race),
    conditions,
    blocking: conditions.find((condition) => !condition.ok)?.key ?? null,
  };
}
