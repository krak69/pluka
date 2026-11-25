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

/** Un produit fixé par le coureur à une prise, avec sa quantité. */
export interface CustomItem extends NutritionProduct {
  readonly quantity: number;
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
  /** Les jalons dont le coureur a fixé lui-même les produits. */
  readonly customized: readonly string[];
}

export const SOLID_CATEGORIES: ReadonlySet<string> = new Set([
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
  /** Le volume de boisson d'effort entre deux instants ; absent, `drinkMlPerHour` constant. */
  readonly drinkMlBetween?: (from: number, to: number) => number;
  readonly caffeineTotalMg: number | null;
  /**
   * La part du total de caféine due au temps `t` (§24) ; absente, au prorata
   * du temps ; nulle, placement manuel : aucune caféine placée par PLUKA.
   */
  readonly caffeineShareUntil?: ((t: number) => number) | null;
  readonly finishElapsedSeconds: number;
  readonly customItems?: Readonly<Record<string, readonly CustomItem[]>>;
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

  // Ce que la boisson apporte entre deux instants : sa concentration × le
  // volume bu, qui suit l'hydratation d'une plage chaude ou froide (§18).
  const drinkMl =
    input.drinkMlBetween ??
    ((from: number, to: number) => (input.drinkMlPerHour * Math.max(0, to - from)) / 3600);
  const drinkBetween = (from: number, to: number) => {
    if (drink === null || to <= from) return { carbs: 0, sodium: 0, caffeine: 0 };
    const volume = drinkMl(from, to);
    return {
      carbs: volume * (drink.carbsG / drink.hydrationMl),
      sodium: volume * (drink.sodiumMg / drink.hydrationMl),
      caffeine: volume * (drink.caffeineMg / drink.hydrationMl),
    };
  };
  const shareUntil =
    input.caffeineShareUntil === undefined
      ? (t: number) =>
          input.finishElapsedSeconds <= 0 ? 1 : Math.min(1, t / input.finishElapsedSeconds)
      : input.caffeineShareUntil;

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
    caffeinePlanned += drinkBetween(previousTime, milestone.elapsedSeconds).caffeine;
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

    // Une prise couvre jusqu'à mi-chemin du jalon suivant : la suivante prend
    // le relais. Viser le jalon suivant entier chargeait la première prise de
    // deux portions (deux gels au km 5, retour du 2026-11-19).
    const here = cumulative[index] ?? { carbs: 0, sodium: 0 };
    const after = cumulative[index + 1] ?? here;
    const followingTime = input.milestones[index + 1]?.elapsedSeconds ?? input.finishElapsedSeconds;
    const nextTime = (milestone.elapsedSeconds + followingTime) / 2;
    const until = {
      carbs: (here.carbs + after.carbs) / 2,
      sodium: (here.sodium + after.sodium) / 2,
    };

    // §24, §25 : la caféine suit sa répartition (le temps, la mi-course ou la
    // nuit), jamais au-delà du total ; en placement manuel, PLUKA n'en place pas.
    const caffeineBudget =
      input.caffeineTotalMg === null || shareUntil === null
        ? 0
        : input.caffeineTotalMg * shareUntil(milestone.elapsedSeconds) - caffeinePlanned;
    // Ce qu'il reste à couvrir jusqu'au prochain jalon, boisson déduite.
    const carbsNeed =
      until.carbs - base.carbs - drinkBetween(base.seconds, nextTime).carbs - carbsPlaced;

    // §58 : une prise personnalisée garde les produits du coureur, sans
    // complément ; ce qu'elle apporte compte pour les prises suivantes.
    const custom = input.customItems?.[milestone.stableKey];
    let chosen: NutritionProduct[] = [];
    if (custom !== undefined) {
      chosen = custom.flatMap((item) =>
        Array.from({ length: Math.max(0, Math.round(item.quantity)) }, () => item),
      );
    } else if (carbsNeed >= MIN_CARBS_FOR_ITEM && candidates.length > 0) {
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
      drinkBetween(base.seconds, nextTime).sodium -
      sodiumPlaced -
      sodiumFromSolids;
    const salt = salts[0];
    if (custom === undefined && salt !== undefined && sodiumNeed >= salt.sodiumMg * 0.6) {
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
    const fromDrink = drinkBetween(section.startElapsedSeconds, section.endElapsedSeconds);
    const carbs = placed.reduce((sum, item) => sum + item.carbsG, 0) + fromDrink.carbs;
    const sodium = placed.reduce((sum, item) => sum + item.sodiumMg, 0) + fromDrink.sodium;
    return {
      carbs: ratio(carbs, section.needs.carbsG),
      sodium: ratio(sodium, section.needs.sodiumMg),
    };
  });

  const all = Object.values(items).flat();
  const fromDrink = drinkBetween(0, input.finishElapsedSeconds);
  const planned = {
    carbsG: all.reduce((sum, item) => sum + item.carbsG, 0) + fromDrink.carbs,
    sodiumMg: all.reduce((sum, item) => sum + item.sodiumMg, 0) + fromDrink.sodium,
    caffeineMg: all.reduce((sum, item) => sum + item.caffeineMg, 0) + fromDrink.caffeine,
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
    customized: input.milestones
      .filter((milestone) => milestone.kind !== 'finish')
      .map((milestone) => milestone.stableKey)
      .filter((key) => input.customItems?.[key] !== undefined),
  };
}
