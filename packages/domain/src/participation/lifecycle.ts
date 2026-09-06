import type { Enum } from '@pluka/db';

/**
 * Cycle de vie d'une participation — 02_DATA_MODEL §9.3, 00_PRODUCT_SPEC §11.
 *
 * « Une participation peut passer par : à préparer ; en préparation ; prête ;
 * terminée ; DNS ; DNF. » Ces six états sont ceux de `preparation_state`, et
 * ce sont ceux que « Ma saison » affiche.
 *
 * Aucune table de transitions n'est écrite ici. §9.3 et §11 décrivent une
 * vue, pas un workflow : ni l'ordre des états, ni leur réversibilité ne sont
 * spécifiés, et les inventer figerait un comportement produit que personne
 * n'a décidé. §4.1 donne d'ailleurs le précédent inverse pour la course
 * elle-même — « `completed` n'est jamais déclenché par le passage de la
 * date » : c'est une déclaration, pas une déduction. Un coureur qui corrige
 * un DNF saisi par erreur doit pouvoir le faire.
 */
export type PreparationState = Enum<'preparation_state'>;
export type ParticipationStatus = Enum<'participant_race_status'>;

export const PREPARATION_STATES = [
  'to_prepare',
  'preparing',
  'ready',
  'completed',
  'dns',
  'dnf',
] as const;

/**
 * Garde de complétude, vérifiée à la compilation.
 *
 * Les deux affectations échouent si la liste et l'enum PostgreSQL divergent —
 * dans un sens comme dans l'autre. Un septième état ajouté en migration sans
 * décision produit devient une erreur de build, pas un état muet.
 */
const _statesCoverEnum: readonly (typeof PREPARATION_STATES)[number][] =
  [] as readonly PreparationState[];
const _enumCoversStates: readonly PreparationState[] = PREPARATION_STATES;
void _statesCoverEnum;
void _enumCoversStates;

/**
 * États qui disent que la course est derrière le coureur.
 *
 * Ce sont exactement les trois derniers de §9.3. Les trois premiers décrivent
 * un travail de préparation en cours.
 */
const OUTCOME_STATES: readonly PreparationState[] = ['completed', 'dns', 'dnf'];

export function isOutcomeState(state: PreparationState): boolean {
  return OUTCOME_STATES.includes(state);
}

/**
 * Statut de participation correspondant à un état de préparation.
 *
 * `participant_races` porte deux colonnes qui parlent du même fait :
 * `preparation_state`, que la documentation spécifie, et `status`, que seul le
 * schéma nomme. Les laisser écrire séparément permettrait qu'une
 * participation soit `finished` en base tout en restant « à préparer » à
 * l'écran, et rien ne dirait laquelle des deux a raison.
 *
 * `status` est donc dérivé, et jamais reçu de l'appelant. C'est une décision
 * d'implémentation, prise faute de règle documentée pour la colonne `status` :
 * elle évite deux sources de vérité pour un même fait.
 *
 * `archived` n'est atteignable par aucun état de préparation : sortir une
 * participation de la circulation n'est pas une étape de préparation, et §4.1
 * réserve l'archivage à un geste d'administration. Aucun use case de ce lot ne
 * l'écrit.
 */
export function participationStatusFor(state: PreparationState): ParticipationStatus {
  if (state === 'completed') return 'finished';
  if (state === 'dns') return 'dns';
  if (state === 'dnf') return 'dnf';

  return 'active';
}
