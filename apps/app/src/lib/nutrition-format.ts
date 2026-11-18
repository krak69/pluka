import type {
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
}

export interface SectionLine {
  readonly key: string;
  readonly name: string;
  readonly meta: string;
  readonly needs: string;
  readonly carry: string;
  readonly prises: readonly string[];
  /** « Glucides 92 % · sodium 80 % » ; nul sans produits. */
  readonly coverage: string | null;
  /** Sous 85 % de glucides (et plus de 15 g) : à compléter ; au-delà de 125 % : au-dessus. */
  readonly status: 'ok' | 'low' | 'high' | null;
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
