import type { Enum } from '@pluka/db';

/**
 * Cycle de vie d'une participation — 02_DATA_MODEL §9.3.
 *
 * Deux axes distincts, qui ne répondent pas à la même question :
 *
 * - `preparation_state` — où en est le coureur dans sa préparation ;
 * - `status` — ce qu'est devenue sa participation.
 *
 * Aucun n'est calculé à partir de l'autre. Un coureur peut être `ready` et
 * finir en `dnf` : sa préparation était complète, sa course ne s'est pas
 * terminée. Dériver une colonne de l'autre écraserait cette distinction et
 * ferait perdre l'information « il était prêt ».
 *
 * La migration 0018 a resserré `preparation_state` en conséquence : `dns`,
 * `dnf` et `completed` en sont sortis, ce sont des faits de course.
 *
 * L'ordre des états n'est contraint sur aucun des deux axes. §11 de
 * 00_PRODUCT_SPEC décrit une vue, pas un workflow : un coureur qui a saisi un
 * DNF par erreur doit pouvoir le corriger.
 */
export type PreparationState = Enum<'preparation_state'>;
export type ParticipationStatus = Enum<'participant_race_status'>;

export const PREPARATION_STATES = ['to_prepare', 'preparing', 'ready'] as const;

/**
 * Statuts qu'un coureur déclare lui-même.
 *
 * §9.3 : « `status` est écrit à l'inscription (`active`), après la course
 * (`finished`, `dns`, `dnf`), puis à l'archivage. » Les trois premiers moments
 * appartiennent au coureur ; l'archivage est un geste d'administration, et
 * `archived` reste donc hors de cette liste. Aucun use case de ce lot ne
 * l'écrit.
 */
export const RUNNER_PARTICIPATION_STATUSES = ['active', 'finished', 'dns', 'dnf'] as const;

export type RunnerParticipationStatus = (typeof RUNNER_PARTICIPATION_STATUSES)[number];

/**
 * Gardes de complétude, vérifiées à la compilation.
 *
 * Les affectations échouent si une liste et l'enum PostgreSQL divergent — dans
 * un sens comme dans l'autre pour `preparation_state`, dans le seul sens utile
 * pour les statuts, puisque `archived` est volontairement absent. Une valeur
 * ajoutée en migration sans décision produit devient une erreur de build, pas
 * un état muet.
 */
const _statesCoverEnum: readonly (typeof PREPARATION_STATES)[number][] =
  [] as readonly PreparationState[];
const _enumCoversStates: readonly PreparationState[] = PREPARATION_STATES;
const _runnerStatusesAreStatuses: readonly ParticipationStatus[] = RUNNER_PARTICIPATION_STATUSES;
void _statesCoverEnum;
void _enumCoversStates;
void _runnerStatusesAreStatuses;
