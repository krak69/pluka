import type { RaceRecord } from '@pluka/db';

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

export interface RaceTransition {
  readonly from: RaceStatus;
  readonly to: RaceStatus;
  readonly authority: TransitionAuthority;
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
  return (
    RACE_TRANSITIONS.find((transition) => transition.from === from && transition.to === to) ?? null
  );
}

export function allowedRaceTransitions(from: RaceStatus): readonly RaceTransition[] {
  return RACE_TRANSITIONS.filter((transition) => transition.from === from);
}

/**
 * Une transition qui sort de l'archivage.
 *
 * §4.1 la décrit comme un « retour au statut antérieur à l'archivage » : la
 * cible n'est donc pas libre, elle est dictée par l'historique. Le use case
 * relit le journal pour la vérifier.
 */
export function isUnarchiving(transition: RaceTransition): boolean {
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
