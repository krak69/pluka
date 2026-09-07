import type { EditionRecord, EventRecord, RaceRecord } from '@pluka/db';

/**
 * Cycle de vie d'une Race — 00_PRODUCT_SPEC §4.1.
 *
 * ```text
 * draft ──► published ──► completed ──► archived
 *              │                            ▲
 *              └────────► cancelled ────────┘
 * ```
 *
 * Module pur : une table de transitions et les fonctions qui l'interrogent.
 * Aucune I/O, aucune horloge — la date ne décide rien ici, et c'est un point
 * de spec, pas une commodité : « `completed` n'est jamais déclenché par le
 * passage de la date. Une course non déclarée reste `published`. »
 */

export type RaceStatus = RaceRecord['status'];

/**
 * Autorité requise par une transition.
 *
 * `organization_editor` et `organization_admin` désignent un rang minimum
 * dans l'organisation gestionnaire ; `pluka_admin` y est toujours admis, en
 * tant qu'administrateur de la base courses. `platform_admin` désigne les
 * transitions que §4.1 lui réserve exclusivement.
 */
export type TransitionAuthority = 'organization_editor' | 'organization_admin' | 'platform_admin';

/**
 * Une transition, quel que soit le niveau de la hiérarchie.
 *
 * Event, Edition et Race ont chacun leur enum de statut — `record_status` n'a
 * ni `completed` ni `cancelled` — mais la même forme de règle : d'où, vers
 * où, avec quelle autorité. Le paramètre de type garde chaque table close sur
 * ses propres statuts, sans dupliquer les fonctions qui les interrogent.
 */
export interface StatusTransition<TStatus extends string> {
  readonly from: TStatus;
  readonly to: TStatus;
  readonly authority: TransitionAuthority;
}

export type RaceTransition = StatusTransition<RaceStatus>;

function findTransition<TStatus extends string>(
  table: readonly StatusTransition<TStatus>[],
  from: TStatus,
  to: TStatus,
): StatusTransition<TStatus> | null {
  return table.find((transition) => transition.from === from && transition.to === to) ?? null;
}

function allowedFrom<TStatus extends string>(
  table: readonly StatusTransition<TStatus>[],
  from: TStatus,
): readonly StatusTransition<TStatus>[] {
  return table.filter((transition) => transition.from === from);
}

/**
 * Les seules transitions autorisées.
 *
 * Ce tableau est la traduction littérale du tableau « Qui peut faire quoi »
 * de §4.1. Toute transition absente est refusée avec `invalid_state` — y
 * compris `draft → cancelled`, que le diagramme ne relie pas : une course
 * jamais diffusée se supprime ou reste en brouillon, elle ne s'annule pas
 * publiquement.
 */
export const RACE_TRANSITIONS: readonly RaceTransition[] = [
  { from: 'draft', to: 'published', authority: 'organization_editor' },
  { from: 'published', to: 'cancelled', authority: 'organization_admin' },
  { from: 'published', to: 'completed', authority: 'platform_admin' },
  { from: 'completed', to: 'archived', authority: 'platform_admin' },
  { from: 'cancelled', to: 'archived', authority: 'platform_admin' },
  { from: 'archived', to: 'completed', authority: 'platform_admin' },
  { from: 'archived', to: 'cancelled', authority: 'platform_admin' },
];

export function findRaceTransition(from: RaceStatus, to: RaceStatus): RaceTransition | null {
  return findTransition(RACE_TRANSITIONS, from, to);
}

export function allowedRaceTransitions(from: RaceStatus): readonly RaceTransition[] {
  return allowedFrom(RACE_TRANSITIONS, from);
}

/**
 * Cycle de vie d'un Event.
 *
 * ```text
 * draft ──► published ──► archived
 *              ▲              │
 *              └──────────────┘
 * ```
 *
 * §4.1 ne donne pas de tableau « qui peut faire quoi » pour l'Event : il en
 * donne un pour la Race, et pose l'invariant qui rend l'Event publiable
 * — « une Race n'est publiquement lisible que si […] son Event l'est aussi ».
 * Cette table est la transposition de ce tableau au cycle plus court que
 * `record_status` autorise (draft / published / archived), et non une règle
 * nouvelle :
 *
 * - diffuser reste un acte d'`editor`, comme `draft → published` d'une Race ;
 * - sortir de la circulation courante reste réservé à `pluka_admin`, comme
 *   tous les archivages de §4.1 ;
 * - `draft → archived` est absent pour la même raison que `draft → cancelled`
 *   l'est chez la Race : ce qui n'a jamais circulé ne se retire pas de la
 *   circulation.
 *
 * Un événement n'a ni `cancelled` ni `completed` : ces deux statuts qualifient
 * une occurrence datée, donc une Edition ou une Race, pas l'objet récurrent
 * qui les porte (02_DATA_MODEL §6.1).
 */
export type EventStatus = EventRecord['status'];
export type EventTransition = StatusTransition<EventStatus>;

export const EVENT_TRANSITIONS: readonly EventTransition[] = [
  { from: 'draft', to: 'published', authority: 'organization_editor' },
  { from: 'published', to: 'archived', authority: 'platform_admin' },
  { from: 'archived', to: 'published', authority: 'platform_admin' },
];

export function findEventTransition(from: EventStatus, to: EventStatus): EventTransition | null {
  return findTransition(EVENT_TRANSITIONS, from, to);
}

export function allowedEventTransitions(from: EventStatus): readonly EventTransition[] {
  return allowedFrom(EVENT_TRANSITIONS, from);
}

/**
 * Cycle de vie d'une Edition — le même que celui d'une Race.
 *
 * `edition_status` et `race_status` portent les mêmes cinq valeurs, et pour
 * cause : une édition est une occurrence datée, comme l'épreuve. Elle
 * s'annule, elle se déclare courue, elle s'archive et se désarchive dans les
 * mêmes termes. La table de §4.1 s'y transpose donc littéralement, autorités
 * comprises.
 *
 * Ce qui distingue les deux niveaux n'est pas la table mais la chaîne :
 * publier une édition demande un événement déjà publié, comme publier une
 * épreuve demande une édition déjà diffusée (`checkEditionPublication`).
 */
export type EditionStatus = EditionRecord['status'];
export type EditionTransition = StatusTransition<EditionStatus>;

export const EDITION_TRANSITIONS: readonly EditionTransition[] = [
  { from: 'draft', to: 'published', authority: 'organization_editor' },
  { from: 'published', to: 'cancelled', authority: 'organization_admin' },
  { from: 'published', to: 'completed', authority: 'platform_admin' },
  { from: 'completed', to: 'archived', authority: 'platform_admin' },
  { from: 'cancelled', to: 'archived', authority: 'platform_admin' },
  { from: 'archived', to: 'completed', authority: 'platform_admin' },
  { from: 'archived', to: 'cancelled', authority: 'platform_admin' },
];

export function findEditionTransition(
  from: EditionStatus,
  to: EditionStatus,
): EditionTransition | null {
  return findTransition(EDITION_TRANSITIONS, from, to);
}

export function allowedEditionTransitions(from: EditionStatus): readonly EditionTransition[] {
  return allowedFrom(EDITION_TRANSITIONS, from);
}

/**
 * Une transition qui sort de l'archivage.
 *
 * §4.1 la décrit comme un « retour au statut antérieur à l'archivage » : la
 * cible n'est donc pas libre, elle est dictée par l'historique. Le use case
 * relit le journal pour la vérifier.
 */
export function isUnarchiving(transition: StatusTransition<string>): boolean {
  return transition.from === 'archived';
}

/**
 * Statuts sous lesquels une Race peut être lue publiquement — §4.1,
 * invariant 1.
 *
 * `draft` en est exclu « quelle que soit la chaîne au-dessus ». Une course
 * annulée, elle, reste visible : c'est explicitement voulu, le travail de
 * préparation appartient au coureur.
 */
const PUBLICLY_READABLE_STATUSES: readonly RaceStatus[] = [
  'published',
  'cancelled',
  'completed',
  'archived',
];

export function isPubliclyReadableStatus(status: RaceStatus): boolean {
  return PUBLICLY_READABLE_STATUSES.includes(status);
}

/**
 * Une annulation reste possible tant que la course n'est ni `completed` ni
 * `archived` — « y compris après la date de départ : une course peut être
 * annulée sur place le jour J » (§4.1).
 *
 * Fonction dérivée de la table, pas une seconde règle : elle sert à expliquer
 * un refus, pas à l'autoriser.
 */
export function canStillBeCancelled(status: RaceStatus): boolean {
  return findRaceTransition(status, 'cancelled') !== null;
}
