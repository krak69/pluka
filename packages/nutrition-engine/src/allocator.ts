import type { NutritionMilestone, NutritionSection } from './contracts.js';

/**
 * Allocateur produit V1 — NUTRITION_ENGINE §26 à §31, §39 à §46.
 *
 * Pas un optimiseur nutritionnel (§40) : il cherche une combinaison discrète
 * de produits **choisis par le coureur** (§27) qui couvre raisonnablement ses
 * cibles, et dit honnêtement ce qui manque. Il n'ajoute jamais un produit que
 * le coureur n'a pas choisi, et ne touche jamais aux cibles (§46).
 *
 * - La boisson d'effort (la première boisson choisie) couvre, en continu, sa
 *   part de l'hydratation : ses glucides et son sodium comptent (§28, §29).
 * - À chaque prise et chaque ravitaillement, 1 à 3 portions de produits
 *   solides visent le besoin en glucides restant depuis le point précédent.
 * - Le sodium encore manquant est complété par capsules ou électrolytes.
 * - La caféine n'entre que si le coureur s'en est fixé un total, étalée au
 *   prorata du temps ; sinon aucun produit caféiné n'est placé (§24, §25).
 */

export interface NutritionProduct {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  /** Par portion. */
  readonly carbsG: number;
  readonly sodiumMg: number;
  readonly caffeineMg: number;
  readonly hydrationMl: number;
}

export interface AllocatedItem {
  readonly productId: string;
  readonly name: string;
  readonly quantity: number;
  readonly carbsG: number;
  readonly sodiumMg: number;
  readonly caffeineMg: number;
}

export interface Coverage {
  readonly carbs: number | null;
  readonly sodium: number | null;
}

export type AllocationWarning =
  'no_products' | 'no_drink' | 'drink_without_volume' | 'no_caffeine_product';

export interface Allocation {
  /** Par `stableKey` de jalon. */
  readonly items: Readonly<Record<string, readonly AllocatedItem[]>>;
  readonly drink: NutritionProduct | null;
  /** Par section, dans l'ordre des sections. */
  readonly sectionCoverage: readonly Coverage[];
  readonly totalCoverage: Coverage;
  readonly planned: {
    readonly carbsG: number;
    readonly sodiumMg: number;
    readonly caffeineMg: number;
  };
  readonly warnings: readonly AllocationWarning[];
}

const SOLID_CATEGORIES = new Set([
  'gel',
  'bar',
  'chew',
  'puree',
  'solid',
  'salty',
  'other',
  'generic_aid',
]);
const SODIUM_CATEGORIES = new Set(['capsule', 'electrolyte']);
/** En dessous, pas de prise de produit : le besoin est trop faible pour une portion. */
const MIN_CARBS_FOR_ITEM = 8;
const MAX_SERVINGS = 3;

function ratio(planned: number, need: number): number | null {
  return need <= 0 ? null : planned / need;
}

/** Les combinaisons de 1 à 3 portions parmi les produits (avec répétition). */
function combinations(products: readonly NutritionProduct[]): NutritionProduct[][] {
  const result: NutritionProduct[][] = [];
  const walk = (start: number, current: NutritionProduct[]) => {
    if (current.length > 0) result.push([...current]);
    if (current.length === MAX_SERVINGS) return;
    for (let index = start; index < products.length; index += 1) {
      current.push(products[index] as NutritionProduct);
      walk(index, current);
      current.pop();
    }
  };
  walk(0, []);
  return result;
}

function group(chosen: readonly NutritionProduct[]): AllocatedItem[] {
  const byId = new Map<string, AllocatedItem>();
  for (const product of chosen) {
    const existing = byId.get(product.id);
    byId.set(product.id, {
      productId: product.id,
      name: product.name,
      quantity: (existing?.quantity ?? 0) + 1,
      carbsG: (existing?.carbsG ?? 0) + product.carbsG,
      sodiumMg: (existing?.sodiumMg ?? 0) + product.sodiumMg,
      caffeineMg: (existing?.caffeineMg ?? 0) + product.caffeineMg,
    });
  }
  return [...byId.values()];
}

export function allocateProducts(input: {
  readonly products: readonly NutritionProduct[];
  readonly milestones: readonly NutritionMilestone[];
  readonly sections: readonly NutritionSection[];
  readonly drinkMlPerHour: number;
  readonly caffeineTotalMg: number | null;
  readonly finishElapsedSeconds: number;
}): Allocation {
  const drink =
    input.products.find((product) => product.category === 'drink' && product.hydrationMl > 0) ??
    null;
  const solids = input.products.filter(
    (product) => SOLID_CATEGORIES.has(product.category) && product.carbsG > 0,
  );
  const salts = input.products.filter(
    (product) => SODIUM_CATEGORIES.has(product.category) && product.sodiumMg > 0,
  );
  const warnings: AllocationWarning[] = [];
  if (input.products.length === 0) warnings.push('no_products');
  if (drink === null && input.drinkMlPerHour > 0) {
    // Une boisson en poudre sans volume de dilution ne dit pas sa concentration.
    warnings.push(
      input.products.some((product) => product.category === 'drink')
        ? 'drink_without_volume'
        : 'no_drink',
    );
  }
  if (
    (input.caffeineTotalMg ?? 0) > 0 &&
    !input.products.some((product) => product.caffeineMg > 0)
  ) {
    warnings.push('no_caffeine_product');
  }

  // Ce que la boisson apporte par seconde de course.
  const drinkPerSecond =
    drink === null
      ? { carbs: 0, sodium: 0, caffeine: 0 }
      : {
          carbs: (input.drinkMlPerHour * (drink.carbsG / drink.hydrationMl)) / 3600,
          sodium: (input.drinkMlPerHour * (drink.sodiumMg / drink.hydrationMl)) / 3600,
          caffeine: (input.drinkMlPerHour * (drink.caffeineMg / drink.hydrationMl)) / 3600,
        };

  const candidates = combinations(solids);
  const items: Record<string, AllocatedItem[]> = {};
  let caffeinePlanned = 0;
  // Ce qui a été placé depuis le départ (produits seuls ; la boisson se compte à part).
  let carbsPlaced = 0;
  let sodiumPlaced = 0;
  // Chaque section, d'un ravito au suivant, s'équilibre pour elle-même : un
  // surplus avant un ravito ne dispense pas de manger après (statut par section).
  let base = { carbs: 0, sodium: 0, seconds: 0 };
  // Besoin cumulé jusqu'à chaque jalon : chaque prise couvre jusqu'à la suivante.
  const cumulative: { carbs: number; sodium: number }[] = [];
  input.milestones.reduce(
    (sum, milestone) => {
      const next = {
        carbs: sum.carbs + milestone.needSincePrevious.carbsG,
        sodium: sum.sodium + milestone.needSincePrevious.sodiumMg,
      };
      cumulative.push(next);
      return next;
    },
    { carbs: 0, sodium: 0 },
  );

  input.milestones.forEach((milestone, index) => {
    const previousTime = index === 0 ? 0 : (input.milestones[index - 1]?.elapsedSeconds ?? 0);
    caffeinePlanned += drinkPerSecond.caffeine * (milestone.elapsedSeconds - previousTime);
    if (milestone.kind === 'finish') return;
    if (milestone.kind === 'aid') {
      base = {
        carbs: cumulative[index]?.carbs ?? 0,
        sodium: cumulative[index]?.sodium ?? 0,
        seconds: milestone.elapsedSeconds,
      };
      carbsPlaced = 0;
      sodiumPlaced = 0;
    }

    const nextTime = input.milestones[index + 1]?.elapsedSeconds ?? input.finishElapsedSeconds;
    const until = cumulative[index + 1] ?? cumulative[index] ?? { carbs: 0, sodium: 0 };

    // §25 : la caféine suit le prorata du temps écoulé, jamais au-delà du total.
    const caffeineBudget =
      input.caffeineTotalMg === null || input.finishElapsedSeconds <= 0
        ? 0
        : (input.caffeineTotalMg * milestone.elapsedSeconds) / input.finishElapsedSeconds -
          caffeinePlanned;
    // Ce qu'il reste à couvrir jusqu'au prochain jalon, boisson déduite.
    const carbsNeed =
      until.carbs - base.carbs - drinkPerSecond.carbs * (nextTime - base.seconds) - carbsPlaced;

    let chosen: NutritionProduct[] = [];
    if (carbsNeed >= MIN_CARBS_FOR_ITEM && candidates.length > 0) {
      let bestCost = Number.POSITIVE_INFINITY;
      for (const combination of candidates) {
        const caffeine = combination.reduce((sum, product) => sum + product.caffeineMg, 0);
        if (caffeine > 0 && caffeine > caffeineBudget + 1e-9) continue;
        const carbs = combination.reduce((sum, product) => sum + product.carbsG, 0);
        // L'écart au besoin d'abord ; à écart proche, moins de portions.
        const cost = Math.abs(carbsNeed - carbs) + combination.length - (caffeine > 0 ? 0.5 : 0);
        if (cost < bestCost - 1e-9) {
          bestCost = cost;
          chosen = combination;
        }
      }
    }

    const sodiumFromSolids = chosen.reduce((sum, product) => sum + product.sodiumMg, 0);
    const sodiumNeed =
      until.sodium -
      base.sodium -
      drinkPerSecond.sodium * (nextTime - base.seconds) -
      sodiumPlaced -
      sodiumFromSolids;
    const salt = salts[0];
    if (salt !== undefined && sodiumNeed >= salt.sodiumMg * 0.6) {
      const count = Math.min(2, Math.max(1, Math.round(sodiumNeed / salt.sodiumMg)));
      for (let repeat = 0; repeat < count; repeat += 1) chosen.push(salt);
    }

    carbsPlaced += chosen.reduce((sum, product) => sum + product.carbsG, 0);
    sodiumPlaced += chosen.reduce((sum, product) => sum + product.sodiumMg, 0);
    caffeinePlanned += chosen.reduce((sum, product) => sum + product.caffeineMg, 0);
    if (chosen.length > 0) items[milestone.stableKey] = group(chosen);
  });

  // Ce qui se prend à un jalon sert à la suite : un ravito nourrit la section qui en repart.
  const itemsBetween = (from: number, to: number) =>
    input.milestones
      .filter((milestone) => milestone.elapsedSeconds >= from && milestone.elapsedSeconds < to)
      .flatMap((milestone) => items[milestone.stableKey] ?? []);

  const sectionCoverage = input.sections.map((section) => {
    const placed = itemsBetween(section.startElapsedSeconds, section.endElapsedSeconds);
    const seconds = section.endElapsedSeconds - section.startElapsedSeconds;
    const carbs =
      placed.reduce((sum, item) => sum + item.carbsG, 0) + drinkPerSecond.carbs * seconds;
    const sodium =
      placed.reduce((sum, item) => sum + item.sodiumMg, 0) + drinkPerSecond.sodium * seconds;
    return {
      carbs: ratio(carbs, section.needs.carbsG),
      sodium: ratio(sodium, section.needs.sodiumMg),
    };
  });

  const all = Object.values(items).flat();
  const total = input.finishElapsedSeconds;
  const planned = {
    carbsG: all.reduce((sum, item) => sum + item.carbsG, 0) + drinkPerSecond.carbs * total,
    sodiumMg: all.reduce((sum, item) => sum + item.sodiumMg, 0) + drinkPerSecond.sodium * total,
    caffeineMg:
      all.reduce((sum, item) => sum + item.caffeineMg, 0) + drinkPerSecond.caffeine * total,
  };
  const need = input.sections.reduce(
    (sum, section) => ({
      carbs: sum.carbs + section.needs.carbsG,
      sodium: sum.sodium + section.needs.sodiumMg,
    }),
    { carbs: 0, sodium: 0 },
  );

  return {
    items,
    drink,
    sectionCoverage,
    totalCoverage: {
      carbs: ratio(planned.carbsG, need.carbs),
      sodium: ratio(planned.sodiumMg, need.sodium),
    },
    planned,
    warnings,
  };
}
