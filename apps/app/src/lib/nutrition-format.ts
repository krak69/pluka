import type {
  FlaskAction,
  FlaskContainer,
  FlaskPlan,
  MilestoneReason,
  NutritionMilestone,
  NutritionResult,
  NutritionSection,
} from '@pluka/domain';

import { formatClock } from '@/lib/plan-format';

/**
 * Mise en forme de la stratégie Nutrition, côté serveur. Le navigateur reçoit
 * des libellés prêts à lire : aucun calcul de date ni de secondes n'y a lieu.
 */

export interface MilestoneLine {
  readonly key: string;
  readonly official: boolean;
  readonly clock: string;
  readonly km: string;
  readonly name: string;
  readonly reason: string;
  readonly need: string;
  /** Ce qu'il faut prendre à ce jalon : « 1 × Gel 25 ». */
  readonly items: readonly string[];
  /** Une prise ou un ravito : ses produits se modifient (§58). L'arrivée, non. */
  readonly editable: boolean;
  /** Le coureur a fixé lui-même les produits de ce jalon. */
  readonly customized: boolean;
  /** Les produits placés, pour pré-remplir la modification. */
  readonly current: readonly { readonly productId: string; readonly quantity: number }[];
}

export interface SectionLine {
  readonly key: string;
  readonly fromPointId: string;
  readonly name: string;
  readonly meta: string;
  readonly needs: string;
  readonly carry: string;
  readonly prises: readonly string[];
  /** « Glucides 92 % · sodium 80 % » ; nul sans produits. */
  readonly coverage: string | null;
  /** Sous 85 % de glucides (et plus de 15 g) : à compléter ; au-delà de 125 % : au-dessus. */
  readonly status: 'ok' | 'low' | 'high' | null;
  /** Ce qu'il faut faire de chaque flasque en partant ; nul sans flasques prévues. */
  readonly flasks: SectionFlasks | null;
}

export interface SectionFlasks {
  /** « Tes flasques au départ », « Tes flasques à Ravito #1 ». */
  readonly title: string;
  readonly lines: readonly FlaskLine[];
  readonly here: string | null;
  readonly alerts: readonly string[];
  /** Un point où le coureur ne remplit pas : ses flasques continuent. */
  readonly note: string | null;
}

export const MILESTONE_REASONS: Readonly<Record<MilestoneReason, string>> = {
  aid: 'Ravitaillement',
  finish: 'Arrivée',
  climb: 'En montée',
  flat: 'Sur le plat',
  gentle_descent: 'En descente douce',
  descent: 'En descente',
  time: 'Au fil du temps',
};

const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

export function grams(value: number): string {
  return `${String(Math.round(value))} g`;
}

export function volume(milliliters: number): string {
  return milliliters >= 1000
    ? `${decimal.format(milliliters / 1000)} L`
    : `${String(Math.round(milliliters / 10) * 10)} ml`;
}

export function sodium(value: number): string {
  return value >= 1000
    ? `${decimal.format(value / 1000)} g`
    : `${String(Math.round(value / 10) * 10)} mg`;
}

function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours === 0
    ? `${String(minutes)} min`
    : `${String(hours)} h ${String(minutes % 60).padStart(2, '0')}`;
}

function clockAt(startAt: string | null, timezone: string, elapsedSeconds: number): string {
  if (startAt === null) return duration(elapsedSeconds);
  return formatClock(new Date(Date.parse(startAt) + elapsedSeconds * 1000).toISOString(), timezone);
}

function itemsOf(result: NutritionResult, stableKey: string): string[] {
  return (result.allocation?.items[stableKey] ?? []).map(
    (item) => `${String(item.quantity)} × ${item.name}`,
  );
}

function percent(value: number | null): string {
  return value === null ? '—' : `${String(Math.round(value * 100))} %`;
}

function milestoneLine(
  result: NutritionResult,
  milestone: NutritionMilestone,
  startAt: string | null,
  timezone: string,
): MilestoneLine {
  const official = milestone.kind !== 'intake';
  return {
    key: milestone.stableKey,
    official,
    clock: clockAt(startAt, timezone, milestone.elapsedSeconds),
    km: `km ${decimal.format(milestone.distanceKm)}`,
    name: official ? milestone.name : 'Prise',
    reason: MILESTONE_REASONS[milestone.reason],
    need: `${grams(milestone.needSincePrevious.carbsG)} · ${volume(milestone.needSincePrevious.hydrationMl)} · ${sodium(milestone.needSincePrevious.sodiumMg)}`,
    items: itemsOf(result, milestone.stableKey),
    editable: milestone.kind !== 'finish' && result.allocation !== null,
    customized: result.allocation?.customized.includes(milestone.stableKey) ?? false,
    current: (result.allocation?.items[milestone.stableKey] ?? []).map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
    })),
  };
}

/** NUTRITION_ENGINE §45 et prototype : sous 85 % (et plus de 15 g manquants), au-delà de 125 %. */
function statusOf(section: NutritionSection, carbs: number | null): SectionLine['status'] {
  if (carbs === null) return null;
  const missing = section.needs.carbsG * (1 - carbs);
  if (carbs < 0.85 && missing > 15) return 'low';
  if (carbs > 1.25) return 'high';
  return 'ok';
}

function sectionLine(
  result: NutritionResult,
  section: NutritionSection,
  index: number,
  startAt: string | null,
  timezone: string,
): SectionLine {
  const count = section.intakeCount;
  const coverage = result.allocation?.sectionCoverage[index] ?? null;
  return {
    key: `${section.fromPointId}-${section.toPointId}`,
    fromPointId: section.fromPointId,
    name: `${section.fromName} → ${section.toName}`,
    meta: `km ${decimal.format(section.startKm)} → ${decimal.format(section.endKm)} · ${duration(section.endElapsedSeconds - section.startElapsedSeconds)} prévue · ${count === 0 ? 'aucune prise' : count === 1 ? '1 prise' : `${String(count)} prises`}`,
    needs: `${grams(section.needs.carbsG)} · ${volume(section.needs.hydrationMl)} · ${sodium(section.needs.sodiumMg)}`,
    carry: `${volume(section.waterMl)} d’eau · ${volume(section.drinkMl)} de boisson d’effort`,
    prises: result.milestones
      .filter(
        (milestone) =>
          milestone.kind === 'intake' &&
          milestone.elapsedSeconds > section.startElapsedSeconds &&
          milestone.elapsedSeconds < section.endElapsedSeconds,
      )
      .map((milestone) => {
        const items = itemsOf(result, milestone.stableKey);
        return `${clockAt(startAt, timezone, milestone.elapsedSeconds)} · km ${decimal.format(milestone.distanceKm)} · ${items.length === 0 ? MILESTONE_REASONS[milestone.reason].toLowerCase() : items.join(' + ')}`;
      }),
    coverage:
      coverage === null
        ? null
        : `Glucides ${percent(coverage.carbs)} · sodium ${percent(coverage.sodium)}`,
    status: statusOf(section, coverage?.carbs ?? null),
    flasks: null,
  };
}

export interface StrategySummary {
  /** « Couverture 92 % » des glucides ; nulle sans produits. */
  readonly coverage: string | null;
  /** « Toutes tes sections sont dans la cible », ou ce qui reste à compléter. */
  readonly todo: string | null;
  readonly warnings: readonly string[];
}

const WARNINGS: Readonly<Record<string, string>> = {
  no_products: 'Aucun produit choisi : choisis tes produits pour que PLUKA les répartisse.',
  no_drink: 'Aucune boisson d’effort dans ta sélection : ta part de boisson n’apporte rien.',
  drink_without_volume:
    'Ta boisson d’effort n’a pas de volume de dilution : indique-le dans Mes paramètres, étape produits.',
  no_caffeine_product: 'Objectif caféine non couvert : aucun produit caféiné dans ta sélection.',
};

export function strategyLines(
  result: NutritionResult,
  startAt: string | null,
  timezone: string,
): {
  readonly milestones: readonly MilestoneLine[];
  readonly sections: readonly SectionLine[];
  readonly summary: StrategySummary;
} {
  const sections = result.sections.map((section, index) =>
    sectionLine(result, section, index, startAt, timezone),
  );
  const low = sections.filter((section) => section.status === 'low').length;
  const high = sections.filter((section) => section.status === 'high').length;
  const parts = [
    ...(low === 0
      ? []
      : [low === 1 ? '1 section à compléter' : `${String(low)} sections à compléter`]),
    ...(high === 0
      ? []
      : [high === 1 ? '1 section au-dessus' : `${String(high)} sections au-dessus`]),
  ];
  const allocation = result.allocation;

  return {
    milestones: result.milestones.map((milestone) =>
      milestoneLine(result, milestone, startAt, timezone),
    ),
    sections,
    summary: {
      coverage:
        allocation === null ? null : `Couverture ${percent(allocation.totalCoverage.carbs)}`,
      todo:
        allocation === null || allocation.warnings.includes('no_products')
          ? null
          : parts.length === 0
            ? 'Toutes tes sections sont dans la cible'
            : parts.join(' · '),
      warnings: (allocation?.warnings ?? []).map((warning) => WARNINGS[warning] ?? warning),
    },
  };
}

export interface PlannedIntakeRow {
  readonly label: string;
  /** Moyenne par heure de course : « 58 g/h ». */
  readonly perHour: string;
  /** Total sur la course : « 150 g ». */
  readonly total: string;
}

/**
 * Ce que la stratégie fait réellement consommer, en moyenne horaire et au
 * total, à comparer aux objectifs. Glucides, sodium et caféine viennent des
 * produits placés et de la boisson d'effort ; l'hydratation est l'eau et la
 * boisson prévues section par section. Nul sans produits choisis.
 */
export function plannedIntake(result: NutritionResult): readonly PlannedIntakeRow[] | null {
  const allocation = result.allocation;
  const seconds = result.milestones.at(-1)?.elapsedSeconds ?? 0;
  if (allocation === null || seconds <= 0) return null;
  const hours = seconds / 3600;
  const perHour = (value: number) => value / hours;
  const liters = (milliliters: number) =>
    milliliters >= 1000
      ? `${decimal.format(milliliters / 1000)} l`
      : `${String(Math.round(milliliters / 10) * 10)} ml`;

  return [
    {
      label: 'Glucides',
      perHour: `${String(Math.round(perHour(allocation.planned.carbsG)))} g/h`,
      total: grams(allocation.planned.carbsG),
    },
    {
      label: 'Hydratation',
      perHour: `${String(Math.round(perHour(result.totals.hydrationMl) / 10) * 10)} ml/h`,
      total: liters(result.totals.hydrationMl),
    },
    {
      label: 'Sodium',
      perHour: `${String(Math.round(perHour(allocation.planned.sodiumMg) / 10) * 10)} mg/h`,
      total: sodium(allocation.planned.sodiumMg),
    },
    {
      label: 'Caféine',
      perHour:
        allocation.planned.caffeineMg > 0
          ? `${String(Math.round(perHour(allocation.planned.caffeineMg)))} mg/h`
          : 'aucune',
      total: `${String(Math.round(allocation.planned.caffeineMg))} mg`,
    },
  ];
}

// ------------------------------------------------------------
// Mes flasques — §33, §34 (0107)
// ------------------------------------------------------------

export interface FlaskLine {
  readonly container: string;
  readonly text: string;
  /** `act` : un geste à faire ici ; `keep` : ne rien toucher ; `idle` : vide. */
  readonly tone: 'act' | 'keep' | 'idle';
}

export interface FlaskStopLine {
  readonly key: string;
  readonly pointId: string;
  readonly refill: boolean;
  readonly clock: string;
  readonly km: string;
  readonly name: string;
  readonly need: string;
  readonly lines: readonly FlaskLine[];
  /** « Bois 300 ml avant de repartir » ; nul sinon. */
  readonly here: string | null;
  readonly alerts: readonly string[];
}

export interface FlaskView {
  readonly carrying: string;
  readonly doses: string | null;
  readonly stops: readonly FlaskStopLine[];
  readonly skipped: readonly { readonly pointId: string; readonly name: string }[];
  readonly warnings: readonly string[];
}

function containerName(container: FlaskContainer, count: number): string {
  if (container.kind === 'bladder') return 'Poche à eau';
  return count === 1 ? 'Flasque' : `Flasque ${String(container.index)}`;
}

function ml(value: number): string {
  return `${String(Math.round(value / 10) * 10)} ml`;
}

function doses(value: number): string {
  if (value === 0.5) return '½ dose';
  return value === 1 ? '1 dose' : `${decimal.format(value)} doses`;
}

function flaskText(
  action: FlaskAction,
  container: FlaskContainer,
  plan: FlaskPlan,
  until: string,
  start: boolean,
): FlaskLine['text'] {
  const drinkName = plan.drink?.name ?? 'Boisson';
  const recipe =
    plan.drink === null ? '' : `${ml(plan.drink.prepVolumeMl)} + ${doses(plan.drink.prepDoses)}`;
  switch (action.kind) {
    case 'prepare_drink':
      return `${drinkName} : ${start ? 'prépare' : 'refais'} ${recipe}`;
    case 'finish_then_prepare':
      return `${drinkName} : finis les ${ml(action.remainingMl)} restants ici, puis refais ${recipe}`;
    case 'fill_water':
      if (start) {
        return action.levelMl >= container.capacityMl
          ? `Eau : remplis-la (${ml(action.levelMl)})`
          : `Eau : ${ml(action.levelMl)} suffisent`;
      }
      return action.levelMl >= container.capacityMl
        ? `Eau : remplis-la${action.remainingMl > 0 ? ` (il reste ${ml(action.remainingMl)})` : ''}`
        : `Eau : complète à ${ml(action.levelMl)}`;
    case 'keep':
      return container.role === 'drink'
        ? `${drinkName} : n’y touche pas, il reste ${ml(action.remainingMl)}, assez jusqu’à ${until}`
        : `Eau : il reste ${ml(action.remainingMl)}, assez jusqu’à ${until}`;
    case 'unused':
      return start ? 'Vide au départ, pas besoin' : `Pas besoin jusqu’à ${until}`;
  }
}

const FLASK_WARNINGS: Readonly<Record<string, string>> = {
  no_containers: 'Indique tes flasques ou ta poche à eau dans Mes paramètres.',
  drink_counted_as_water:
    'Sans boisson d’effort avec un volume de dilution, toute ton hydratation est comptée en eau.',
  drink_flask_too_small:
    'Tes flasques sont trop petites pour une demi-dose de ta boisson : elle est comptée en eau.',
  capacity_short: 'Sur certains tronçons, tes contenants ne suffisent pas : voir les alertes.',
};

export function flaskView(
  plan: FlaskPlan,
  result: NutritionResult,
  startAt: string | null,
  timezone: string,
): FlaskView {
  const flasks = plan.containers.filter((container) => container.kind === 'flask');
  const bladder = plan.containers.find((container) => container.kind === 'bladder');
  const carryingParts = [
    ...(flasks.length === 0
      ? []
      : [
          `${flasks.length === 1 ? '1 flasque' : `${String(flasks.length)} flasques`} de ${ml(flasks[0]?.capacityMl ?? 0)}`,
        ]),
    ...(bladder === undefined
      ? []
      : [`une poche de ${decimal.format(bladder.capacityMl / 1000)} l`]),
  ];
  const names = new Map<string, string>();
  for (const section of result.sections) {
    names.set(section.fromPointId, section.fromName);
    names.set(section.toPointId, section.toName);
  }

  return {
    carrying:
      carryingParts.length === 0 ? 'Aucun contenant' : `Tu portes ${carryingParts.join(' et ')}`,
    doses:
      plan.drink === null || plan.dosesAtStart + plan.dosesToCarry === 0
        ? null
        : `${plan.drink.name} : ${doses(plan.dosesAtStart)} à préparer avant le départ${
            plan.dosesToCarry > 0 ? `, ${doses(plan.dosesToCarry)} en sachet à emporter` : ''
          }`,
    stops: plan.stops.map((stop) => {
      const start = stop.kind === 'start';
      // La fin d'une flasque se dit déjà sur sa ligne : seul le reste se boit « en plus ».
      const finished = stop.actions
        .filter((action) => action.kind === 'finish_then_prepare')
        .reduce((sum, action) => sum + action.remainingMl, 0);
      const extra = stop.drinkHereMl - finished;
      const alerts: string[] = [];
      if (stop.shortfallMl >= 50) {
        alerts.push(
          `Il te manque environ ${ml(stop.shortfallMl)} jusqu’à ${stop.untilName} : prends une flasque de plus ou ta poche à eau.`,
        );
      }
      if (stop.drinkTopUpWithWaterMl >= 50) {
        alerts.push(
          `Ta boisson d’effort sera un peu juste (${ml(stop.drinkTopUpWithWaterMl)} de moins) : complète avec ton eau.`,
        );
      }
      return {
        key: `${stop.pointId}-${String(stop.elapsedSeconds)}`,
        pointId: stop.pointId,
        refill: !start,
        clock: clockAt(startAt, timezone, stop.elapsedSeconds),
        km: `km ${decimal.format(stop.distanceKm)}`,
        name: stop.name,
        need: `Jusqu’à ${stop.untilName} : ${ml(stop.waterNeedMl)} d’eau${
          stop.drinkNeedMl > 0 ? ` · ${ml(stop.drinkNeedMl)} de boisson` : ''
        }`,
        lines: stop.actions.flatMap((action) => {
          const container = plan.containers.find((entry) => entry.id === action.containerId);
          if (container === undefined) return [];
          return [
            {
              container: containerName(container, flasks.length),
              text: flaskText(action, container, plan, stop.untilName, start),
              tone:
                action.kind === 'keep'
                  ? ('keep' as const)
                  : action.kind === 'unused'
                    ? ('idle' as const)
                    : ('act' as const),
            },
          ];
        }),
        here:
          extra >= 50
            ? `Bois environ ${ml(extra)} d’eau avant de ${start ? 'partir' : 'repartir'}`
            : null,
        alerts,
      };
    }),
    skipped: plan.skippedPointIds.map((pointId) => ({
      pointId,
      name: names.get(pointId) ?? 'Ravitaillement',
    })),
    warnings: plan.warnings
      .filter((warning) => warning !== 'capacity_short')
      .map((warning) => FLASK_WARNINGS[warning] ?? warning),
  };
}

/**
 * Le récapitulatif « Par section » reprend, au début de chaque section, ce
 * qu'il faut faire de chaque flasque (§104 : remplissage / emport). Les
 * sections et les points de remplissage se suivent dans le même ordre : un
 * point sauté (« Je ne remplis pas ici ») n'a pas d'arrêt de flasques.
 */
export function sectionsWithFlasks(
  sections: readonly SectionLine[],
  flasks: FlaskView | null,
): readonly SectionLine[] {
  if (flasks === null) return sections;
  let next = 0;
  let last: FlaskStopLine | null = null;
  return sections.map((section) => {
    const stop = flasks.stops[next];
    if (stop !== undefined && stop.pointId === section.fromPointId) {
      next += 1;
      last = stop;
      return {
        ...section,
        flasks: {
          title: stop.refill ? `Tes flasques à ${stop.name}` : 'Tes flasques au départ',
          lines: stop.lines,
          here: stop.here,
          alerts: stop.alerts,
          note: null,
        },
      };
    }
    return {
      ...section,
      flasks: {
        title: 'Tes flasques',
        lines: [],
        here: null,
        alerts: [],
        note:
          last === null
            ? 'Tu ne remplis pas ici.'
            : `Tu ne remplis pas ici : continue avec ce que tu as rempli ${last.refill ? `à ${last.name}` : 'au départ'}.`,
      },
    };
  });
}
