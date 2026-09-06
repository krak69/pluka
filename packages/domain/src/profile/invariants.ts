/**
 * Invariants du Profil trailer — 00_PRODUCT_SPEC §8.
 *
 * Fonctions pures : mêmes entrées, mêmes sorties, aucune I/O, aucune horloge
 * implicite. Elles rendent un verdict ; la traduction en erreur appartient aux
 * use cases.
 *
 * Le profil « sert à comprendre suffisamment le niveau et l'expérience du
 * coureur pour contextualiser sa préparation, sans devenir un diagnostic
 * physiologique ». Rien ici ne le note, ne le classe ni n'en déduit une
 * capacité : PLAN_ENGINE §46 est explicite — « Trail Profile ≠ Plan Engine
 * coefficient V1 ».
 */

/** Forme minimale sur laquelle raisonnent ces invariants. */
export interface TrailProfileShape {
  readonly representativeDistanceKm: number | null;
  readonly representativeElevationGainM: number | null;
  readonly representativeDurationSeconds: number | null;
  readonly representativeEffortDate: string | null;
  readonly fallbackTrailPaceSecondsPerKm: number | null;
}

/**
 * Les trois mesures qui font un effort représentatif.
 *
 * §8.1 énumère « distance ; D+ ; durée ; date facultative » : seule la date
 * est marquée facultative, les trois autres constituent l'effort.
 */
const EFFORT_MEASURES = [
  'representativeDistanceKm',
  'representativeElevationGainM',
  'representativeDurationSeconds',
] as const;

function presentMeasures(profile: TrailProfileShape): number {
  return EFFORT_MEASURES.filter((measure) => profile[measure] !== null).length;
}

/** Un effort représentatif complet : les trois mesures sont là. */
export function hasRepresentativeEffort(profile: TrailProfileShape): boolean {
  return presentMeasures(profile) === EFFORT_MEASURES.length;
}

/**
 * Un effort commencé mais inachevé.
 *
 * Une distance sans durée ne dit rien d'une allure, et une durée sans distance
 * non plus. Un effort à moitié saisi n'est donc pas un signal faible : c'est
 * une donnée qui ne veut rien dire, et qu'il vaut mieux refuser que stocker.
 */
export function hasPartialRepresentativeEffort(profile: TrailProfileShape): boolean {
  const present = presentMeasures(profile);

  return present > 0 && present < EFFORT_MEASURES.length;
}

/**
 * Le profil porte-t-il de quoi situer une allure ?
 *
 * §8.1 : « effort récent représentatif […] à défaut, repère d'allure trail ».
 * Les deux voies sont alternatives, et l'une des deux suffit.
 */
export function hasPaceSignal(profile: TrailProfileShape): boolean {
  return hasRepresentativeEffort(profile) || profile.fallbackTrailPaceSecondsPerKm !== null;
}

export type ProfileVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'partial_effort' | 'effort_in_future' };

/**
 * Cohérence d'un profil, indépendamment de sa complétude.
 *
 * Un profil incomplet reste valide : §7.2 veut qu'on puisse le reprendre sans
 * reposer toutes les questions, ce qui suppose de pouvoir l'enregistrer en
 * cours de route. Ce verdict ne dit donc pas « il manque des réponses », il dit
 * « ces réponses-là ne peuvent pas coexister ».
 *
 * `now` est passé explicitement (AGENTS §35) : un effort « récent » daté dans
 * le futur n'a pas eu lieu. Aucun seuil d'ancienneté n'est imposé — §8 n'en
 * définit aucun, et en inventer un rejetterait le profil d'un coureur qui
 * revient de blessure.
 */
export function checkTrailProfile(profile: TrailProfileShape, now: Date): ProfileVerdict {
  if (hasPartialRepresentativeEffort(profile)) return { ok: false, reason: 'partial_effort' };

  if (profile.representativeEffortDate !== null) {
    // La date est un jour civil sans heure : on la compare à la fin de la
    // journée courante en UTC, pour qu'une saisie « aujourd'hui » passe quel
    // que soit le fuseau du coureur.
    const endOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - 1;

    if (Date.parse(`${profile.representativeEffortDate}T00:00:00Z`) > endOfToday) {
      return { ok: false, reason: 'effort_in_future' };
    }
  }

  return { ok: true };
}
