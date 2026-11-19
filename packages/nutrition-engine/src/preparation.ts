import type { NutritionResult } from './contracts.js';

/**
 * « À préparer pour cette course » — NUTRITION_ENGINE §49 à §53 ; décisions
 * du 2026-11-19.
 *
 * - Ce qui se consomme après un ravitaillement vient de ce ravitaillement :
 *   ce que le coureur y retrouve (drop bag, Assistance), ou ce qu'il porte
 *   depuis le départ. Le domaine dit d'où vient chaque point ; le moteur
 *   compte.
 * - La réserve (§49) s'ajoute à ce qu'on prépare, jamais à ce qu'on consomme
 *   (§51), et part avec le coureur. Elle s'arrondit au produit entier, à la
 *   dose (ou demi-dose) pour la boisson.
 * - Invariant (§53, N37) : départ + sacs + Assistance + non affecté = total.
 *
 * Un point peut être « non affecté » : le coureur avait choisi un drop bag ou
 * l'Assistance, qui n'existent plus. Ses produits restent comptés, sans place
 * (§56 : ne jamais supprimer silencieusement une affectation).
 */

export type SupplySource = 'start' | 'bag' | 'assistance';
export type PreparationDestination = SupplySource | 'unassigned';

export interface PreparationOptions {
  /** 0 à 100 (`nutrition_plans.reserve_percent`). */
  readonly reservePercent: number;
  /** D'où vient ce qui sert à partir de chaque ravitaillement ; absent : porté depuis le départ. */
  readonly sources: Readonly<Record<string, PreparationDestination>>;
}

/** Un produit à l'unité (gel, barre), ou une dose de boisson d'effort. */
export type PreparationUnit = 'serving' | 'dose';

export interface PreparationQuantity {
  readonly productId: string;
  readonly name: string;
  readonly unit: PreparationUnit;
  readonly quantity: number;
}

export interface PreparationPoint {
  readonly pointId: string;
  readonly name: string;
  readonly kind: 'start' | 'aid';
  readonly elapsedSeconds: number;
  readonly distanceKm: number;
  /** Le départ vient toujours du départ. */
  readonly source: PreparationDestination;
  /** Ce qui sert à partir d'ici, jusqu'au ravitaillement suivant : prises et doses à préparer. */
  readonly items: readonly PreparationQuantity[];
}

export interface PreparationProduct {
  readonly productId: string;
  readonly name: string;
  readonly unit: PreparationUnit;
  /** Ce que la stratégie prévoit de consommer (§52). */
  readonly planned: number;
  readonly reserve: number;
  /** À préparer : prévu + réserve. */
  readonly total: number;
  /** Sur le coureur au départ, réserve comprise. */
  readonly start: number;
  readonly bag: number;
  readonly assistance: number;
  readonly unassigned: number;
  /** Doses préparées dans les flasques avant le départ : elles ne partent pas en sachet. */
  readonly inFlasks: number;
}

export interface PreparationPlan {
  readonly reservePercent: number;
  readonly products: readonly PreparationProduct[];
  readonly points: readonly PreparationPoint[];
}

const EPSILON = 1e-6;

function ceilTo(value: number, step: number): number {
  const steps = Math.ceil(value / step - EPSILON);
  // Jamais « −0 » : une réserve nulle est nulle.
  return steps <= 0 ? 0 : steps * step;
}

interface PointDraft {
  readonly point: Omit<PreparationPoint, 'items'>;
  readonly items: Map<string, PreparationQuantity>;
}

function add(draft: PointDraft, item: PreparationQuantity): void {
  if (item.quantity <= EPSILON) return;
  const key = `${item.unit}:${item.productId}`;
  const current = draft.items.get(key);
  draft.items.set(key, { ...item, quantity: (current?.quantity ?? 0) + item.quantity });
}

export function planPreparation(
  result: NutritionResult,
  options: PreparationOptions,
): PreparationPlan {
  const reservePercent = Math.min(100, Math.max(0, options.reservePercent));
  const first = result.sections[0];
  if (first === undefined) return { reservePercent, products: [], points: [] };

  const start: PointDraft = {
    point: {
      pointId: first.fromPointId,
      name: first.fromName,
      kind: 'start',
      elapsedSeconds: first.startElapsedSeconds,
      distanceKm: first.startKm,
      source: 'start',
    },
    items: new Map(),
  };
  const drafts: PointDraft[] = [start];

  // Les prises, dans l'ordre : un ravitaillement ouvre un nouveau point, et ce
  // qui se prend au ravitaillement même vient déjà de lui.
  let current = start;
  for (const milestone of result.milestones) {
    if (milestone.kind === 'aid' && milestone.pointId !== null) {
      current = {
        point: {
          pointId: milestone.pointId,
          name: milestone.name,
          kind: 'aid',
          elapsedSeconds: milestone.elapsedSeconds,
          distanceKm: milestone.distanceKm,
          source: options.sources[milestone.pointId] ?? 'start',
        },
        items: new Map(),
      };
      drafts.push(current);
    }
    for (const item of result.allocation?.items[milestone.stableKey] ?? []) {
      add(current, {
        productId: item.productId,
        name: item.name,
        unit: 'serving',
        quantity: item.quantity,
      });
    }
  }

  // Les doses de boisson, là où une flasque se prépare. Les arrêts suivent les
  // points dans le même ordre ; un ravitaillement sauté n'en a pas.
  const flasks = result.flasks;
  const drink = flasks?.drink ?? null;
  let inFlasks = 0;
  if (flasks !== null && drink !== null) {
    let next = 0;
    for (const stop of flasks.stops) {
      while (next < drafts.length && drafts[next]?.point.pointId !== stop.pointId) next += 1;
      const draft = drafts[next];
      if (draft === undefined) break;
      const doses = stop.actions
        .filter(
          (action) => action.kind === 'prepare_drink' || action.kind === 'finish_then_prepare',
        )
        .reduce((sum, action) => sum + action.doses, 0);
      if (draft === start) inFlasks += doses;
      add(draft, { productId: drink.productId, name: drink.name, unit: 'dose', quantity: doses });
      next += 1;
    }
  }

  const points: PreparationPoint[] = drafts.map((draft) => ({
    ...draft.point,
    items: [...draft.items.values()],
  }));

  type Totals = {
    -readonly [K in keyof PreparationProduct]: PreparationProduct[K];
  };
  const totals = new Map<string, Totals>();
  for (const point of points) {
    for (const item of point.items) {
      const key = `${item.unit}:${item.productId}`;
      const row = totals.get(key) ?? {
        productId: item.productId,
        name: item.name,
        unit: item.unit,
        planned: 0,
        reserve: 0,
        total: 0,
        start: 0,
        bag: 0,
        assistance: 0,
        unassigned: 0,
        inFlasks: 0,
      };
      row.planned += item.quantity;
      row[point.source] += item.quantity;
      totals.set(key, row);
    }
  }

  const products = [...totals.values()]
    .map((row): PreparationProduct => {
      const step = row.unit === 'dose' && drink?.prepDoses === 0.5 ? 0.5 : 1;
      const reserve = ceilTo((row.planned * reservePercent) / 100, step);
      return {
        ...row,
        reserve,
        total: row.planned + reserve,
        start: row.start + reserve,
        inFlasks: row.unit === 'dose' ? inFlasks : 0,
      };
    })
    .sort(
      (left, right) =>
        Number(left.unit === 'dose') - Number(right.unit === 'dose') ||
        right.planned - left.planned ||
        left.name.localeCompare(right.name, 'fr'),
    );

  return { reservePercent, products, points };
}
