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
}

export interface SectionLine {
  readonly key: string;
  readonly name: string;
  readonly meta: string;
  readonly needs: string;
  readonly carry: string;
  readonly prises: readonly string[];
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

function milestoneLine(
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
  };
}

function sectionLine(
  section: NutritionSection,
  milestones: readonly NutritionMilestone[],
  startAt: string | null,
  timezone: string,
): SectionLine {
  const count = section.intakeCount;
  return {
    key: `${section.fromPointId}-${section.toPointId}`,
    name: `${section.fromName} → ${section.toName}`,
    meta: `km ${decimal.format(section.startKm)} → ${decimal.format(section.endKm)} · ${duration(section.endElapsedSeconds - section.startElapsedSeconds)} prévue · ${count === 0 ? 'aucune prise' : count === 1 ? '1 prise' : `${String(count)} prises`}`,
    needs: `${grams(section.needs.carbsG)} · ${volume(section.needs.hydrationMl)} · ${sodium(section.needs.sodiumMg)}`,
    carry: `${volume(section.waterMl)} d’eau · ${volume(section.drinkMl)} de boisson d’effort`,
    prises: milestones
      .filter(
        (milestone) =>
          milestone.kind === 'intake' &&
          milestone.elapsedSeconds > section.startElapsedSeconds &&
          milestone.elapsedSeconds < section.endElapsedSeconds,
      )
      .map(
        (milestone) =>
          `${clockAt(startAt, timezone, milestone.elapsedSeconds)} · km ${decimal.format(milestone.distanceKm)} · ${MILESTONE_REASONS[milestone.reason].toLowerCase()}`,
      ),
  };
}

export function strategyLines(
  result: NutritionResult,
  startAt: string | null,
  timezone: string,
): { readonly milestones: readonly MilestoneLine[]; readonly sections: readonly SectionLine[] } {
  return {
    milestones: result.milestones.map((milestone) => milestoneLine(milestone, startAt, timezone)),
    sections: result.sections.map((section) =>
      sectionLine(section, result.milestones, startAt, timezone),
    ),
  };
}
