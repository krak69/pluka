import type { NutritionInput, NutritionTimelinePoint } from './contracts.js';

/**
 * Gestion des flasques — NUTRITION_ENGINE §33, §34 (consommer / remplir /
 * emporter) ; décisions du 2026-11-19.
 *
 * Le coureur dit ce qu'il porte (flasques, poche à eau). Le moteur suit, d'un
 * point de remplissage au suivant, ce qu'il reste dans chaque contenant et dit
 * quoi faire à chaque point :
 * - la boisson d'effort se prépare toujours en flasque pleine, en doses
 *   entières (« 500 ml + 1 dose ») — on ne prépare pas « 350 ml et ¾ de dose » ;
 * - une flasque de boisson qui suffit jusqu'au point suivant ne se touche pas :
 *   250 ml sur une section, 250 ml sur la suivante, une seule préparation ;
 * - l'eau se complète au juste besoin de la section, flasques d'abord ;
 * - quand la capacité manque, il le dit et propose de boire avant de repartir.
 * Les cibles ne changent jamais (§46) : le moteur ne fait que la logistique.
 */

export interface NutritionContainers {
  readonly flaskCount: number;
  readonly flaskCapacityMl: number;
  /** Poche à eau ; nulle si le coureur n'en porte pas. */
  readonly bladderMl: number | null;
}

export interface FlaskContainer {
  readonly id: string;
  readonly kind: 'flask' | 'bladder';
  /** 1, 2… pour les flasques ; 0 pour la poche. */
  readonly index: number;
  readonly capacityMl: number;
  readonly role: 'water' | 'drink';
}

export type FlaskActionKind =
  /** Compléter en eau jusqu'à `levelMl`. */
  | 'fill_water'
  /** Préparer la boisson : `levelMl` d'eau et `doses` doses. */
  | 'prepare_drink'
  /** Boire ici les `remainingMl` qui restent, puis préparer la boisson. */
  | 'finish_then_prepare'
  /** Ne rien faire : il reste `remainingMl`, assez jusqu'au point suivant. */
  | 'keep'
  /** Pas besoin de ce contenant jusqu'au point suivant. */
  | 'unused';

export interface FlaskAction {
  readonly containerId: string;
  readonly kind: FlaskActionKind;
  /** Ce qu'il reste dans le contenant en arrivant au point. */
  readonly remainingMl: number;
  /** Le niveau en repartant. */
  readonly levelMl: number;
  readonly doses: number;
}

export interface FlaskStop {
  readonly pointId: string;
  readonly name: string;
  readonly kind: 'start' | 'refill';
  readonly elapsedSeconds: number;
  readonly distanceKm: number;
  /** Le point de remplissage suivant, ou l'arrivée. */
  readonly untilName: string;
  /** À boire jusqu'au point suivant, depuis le départ de ce point. */
  readonly waterNeedMl: number;
  readonly drinkNeedMl: number;
  readonly actions: readonly FlaskAction[];
  /** À boire ici avant de repartir : la fin d'une flasque, ou faute de place. */
  readonly drinkHereMl: number;
  /** Ce qui manque malgré tout jusqu'au point suivant : la capacité ne suffit pas. */
  readonly shortfallMl: number;
  /** Boisson qui manque d'un rien, compensée à l'eau plutôt que de refaire une flasque. */
  readonly drinkTopUpWithWaterMl: number;
}

export type FlaskWarning =
  'no_containers' | 'drink_counted_as_water' | 'drink_flask_too_small' | 'capacity_short';

export interface FlaskPlan {
  readonly containers: readonly FlaskContainer[];
  readonly drink: {
    readonly productId: string;
    readonly name: string;
    /** Une dose se dilue dans ce volume (« Mes produits »). */
    readonly doseVolumeMl: number;
    /** Une préparation : une flasque pleine, en doses entières. */
    readonly prepVolumeMl: number;
    readonly prepDoses: number;
  } | null;
  readonly stops: readonly FlaskStop[];
  /** Les ravitaillements où le coureur a dit ne pas remplir. */
  readonly skippedPointIds: readonly string[];
  /** Doses préparées au départ, et doses à emporter en sachet pour les points suivants. */
  readonly dosesAtStart: number;
  readonly dosesToCarry: number;
  readonly warnings: readonly FlaskWarning[];
}

const EPSILON = 1e-6;
/** Au-delà, boire d'un coup avant de repartir n'est plus raisonnable. */
const DRINK_HERE_MAX_ML = 300;
/** Une boisson qui manque d'aussi peu se compense à l'eau. */
const DRINK_TOLERANCE_ML = 100;
const DRINK_TOLERANCE_RATIO = 0.2;
const WATER_STEP_ML = 50;

function ceilTo(value: number, step: number): number {
  return Math.ceil(value / step - EPSILON) * step;
}

function departure(point: NutritionTimelinePoint): number {
  return point.elapsedSeconds + point.stopSeconds;
}

export function planFlasks(
  input: NutritionInput,
  containers: NutritionContainers,
  noRefillPointIds: readonly string[] = [],
): FlaskPlan {
  const warnings = new Set<FlaskWarning>();
  const points = input.timeline.points;
  const skipped = new Set(noRefillPointIds);
  const finish = points[points.length - 1];
  const refills = points.filter(
    (point) => point.kind === 'start' || (point.kind === 'aid' && !skipped.has(point.id)),
  );

  // La boisson d'effort, comme l'allocateur : la première boisson choisie qui a un volume.
  const drinkProduct =
    input.products?.find((product) => product.category === 'drink' && product.hydrationMl > 0) ??
    null;
  const flaskCount = Math.max(0, Math.round(containers.flaskCount));
  const capacity = Math.max(0, containers.flaskCapacityMl);

  let drink: FlaskPlan['drink'] = null;
  if (drinkProduct !== null && input.targets.waterShare < 1 && flaskCount > 0) {
    const dose = drinkProduct.hydrationMl;
    const whole = Math.floor(capacity / dose + EPSILON);
    if (whole >= 1) {
      drink = {
        productId: drinkProduct.id,
        name: drinkProduct.name,
        doseVolumeMl: dose,
        prepVolumeMl: whole * dose,
        prepDoses: whole,
      };
    } else if (capacity + EPSILON >= dose / 2) {
      drink = {
        productId: drinkProduct.id,
        name: drinkProduct.name,
        doseVolumeMl: dose,
        prepVolumeMl: dose / 2,
        prepDoses: 0.5,
      };
    } else {
      warnings.add('drink_flask_too_small');
    }
  }
  if (input.targets.waterShare < 1 && drink === null) warnings.add('drink_counted_as_water');

  // Le besoin de chaque tronçon, d'un point de remplissage au suivant.
  const legs = refills.map((stop, index) => {
    const next = refills[index + 1] ?? finish;
    const from = departure(stop);
    const to = next?.elapsedSeconds ?? from;
    const hydration = (input.targets.hydrationMlPerHour * Math.max(0, to - from)) / 3600;
    const drinkMl = drink === null ? 0 : hydration * (1 - input.targets.waterShare);
    return { stop, untilName: next?.name ?? '', water: hydration - drinkMl, drink: drinkMl };
  });

  // Combien de flasques pour la boisson : assez pour le plus long tronçon,
  // sans prendre la seule flasque d'eau quand il n'y a pas de poche.
  const maxDrink = Math.max(0, ...legs.map((leg) => leg.drink));
  let drinkFlasks = 0;
  if (drink !== null && maxDrink > EPSILON) {
    drinkFlasks = Math.min(
      flaskCount,
      Math.max(1, Math.ceil(maxDrink / drink.prepVolumeMl - EPSILON)),
    );
    const waterLeft = flaskCount - drinkFlasks;
    if (waterLeft === 0 && containers.bladderMl === null && flaskCount > 1) drinkFlasks -= 1;
  }

  const list: FlaskContainer[] = [];
  for (let index = 1; index <= flaskCount; index += 1) {
    list.push({
      id: `flask:${String(index)}`,
      kind: 'flask',
      index,
      capacityMl: capacity,
      // La boisson dans les dernières flasques : « Flasque 1 eau, Flasque 2 boisson ».
      role: index > flaskCount - drinkFlasks ? 'drink' : 'water',
    });
  }
  if (containers.bladderMl !== null && containers.bladderMl > 0) {
    list.push({
      id: 'bladder',
      kind: 'bladder',
      index: 0,
      capacityMl: containers.bladderMl,
      role: 'water',
    });
  }
  if (list.length === 0) warnings.add('no_containers');

  const level = new Map(list.map((container) => [container.id, 0]));
  const drinkers = list.filter((container) => container.role === 'drink');
  const waters = list.filter((container) => container.role === 'water');
  const waterCapacity = waters.reduce((sum, container) => sum + container.capacityMl, 0);

  let dosesAtStart = 0;
  let dosesToCarry = 0;

  const stops: FlaskStop[] = legs.map((leg, legIndex) => {
    const actions = new Map<string, FlaskAction>();
    let drinkHere = 0;
    let shortfall = 0;
    let topUpWithWater = 0;
    let waterNeed = leg.water;
    let drinkNeed = leg.drink;
    const fresh = new Set<string>();

    // — Boisson d'effort —
    if (drink !== null && drinkers.length > 0 && drinkNeed > EPSILON) {
      const avail = () => drinkers.reduce((sum, flask) => sum + (level.get(flask.id) ?? 0), 0);
      const deficit = drinkNeed - avail();
      if (deficit > EPSILON) {
        if (
          avail() > EPSILON &&
          deficit <= DRINK_TOLERANCE_ML &&
          deficit <= drinkNeed * DRINK_TOLERANCE_RATIO
        ) {
          // Il manque d'un rien : on garde la flasque et on boit un peu plus d'eau.
          topUpWithWater = deficit;
          waterNeed += deficit;
          drinkNeed -= deficit;
        } else {
          for (const flask of drinkers) {
            if (avail() + EPSILON >= drinkNeed) break;
            if ((level.get(flask.id) ?? 0) > EPSILON) continue;
            actions.set(flask.id, {
              containerId: flask.id,
              kind: 'prepare_drink',
              remainingMl: 0,
              levelMl: drink.prepVolumeMl,
              doses: drink.prepDoses,
            });
            level.set(flask.id, drink.prepVolumeMl);
            fresh.add(flask.id);
          }
          // Plus de flasque vide : finir ici la moins pleine, puis la refaire.
          const partial = drinkers
            .filter((flask) => !fresh.has(flask.id))
            .sort((left, right) => (level.get(left.id) ?? 0) - (level.get(right.id) ?? 0));
          for (const flask of partial) {
            if (avail() + EPSILON >= drinkNeed) break;
            const remaining = level.get(flask.id) ?? 0;
            drinkHere += remaining;
            drinkNeed = Math.max(0, drinkNeed - remaining);
            actions.set(flask.id, {
              containerId: flask.id,
              kind: 'finish_then_prepare',
              remainingMl: remaining,
              levelMl: drink.prepVolumeMl,
              doses: drink.prepDoses,
            });
            level.set(flask.id, drink.prepVolumeMl);
            fresh.add(flask.id);
          }
          const missing = drinkNeed - avail();
          if (missing > EPSILON) {
            // Plus de place pour la boisson : le reste se boit en eau.
            topUpWithWater += missing;
            waterNeed += missing;
            drinkNeed -= missing;
            warnings.add('capacity_short');
          }
        }
      }
      for (const flask of drinkers) {
        if (actions.has(flask.id)) continue;
        const remaining = level.get(flask.id) ?? 0;
        actions.set(flask.id, {
          containerId: flask.id,
          kind: remaining > EPSILON ? 'keep' : 'unused',
          remainingMl: remaining,
          levelMl: remaining,
          doses: 0,
        });
      }
      for (const action of actions.values()) {
        if (action.doses === 0) continue;
        if (legIndex === 0) dosesAtStart += action.doses;
        else dosesToCarry += action.doses;
      }
      // On boit d'abord l'ancienne préparation, puis la nouvelle.
      let toDrink = drinkNeed;
      const order = [...drinkers].sort((left, right) => {
        const freshness = Number(fresh.has(left.id)) - Number(fresh.has(right.id));
        return freshness !== 0 ? freshness : (level.get(left.id) ?? 0) - (level.get(right.id) ?? 0);
      });
      for (const flask of order) {
        const remaining = level.get(flask.id) ?? 0;
        const taken = Math.min(remaining, toDrink);
        level.set(flask.id, remaining - taken);
        toDrink -= taken;
      }
    } else {
      for (const flask of drinkers) {
        const remaining = level.get(flask.id) ?? 0;
        actions.set(flask.id, {
          containerId: flask.id,
          kind: remaining > EPSILON ? 'keep' : 'unused',
          remainingMl: remaining,
          levelMl: remaining,
          doses: 0,
        });
      }
    }

    // — Eau —
    let carried = waterNeed;
    if (waterNeed > waterCapacity + EPSILON) {
      const excess = waterNeed - waterCapacity;
      const here = Math.min(excess, DRINK_HERE_MAX_ML);
      drinkHere += here;
      shortfall += excess - here;
      carried = waterCapacity;
      warnings.add('capacity_short');
    }
    let target = Math.min(ceilTo(carried, WATER_STEP_ML), waterCapacity);
    const before = waters.reduce((sum, container) => sum + (level.get(container.id) ?? 0), 0);
    const enough = before + EPSILON >= carried;
    for (const container of waters) {
      const remaining = level.get(container.id) ?? 0;
      if (enough || target <= EPSILON) {
        actions.set(container.id, {
          containerId: container.id,
          kind: remaining > EPSILON ? 'keep' : 'unused',
          remainingMl: remaining,
          levelMl: remaining,
          doses: 0,
        });
        target -= remaining;
        continue;
      }
      const wanted = Math.min(container.capacityMl, ceilTo(Math.max(0, target), WATER_STEP_ML));
      const next = Math.max(remaining, wanted);
      actions.set(container.id, {
        containerId: container.id,
        kind: next > remaining + EPSILON ? 'fill_water' : remaining > EPSILON ? 'keep' : 'unused',
        remainingMl: remaining,
        levelMl: next,
        doses: 0,
      });
      level.set(container.id, next);
      target -= next;
    }
    let toDrink = carried;
    for (const container of waters) {
      const remaining = level.get(container.id) ?? 0;
      const taken = Math.min(remaining, toDrink);
      level.set(container.id, remaining - taken);
      toDrink -= taken;
    }

    return {
      pointId: leg.stop.id,
      name: leg.stop.name,
      kind: legIndex === 0 ? 'start' : 'refill',
      elapsedSeconds: leg.stop.elapsedSeconds,
      distanceKm: leg.stop.distanceKm,
      untilName: leg.untilName,
      waterNeedMl: leg.water,
      drinkNeedMl: leg.drink,
      actions: list.map((container) => actions.get(container.id) as FlaskAction),
      drinkHereMl: drinkHere,
      shortfallMl: shortfall,
      drinkTopUpWithWaterMl: topUpWithWater,
    };
  });

  return {
    containers: list,
    drink,
    stops,
    skippedPointIds: points
      .filter((point) => point.kind === 'aid' && skipped.has(point.id))
      .map((point) => point.id),
    dosesAtStart,
    dosesToCarry,
    warnings: [...warnings],
  };
}
