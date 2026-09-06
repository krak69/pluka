/**
 * Onboarding coureur — 00_PRODUCT_SPEC §7.
 *
 * §7 décrit trois parcours, et non un seul avec des variantes :
 *
 * ```text
 * §7.1  Recherche / sélection course → fiche course → Profil trailer →
 *       Objectif → cadrage / aperçu → création compte / offre → Plan
 * §7.2  Course → confirmer / ajuster profil → Objectif → Plan
 * §7.3  Invitation → vérifier les informations préremplies →
 *       choisir l'objectif → générer le Plan
 * ```
 *
 * CE QUI EST UNE ÉTAPE ICI, ET CE QUI N'EN EST PAS UNE
 *
 * Le domaine ne modélise que les étapes qui laissent une trace en base. « Fiche
 * course », « cadrage / aperçu » et « création compte / offre » sont de la
 * navigation et de l'authentification : elles appartiennent au flow d'écrans,
 * pas au parcours de données. Les faire figurer ici obligerait à inventer un
 * état applicatif pour les suivre, donc une seconde source de vérité.
 *
 * Restent trois faits observables, et ce sont exactement ceux que les commandes
 * du lot écrivent déjà.
 */
export const ONBOARDING_STEPS = ['trail_profile', 'race_attachment', 'race_goal'] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * Les trois parcours de §7.
 *
 * Ils ne sont pas déclarés par l'appelant mais déduits de l'état du coureur :
 * §7.2 se reconnaît à sa condition d'entrée — « si le profil existe déjà » — et
 * §7.3 à la sienne — le coureur arrive par une invitation d'organisation.
 */
export const ONBOARDING_FLOWS = ['new_runner', 'returning_runner', 'organizer_invitation'] as const;

export type OnboardingFlow = (typeof ONBOARDING_FLOWS)[number];

/**
 * Sources d'inscription qui font entrer dans le parcours §7.3.
 *
 * `direct` est un rattachement spontané, `admin` un geste de support : ni l'un
 * ni l'autre n'est une invitation d'organisation.
 */
export const ORGANIZER_REGISTRATION_SOURCES = ['organizer_import', 'organizer_invitation'] as const;

/**
 * Étapes d'un parcours, dans l'ordre.
 *
 * §7.3 ne demande pas le Profil trailer : « Invitation → vérifier les
 * informations préremplies → choisir l'objectif → générer le Plan ». C'est
 * cohérent avec §3.2 — « son onboarding doit être plus court, car les
 * informations de course sont déjà connues » — et avec §29.2, « un onboarding
 * court et co-brandé ». Le profil reste renseignable plus tard, comme
 * l'Assistance de §15.1 ; il n'est simplement pas une porte d'entrée.
 *
 * L'ordre `profil → rattachement → objectif` suit §7.1 et §7.2, qui posent le
 * Profil trailer avant l'Objectif. Le rattachement s'insère entre les deux
 * parce que c'est le seul endroit où il peut tenir : il suppose un compte, que
 * §7.1 ne crée qu'après le profil, et l'objectif suppose une participation —
 * il vit dans `participant_race_settings`.
 */
const STEPS_BY_FLOW: Readonly<Record<OnboardingFlow, readonly OnboardingStep[]>> = {
  new_runner: ['trail_profile', 'race_attachment', 'race_goal'],
  returning_runner: ['trail_profile', 'race_attachment', 'race_goal'],
  organizer_invitation: ['race_attachment', 'race_goal'],
};

export function stepsForFlow(flow: OnboardingFlow): readonly OnboardingStep[] {
  return STEPS_BY_FLOW[flow];
}
