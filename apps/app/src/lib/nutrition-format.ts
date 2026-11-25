import { AID_KIND_LABELS } from '@pluka/domain';
import type {
  AidPointView,
  CustomItemView,
  NutritionPlanReview,
  OrphanMilestoneView,
  FlaskAction,
  FlaskContainer,
  FlaskPlan,
  MilestoneReason,
  NutritionMilestone,
  NutritionPreparationView,
  NutritionResult,
  NutritionSendStatus,
  NutritionSection,
  PreparationProduct,
  PreparationQuantity,
  SuppliedItem,
  SupplyPointView,
} from '@pluka/domain';

import { formatClock } from '@/lib/plan-format';

/**
 * Mise en forme de la stratégie Nutrition, côté serveur. Le navigateur reçoit
 * des libellés prêts à lire : aucun calcul de date ni de secondes n'y a lieu.
 */

export interface MilestoneLine {
  readonly key: string;
  /** L'ancre de la ligne dans « Ma stratégie », que visent les points du profil. */
  readonly anchor: string;
  /** Le ravitaillement de ce jalon ; nul pour une prise ou l'arrivée. */
  readonly pointId: string | null;
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

/** « intake:<uuid>:2 » → « prise-intake-<uuid>-2 » : une ancre sans deux-points. */
function intakeAnchor(stableKey: string): string {
  return `prise-${stableKey.replace(/[^A-Za-z0-9-]/g, '-')}`;
}

/** Une prise posée sur le profil du Plan : où, et ce qu'elle dit au survol. */
export interface ProfileIntake {
  readonly key: string;
  readonly anchor: string;
  readonly distanceKm: number;
  /** « Prise · 10:42 · km 12,4 — 1 × Gel 25 ». */
  readonly label: string;
}

/**
 * Les prises à poser sur le profil — prototype `planNutMarks`. Les
 * ravitaillements et l'arrivée y sont déjà marqués comme points du parcours :
 * seules les prises entre deux points s'ajoutent.
 */
export function profileIntakes(
  result: NutritionResult,
  startAt: string | null,
  timezone: string,
): readonly ProfileIntake[] {
  return result.milestones
    .filter((milestone) => milestone.kind === 'intake')
    .map((milestone) => {
      const line = milestoneLine(result, milestone, startAt, timezone);
      const what =
        line.items.length > 0
          ? line.items.join(' + ')
          : result.allocation === null
            ? line.need
            : 'Rien de prévu';
      return {
        key: line.key,
        anchor: line.anchor,
        distanceKm: milestone.distanceKm,
        label: `Prise · ${line.clock} · ${line.km} — ${what}`,
      };
    });
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
    anchor: intakeAnchor(milestone.stableKey),
    pointId: milestone.kind === 'aid' ? milestone.pointId : null,
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

// ------------------------------------------------------------
// Le Plan a changé — §61 à §66, N25 à N28 ; décisions du 2026-11-23.
// ------------------------------------------------------------

function customItemsText(items: readonly CustomItemView[]): string {
  return items.length === 0
    ? 'Rien à cette prise'
    : items.map((item) => `${String(item.quantity)} × ${item.label}`).join(' + ');
}

function kmText(distanceKm: number | null): string | null {
  return distanceKm === null ? null : `km ${decimal.format(distanceKm)}`;
}

/** Une prise modifiée, telle que le récapitulatif la montre avant validation. */
export interface ReviewKeptLine {
  readonly key: string;
  /** « Prise · 10:42 → 10:12 · km 12,4 → 10,1 », ou « Prise · 10:42 · km 12,4 » si rien ne bouge. */
  readonly where: string;
  readonly items: string;
  /** L'heure change (N25) : marqué autrement que par la couleur. */
  readonly shifted: boolean;
}

export interface ReviewOrphanLine {
  readonly key: string;
  /** « Prise de 10:42 · km 12,4 » : là où le coureur l'avait. */
  readonly where: string;
  readonly items: string;
}

export interface ReviewView {
  readonly kept: readonly ReviewKeptLine[];
  readonly orphaned: readonly ReviewOrphanLine[];
  readonly canApply: boolean;
}

function orphanWhere(
  orphan: OrphanMilestoneView,
  startAt: string | null,
  timezone: string,
): string {
  const km = kmText(orphan.distanceKm);
  return `${orphan.label} de ${clockAt(startAt, timezone, orphan.elapsedSeconds)}${km === null ? '' : ` · ${km}`}`;
}

export function reviewLines(
  review: NutritionPlanReview,
  startAt: string | null,
  timezone: string,
): ReviewView {
  return {
    kept: review.kept.map((kept) => {
      const before = clockAt(startAt, timezone, kept.before.elapsedSeconds);
      const after = clockAt(startAt, timezone, kept.after.elapsedSeconds);
      const kmBefore = kmText(kept.before.distanceKm);
      const kmAfter = kmText(kept.after.distanceKm);
      const clock = kept.shifted && before !== after ? `${before} → ${after}` : after;
      const km =
        kmAfter === null
          ? null
          : kmBefore !== null && kmBefore !== kmAfter
            ? `${kmBefore} → ${kmAfter.replace('km ', '')}`
            : kmAfter;
      return {
        key: kept.stableKey,
        where: `${kept.label} · ${clock}${km === null ? '' : ` · ${km}`}`,
        items: customItemsText(kept.items),
        shifted: kept.shifted && before !== after,
      };
    }),
    orphaned: review.orphaned.map((orphan) => ({
      key: orphan.stableKey,
      where: orphanWhere(orphan, startAt, timezone),
      items: customItemsText(orphan.items),
    })),
    canApply: review.canApply,
  };
}

/** Une prise à replacer, et les prises du Plan actif où la poser. */
export interface OrphanLine {
  readonly key: string;
  readonly where: string;
  readonly items: string;
  /** Pourquoi elle ne peut que revenir à PLUKA ; nul si elle se place. */
  readonly onlyReturn: string | null;
  /** La prise du Plan actif la plus proche dans le temps, proposée d'abord. */
  readonly nearest: string | null;
}

export interface PlaceTarget {
  readonly key: string;
  /** « 10:12 · km 10,1 · Prise ». */
  readonly label: string;
}

export function orphanLines(
  toPlace: readonly OrphanMilestoneView[],
  result: NutritionResult,
  startAt: string | null,
  timezone: string,
): { readonly lines: readonly OrphanLine[]; readonly targets: readonly PlaceTarget[] } {
  const editable = result.milestones.filter((milestone) => milestone.kind !== 'finish');
  return {
    lines: toPlace.map((orphan) => {
      const nearest = [...editable].sort(
        (left, right) =>
          Math.abs(left.elapsedSeconds - orphan.elapsedSeconds) -
          Math.abs(right.elapsedSeconds - orphan.elapsedSeconds),
      )[0];
      return {
        key: orphan.stableKey,
        where: orphanWhere(orphan, startAt, timezone),
        items: customItemsText(orphan.items),
        onlyReturn: orphan.placeable
          ? null
          : orphan.items.length === 0
            ? 'Tu n’y prenais rien : il n’y a rien à replacer.'
            : 'Un de ses produits n’est plus dans « Mes produits » : elle ne peut que revenir à PLUKA.',
        nearest: nearest?.stableKey ?? null,
      };
    }),
    targets: editable.map((milestone) => ({
      key: milestone.stableKey,
      label: `${clockAt(startAt, timezone, milestone.elapsedSeconds)} · km ${decimal.format(milestone.distanceKm)} · ${milestone.kind === 'aid' ? milestone.name : 'Prise'}`,
    })),
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
  /** Le coureur a une boisson d'effort : la boisson du ravito peut la remplacer à un point. */
  readonly hasDrink: boolean;
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
      return action.fromAid === true
        ? `Boisson du ravito : remplis-la ici (${ml(action.levelMl)})`
        : `${drinkName} : ${start ? 'prépare' : 'refais'} ${recipe}`;
    case 'finish_then_prepare':
      return action.fromAid === true
        ? `Finis les ${ml(action.remainingMl)} restants ici, puis remplis-la de boisson du ravito`
        : `${drinkName} : finis les ${ml(action.remainingMl)} restants ici, puis refais ${recipe}`;
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
    hasDrink: plan.drink !== null,
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

// ------------------------------------------------------------
// À préparer pour cette course — §49 à §56 (0108)
// ------------------------------------------------------------

export type SupplyValue = 'auto' | 'start' | 'bag' | 'assistance';

export interface PreparationProductLine {
  readonly key: string;
  readonly name: string;
  /** « 4 prévus · +1 de réserve » */
  readonly detail: string;
  /** « 5 à préparer » */
  readonly total: string;
  /** « 3 sur toi · 2 dans ton drop bag » */
  readonly where: string;
}

export interface PreparationPointLine {
  readonly pointId: string;
  readonly clock: string;
  readonly km: string;
  readonly name: string;
  readonly items: readonly string[];
  /** « Porté depuis le départ », « Dans ton drop bag », « Marie te les donne ». */
  readonly source: string;
  /** Le choix n'existe plus (§56) : ses produits n'ont pas de place. */
  readonly orphan: boolean;
  readonly selected: SupplyValue;
  /** Nul quand il n'y a rien d'autre à choisir que le départ. */
  readonly options: readonly { readonly value: SupplyValue; readonly label: string }[] | null;
  /** Ce qui manque pour avoir le choix : un drop bag ou un rendez-vous. */
  readonly hint: string | null;
  /** Les listes envoyées aux accompagnants de ce point (0109). */
  readonly sends: readonly SendLine[];
}

export interface PreparationLines {
  readonly reservePercent: number;
  readonly products: readonly PreparationProductLine[];
  readonly startName: string;
  readonly startClock: string;
  /** Ce qui part avec le coureur au départ, réserve comprise. */
  readonly start: readonly string[];
  readonly points: readonly PreparationPointLine[];
  readonly orphans: number;
  /** Les listes périmées chez un accompagnant : l'alerte en tête de la Nutrition. */
  readonly stale: readonly SendLine[];
}

function quantity(value: number): string {
  return decimal.format(value);
}

function unitText(item: Pick<PreparationQuantity, 'unit' | 'name'>, value: number): string {
  return item.unit === 'dose'
    ? `${doses(value)} de ${item.name}`
    : `${quantity(value)} × ${item.name}`;
}

function plural(value: number, one: string, many: string): string {
  return value <= 1 ? one : many;
}

function productLine(row: PreparationProduct): PreparationProductLine {
  const dose = row.unit === 'dose';
  const where = [
    ...(dose && row.inFlasks > 0 ? [`${doses(row.inFlasks)} dans tes flasques au départ`] : []),
    ...(row.start - (dose ? row.inFlasks : 0) > 0
      ? [
          dose
            ? `${doses(row.start - row.inFlasks)} en sachet sur toi`
            : `${quantity(row.start)} sur toi`,
        ]
      : []),
    ...(row.bag > 0 ? [`${dose ? doses(row.bag) : quantity(row.bag)} en drop bag`] : []),
    ...(row.assistance > 0
      ? [`${dose ? doses(row.assistance) : quantity(row.assistance)} à l’Assistance`]
      : []),
    ...(row.unassigned > 0
      ? [`${dose ? doses(row.unassigned) : quantity(row.unassigned)} sans place`]
      : []),
  ];
  return {
    key: `${row.unit}:${row.productId}`,
    name: dose ? `${row.name} (boisson)` : row.name,
    detail: [
      dose
        ? `${doses(row.planned)} ${plural(row.planned, 'prévue', 'prévues')}`
        : `${quantity(row.planned)} ${plural(row.planned, 'prévu', 'prévus')}`,
      ...(row.reserve > 0
        ? [`+${dose ? doses(row.reserve) : quantity(row.reserve)} de réserve`]
        : []),
    ].join(' · '),
    total: dose ? `${doses(row.total)} à préparer` : `${quantity(row.total)} à préparer`,
    where: where.join(' · '),
  };
}

const SUPPLY_LABELS = {
  start: () => 'Porté depuis le départ',
  bag: () => 'Dans ton drop bag',
  assistance: (point: SupplyPointView) =>
    `${point.assistants.join(' et ')} ${point.assistants.length > 1 ? 'te les donnent' : 'te les donne'}`,
} as const;

/** « porté depuis le départ », « dans ton drop bag », « Alice te les donne » : un prénom garde sa majuscule. */
function autoLabel(point: SupplyPointView): string {
  const label = SUPPLY_LABELS[point.auto](point);
  return point.auto === 'assistance' ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

function sourceText(point: SupplyPointView): string {
  if (point.source === 'unassigned') {
    return point.chosen === 'bag'
      ? 'Sans place : ton drop bag à ce point n’existe plus'
      : 'Sans place : plus de rendez-vous d’Assistance à ce point';
  }
  return SUPPLY_LABELS[point.source](point);
}

export function preparationLines(
  preparation: NutritionPreparationView,
  startAt: string | null,
  timezone: string,
): PreparationLines {
  const { plan } = preparation;
  const byId = new Map(plan.points.map((point) => [point.pointId, point]));
  const first = plan.points[0];
  const clocks = new Map(
    plan.points.map((point) => [point.pointId, clockAt(startAt, timezone, point.elapsedSeconds)]),
  );
  const sends = preparation.sends.map((send) =>
    sendLine(
      { ...send, clock: startAt === null ? null : (clocks.get(send.pointId) ?? null) },
      timezone,
    ),
  );

  return {
    reservePercent: plan.reservePercent,
    startName: first?.name ?? 'Départ',
    startClock: clockAt(startAt, timezone, first?.elapsedSeconds ?? 0),
    products: plan.products.map(productLine),
    start: suppliedLines(
      plan.products.filter((row) => row.start > 0).map((row) => ({ ...row, quantity: row.start })),
    ),
    points: preparation.points.map((point) => {
      const items = byId.get(point.pointId)?.items ?? [];
      const choices = point.options.map((value) => ({
        value,
        label: SUPPLY_LABELS[value](point),
      }));
      const orphan = point.source === 'unassigned';
      return {
        pointId: point.pointId,
        clock: clockAt(startAt, timezone, point.elapsedSeconds),
        km: `km ${decimal.format(point.distanceKm)}`,
        name: point.name,
        items: items.map((item) => unitText(item, item.quantity)),
        source: sourceText(point),
        orphan,
        selected: point.chosen ?? 'auto',
        options:
          point.options.length <= 1 && point.chosen === null
            ? null
            : [
                {
                  value: 'auto',
                  label: `Automatique : ${autoLabel(point)}`,
                },
                ...choices,
                ...(orphan && point.chosen !== null
                  ? [
                      {
                        value: point.chosen,
                        label:
                          point.chosen === 'bag'
                            ? 'Drop bag (n’existe plus)'
                            : 'Assistance (plus de rendez-vous)',
                      },
                    ]
                  : []),
              ],
        hint:
          point.options.length <= 1
            ? 'Pour les trouver ici, crée un drop bag dans Sacs ou un rendez-vous dans Assistance.'
            : null,
        sends: sends.filter((send) => send.pointId === point.pointId),
      };
    }),
    orphans: preparation.points.filter((point) => point.source === 'unassigned').length,
    stale: sends.filter((send) => send.status === 'stale'),
  };
}

/**
 * Ce que la stratégie range dans un sac ou chez l'Assistance, en lignes :
 * « 3 × Gel (dont 1 de réserve) », « 1 dose de Näak, dans tes flasques ».
 */
export function suppliedLines(items: readonly SuppliedItem[]): readonly string[] {
  return items.flatMap((item) => {
    const dose = item.unit === 'dose';
    const loose = item.quantity - (dose ? item.inFlasks : 0);
    return [
      ...(dose && item.inFlasks > 0
        ? [`${doses(item.inFlasks)} de ${item.name}, dans tes flasques`]
        : []),
      ...(loose > 0
        ? [
            `${unitText(item, loose)}${dose && item.inFlasks > 0 ? ' en sachet' : ''}${
              item.reserve > 0
                ? ` (dont ${dose ? doses(item.reserve) : quantity(item.reserve)} de réserve)`
                : ''
            }`,
          ]
        : []),
    ];
  });
}

// ------------------------------------------------------------
// Envoyer à l'accompagnant — §55 (0109)
// ------------------------------------------------------------

export interface SendLine {
  readonly rendezvousId: string;
  readonly pointId: string;
  readonly status: Exclude<NutritionSendStatus, 'none'>;
  /** « Alice a une ancienne liste » ; nul hors d'une liste périmée. */
  readonly title: string | null;
  readonly text: string;
  /** « Envoyer à Alice », « Renvoyer à Alice » ; nul quand tout est à jour. */
  readonly action: string | null;
  /** Ce que l'accompagnant voit encore (liste périmée, sur la page Assistance). */
  readonly seen: readonly string[];
  /**
   * « Prévenir Alice » : un message prêt à partager depuis le téléphone du
   * coureur — PLUKA n'écrit à personne. Seulement quand sa page est à jour.
   */
  readonly notify: { readonly label: string; readonly message: string } | null;
}

export interface SendFacts {
  readonly rendezvousId: string;
  readonly assistant: string;
  readonly pointId: string;
  readonly pointName: string;
  readonly status: NutritionSendStatus;
  readonly sentAt: string | null;
  readonly nothingToGive: boolean;
  readonly sentLabels?: readonly string[];
  /** Ce qu'il faut donner maintenant. */
  readonly labels: readonly string[];
  /** L'heure de passage prévue, pour le message ; nulle sans Plan. */
  readonly clock: string | null;
}

/** « de Paul », « d’Alice » : l'élision devant une voyelle ou un h muet supposé. */
function ofName(name: string): string {
  return /^[aeiouyhàâäéèêëîïôöùûü]/i.test(name) ? `d’${name}` : `de ${name}`;
}

/** Le message que le coureur envoie lui-même, par SMS, WhatsApp… */
function notifyMessage(send: SendFacts): string {
  return [
    `Salut ${send.assistant} ! Voici ce que tu dois me donner à ${send.pointName}${
      send.clock === null ? '' : ` (passage prévu vers ${send.clock})`
    } :`,
    ...send.labels.map((label) => `• ${label}`),
    'Tout est aussi sur ma page PLUKA, avec le lien que je t’ai envoyé.',
  ].join('\n');
}

/** « 19 nov. à 14:32 », dans le fuseau de la course. */
function sentMoment(isoInstant: string, timeZone: string): string {
  const day = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone }).format(
    new Date(isoInstant),
  );
  return `${day} à ${formatClock(isoInstant, timeZone)}`;
}

export function sendLine(send: SendFacts, timezone: string): SendLine {
  const base = {
    rendezvousId: send.rendezvousId,
    pointId: send.pointId,
    seen: send.status === 'stale' ? (send.sentLabels ?? []) : [],
    notify: null,
  };
  const when = send.sentAt === null ? null : sentMoment(send.sentAt, timezone);
  switch (send.status) {
    case 'stale':
      return {
        ...base,
        status: 'stale',
        title: `${send.assistant} a une ancienne liste de produits`,
        text: send.nothingToGive
          ? `Ta stratégie ne prévoit plus rien à te donner à ${send.pointName}, mais la page ${ofName(send.assistant)} affiche encore la liste envoyée le ${when ?? '—'}.`
          : `Ta stratégie Nutrition a changé depuis l’envoi du ${when ?? '—'} : à ${send.pointName}, la page ${ofName(send.assistant)} ne montre plus ce qu’il faut te donner.`,
        action: send.nothingToGive
          ? `Retirer la liste ${ofName(send.assistant)}`
          : `Renvoyer à ${send.assistant}`,
      };
    case 'sent':
      return {
        ...base,
        status: 'sent',
        title: null,
        text: `Envoyé à ${send.assistant} le ${when ?? '—'} : sa page est à jour.`,
        action: null,
        notify:
          send.labels.length === 0
            ? null
            : { label: `Prévenir ${send.assistant}`, message: notifyMessage(send) },
      };
    case 'unsent':
    case 'none':
      return {
        ...base,
        status: 'unsent',
        title: null,
        text: `${send.assistant} ne voit pas encore ces produits sur sa page.`,
        action: `Envoyer à ${send.assistant}`,
      };
  }
}

// ------------------------------------------------------------
// Ce que propose chaque ravitaillement — §31, §32 (0110)
// ------------------------------------------------------------

export interface AidLine {
  readonly pointId: string;
  /** « Au ravito : Eau · Boisson d’effort » ; « Contenu non communiqué par l’organisation ». */
  readonly content: string;
  readonly announced: boolean;
  /** « Ta note : Eau · Cola » ; nulle sans note. */
  readonly note: string | null;
  /** Pour pré-remplir la note. */
  readonly noteKinds: readonly string[];
  readonly noteText: string;
  /** La boisson d'effort du ravito : nulle quand rien n'en annonce (ni ne la note). */
  readonly drink: { readonly chosen: boolean; readonly fromNote: boolean } | null;
}

export function aidLines(aid: readonly AidPointView[]): readonly AidLine[] {
  return aid.map((point) => {
    const noted =
      point.note === null
        ? []
        : [
            ...point.note.kinds.map((kind) => AID_KIND_LABELS[kind]),
            ...(point.note.note === null ? [] : [point.note.note]),
          ];
    return {
      pointId: point.pointId,
      announced: point.official.length > 0,
      content:
        point.official.length > 0
          ? `Au ravito : ${point.official.map((item) => item.label).join(' · ')}`
          : 'Contenu non communiqué par l’organisation',
      // La note ne sert que si rien n'est annoncé : l'officiel prime.
      note:
        noted.length === 0 || point.official.length > 0 ? null : `Ta note : ${noted.join(' · ')}`,
      noteKinds: point.note?.kinds ?? [],
      noteText: point.note?.note ?? '',
      drink:
        point.drink === null
          ? null
          : { chosen: point.usesAidDrink, fromNote: point.drink === 'note' },
    };
  });
}
