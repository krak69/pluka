/**
 * Capabilities — 04_ENTITLEMENTS §17, §56.
 *
 * « Définir une enum centrale […] les noms finaux peuvent évoluer, mais
 * doivent rester centralisés. » Cette liste est la reprise littérale du
 * « capability set recommandé » de §56, y compris sa séparation lecture /
 * écriture, que §55 réclame explicitement : « définir les capabilities
 * suffisamment fines dès le départ », parce que « les opérations après
 * expiration nécessiteront probablement cette distinction » (§54).
 *
 * Rien de ce qui relève du B2B n'y figure. §62 : « les droits du BO
 * organisateur ne doivent pas utiliser les tiers B2C », et E27 le teste — un
 * entitlement B2C n'active pas Race Intelligence.
 */
export const CAPABILITIES = [
  // Course
  'course.read',
  'course.sources.read',
  'course.official_notices.read',
  'course.mandatory_equipment.read',

  // Plan
  'plan.read',
  'plan.generate_initial',
  'plan.edit',
  'plan.recalculate',

  // Nutrition
  'nutrition.read',
  'nutrition.edit',

  // Préparation
  'preparation.read',
  'preparation.edit_advanced',

  // Assistance
  'assistance.read',
  'assistance.edit',
  'assistance.share',

  // Conditions
  'conditions.race.read',
  'conditions.outing.read',

  // Sorties
  'outing.read',
  'outing.create_linked',
  'outing.create_personal',
  'outing.edit',

  // Saison et bibliothèque
  'season.read',
  'season.memory',
  'library.read',
  'library.edit',
  'strategy.reuse',

  // Après-course
  'postrace.read',
  'postrace.edit_advanced',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * Capabilities qui n'ont de sens que sur une participation précise.
 *
 * §9 : un Race Pass « ne donne pas accès aux autres races ». Une capability de
 * ce groupe demandée sans scope est une erreur d'appel, pas un refus de droit —
 * le resolver le dit avec `wrong_scope` plutôt que d'inventer une réponse.
 *
 * Les autres — bibliothèque, saison, stratégies, sorties personnelles — sont
 * des capacités d'utilisateur : elles se jugent globalement (§11, §59).
 */
const PARTICIPANT_RACE_SCOPED: readonly Capability[] = [
  'plan.read',
  'plan.generate_initial',
  'plan.edit',
  'plan.recalculate',
  'nutrition.read',
  'nutrition.edit',
  'preparation.read',
  'preparation.edit_advanced',
  'assistance.read',
  'assistance.edit',
  'assistance.share',
  'conditions.race.read',
  'conditions.outing.read',
  'outing.create_linked',
  'postrace.read',
  'postrace.edit_advanced',
];

export function requiresParticipantRaceScope(capability: Capability): boolean {
  return PARTICIPANT_RACE_SCOPED.includes(capability);
}
