import { CAPABILITIES, type Capability } from './capabilities.js';

/**
 * Niveaux d'accès et matrice de capabilities — 04_ENTITLEMENTS §57 à §61.
 *
 * `free` n'est pas un produit : §8, « Free est implicite. Il ne nécessite pas
 * une row d'entitlement active ». Il est le socle de tous les autres, jamais
 * un achat.
 */
export const ACCESS_TIERS = ['free', 'race_pass', 'organizer_included', 'plus', 'beta'] as const;

export type AccessTier = (typeof ACCESS_TIERS)[number];

/**
 * Priorité des droits — §19.
 *
 * ```text
 * BETA_FULL_ACCESS → PLUS → ORGANIZER_INCLUDED → RACE_PASS → FREE
 * ```
 *
 * « Cette priorité est utile pour choisir l'expérience / source du droit. Elle
 * ne signifie pas qu'un entitlement "écrase" les autres en base. » Elle sert
 * donc à nommer le tier effectif et à choisir la source d'une décision — jamais
 * à retirer une capability : §20 impose l'union.
 */
const TIER_PRIORITY: Readonly<Record<AccessTier, number>> = {
  beta: 50,
  plus: 40,
  organizer_included: 30,
  race_pass: 20,
  free: 10,
};

/** Du plus large au plus étroit — l'ordre dans lequel une décision cherche sa source. */
export const TIERS_BY_PRIORITY: readonly AccessTier[] = [...ACCESS_TIERS].sort(
  (left, right) => TIER_PRIORITY[right] - TIER_PRIORITY[left],
);

export function isBroaderTier(candidate: AccessTier, current: AccessTier): boolean {
  return TIER_PRIORITY[candidate] > TIER_PRIORITY[current];
}

/**
 * Socle Free — §57.
 *
 * Les six ✓ de la matrice, plus les capabilities `.read`, que §57 « Décisions de
 * complétion » place au socle : « sans ces lectures au socle, une expiration
 * reprendrait la vue de ce que le coureur a lui-même écrit » (§53, §54).
 *
 * Ce qui reste premium est donc l'écriture et l'avancé.
 */
const FREE_CAPABILITIES: readonly Capability[] = [
  'course.read',
  'course.sources.read',
  'course.official_notices.read',
  'course.mandatory_equipment.read',
  'plan.read',
  'plan.generate_initial',
  'nutrition.read',
  'preparation.read',
  'assistance.read',
  'outing.read',
  'season.read',
  'library.read',
  'postrace.read',
];

/**
 * Race Pass, sur la participation couverte — §58.
 *
 * « course.* ✓ plan.* ✓ nutrition.* ✓ preparation.* ✓ assistance.* ✓
 * conditions.race.read ✓ postrace.* ✓ outing.create_linked ✓ quota 2
 * conditions.outing.read ✓ ».
 *
 * `outing.edit` s'y ajoute : §57 « Décisions de complétion » le fait suivre
 * `outing.create_linked`, « une sortie qu'on peut créer mais pas modifier n'est
 * pas une capacité cohérente ». Il reste borné au même scope, et ne donne rien
 * sur une sortie personnelle (§12).
 */
const RACE_PASS_CAPABILITIES: readonly Capability[] = [
  ...FREE_CAPABILITIES,
  'plan.edit',
  'plan.recalculate',
  'nutrition.edit',
  'preparation.edit_advanced',
  'assistance.edit',
  'assistance.share',
  'conditions.race.read',
  'conditions.outing.read',
  'outing.create_linked',
  'outing.edit',
  'postrace.edit_advanced',
];

/**
 * Organizer Included — §60.
 *
 * Même liste que Race Pass sur la participation couverte. §12 en nomme les
 * exclusions : « il ne donne pas : sorties personnelles illimitées ; premium
 * sur les autres courses ; toute la mémoire PLUKA+ ».
 */
const ORGANIZER_INCLUDED_CAPABILITIES = RACE_PASS_CAPABILITIES;

/** PLUKA+ — §59 : tout, sur tous les scopes compatibles. */
const PLUS_CAPABILITIES: readonly Capability[] = [
  ...RACE_PASS_CAPABILITIES,
  'outing.create_personal',
  'library.edit',
  'strategy.reuse',
  'season.memory',
];

/**
 * Beta Full Access — §61.
 *
 * « Si global : équivalent fonctionnel temporaire à PLUKA+. Si scoped à une
 * Race : équivalent temporaire à Race Pass / Organizer Included selon config. »
 * Les deux portées ont donc deux jeux distincts, et c'est le scope du grant qui
 * choisit — pas un booléen « beta » unique.
 */
const CAPABILITIES_BY_TIER: Readonly<Record<AccessTier, ReadonlySet<Capability>>> = {
  free: new Set(FREE_CAPABILITIES),
  race_pass: new Set(RACE_PASS_CAPABILITIES),
  organizer_included: new Set(ORGANIZER_INCLUDED_CAPABILITIES),
  plus: new Set(PLUS_CAPABILITIES),
  beta: new Set(PLUS_CAPABILITIES),
};

/** Beta limité à une course : équivalent Race Pass, pas PLUKA+ (§61). */
const RACE_SCOPED_BETA_CAPABILITIES: ReadonlySet<Capability> = new Set(RACE_PASS_CAPABILITIES);

export function capabilitiesForTier(tier: AccessTier): ReadonlySet<Capability> {
  return CAPABILITIES_BY_TIER[tier];
}

export function capabilitiesForRaceScopedBeta(): ReadonlySet<Capability> {
  return RACE_SCOPED_BETA_CAPABILITIES;
}

/**
 * Garde de complétude, vérifiée à la compilation et à l'exécution.
 *
 * PLUKA+ possède tout §56 : c'est le tier le plus large, et §59 le dit sans
 * réserve. Une capability ajoutée à §56 sans être placée dans la matrice
 * tomberait ici plutôt que d'être silencieusement refusée à tout le monde.
 */
export function capabilitiesMissingFromPlus(): readonly Capability[] {
  return CAPABILITIES.filter((capability) => !CAPABILITIES_BY_TIER.plus.has(capability));
}
