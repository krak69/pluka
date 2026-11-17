import type {
  NutritionRepository,
  NutritionSettingsRecord,
  RaceWaypointRepository,
} from '@pluka/db';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  DomainError,
  EntitlementError,
  disableNutrition,
  generateRacePlan,
  getNutritionStrategy,
  saveNutritionSettings,
  type NutritionContext,
  type PlanContext,
} from '../src/index.js';
import {
  createFakeEntitlementRepositories,
  entitlementBaseState,
  grantEntitlement,
  type EntitlementState,
} from './fixtures/entitlement-repositories.js';
import {
  participationBaseState,
  PUBLIC_RACE,
  RUNNER_A,
  RUNNER_B,
  seedParticipation,
} from './fixtures/participation-repositories.js';
import {
  activePlan,
  createFakePlanRepositories,
  planBaseState,
  type PlanState,
} from './fixtures/plan-repositories.js';

/**
 * Nutrition, tranche 1 — NUTRITION_ENGINE §1, §7, §10, §83 ; décisions du
 * 2026-11-17. Parcours de la fixture Plan : 10 km, un ravitaillement au km 5.
 */

const NOW = new Date('2026-03-01T10:00:00.000Z');

let entitlements: EntitlementState;
let plan: PlanState;
let own: string;
let stored: (NutritionSettingsRecord & { participantRaceId: string })[];

function fakeNutrition(): NutritionRepository {
  return {
    findLatest: async (participantRaceId) => {
      const row = stored.filter((entry) => entry.participantRaceId === participantRaceId).at(-1);
      if (row === undefined) return null;
      const active = plan.plans.find((entry) => entry.record.status === 'active');
      return { ...row, onActivePlan: active?.record.id === row.racePlanId };
    },
    disable: async (participantRaceId) => {
      stored = stored.map((entry) =>
        entry.participantRaceId === participantRaceId ? { ...entry, enabled: false } : entry,
      );
    },
    save: async (participantRaceId, settings) => {
      stored.push({
        participantRaceId,
        id: `nutrition-${String(stored.length + 1)}`,
        racePlanId: activePlan(plan).record.id,
        onActivePlan: true,
        carbsGPerHour: settings.carbsGPerHour,
        hydrationMlPerHour: settings.hydrationMlPerHour,
        sodiumMgPerHour: settings.sodiumMgPerHour,
        caffeineTotalMg: settings.caffeineTotalMg,
        waterSharePercent: settings.waterSharePercent,
        density: settings.density,
        aidBuffer: settings.aidBuffer,
        placementMode: settings.placementMode,
        intervalMinutes: settings.intervalMinutes,
        enabled: true,
        confirmedAt: NOW.toISOString(),
      });
    },
  };
}

function context(userId: string = RUNNER_A): NutritionContext & PlanContext {
  const planRepositories = createFakePlanRepositories(plan);
  return {
    repositories: {
      ...planRepositories,
      ...createFakeEntitlementRepositories(entitlements),
      nutrition: fakeNutrition(),
      waypoints: {
        listByRace: async (raceId: string) =>
          plan.waypoints
            .filter((waypoint) => waypoint.raceId === raceId)
            .map((waypoint) => ({ ...waypoint, dropBagAllowed: false, assistanceAllowed: false })),
      } as unknown as RaceWaypointRepository,
    },
    actor: { userId },
    now: () => NOW,
  };
}

const SETTINGS = {
  carbsGPerHour: 60,
  hydrationMlPerHour: 500,
  sodiumMgPerHour: 400,
  caffeineTotalMg: null,
  waterSharePercent: 50,
  density: 'auto' as const,
  aidBuffer: true,
  placementMode: 'smart' as const,
  intervalMinutes: null,
};

function racePass(): void {
  grantEntitlement(entitlements, { kind: 'race_pass', userId: RUNNER_A, participantRaceId: own });
}

beforeEach(() => {
  const participation = participationBaseState();
  own = seedParticipation(participation, { userId: RUNNER_A, raceId: PUBLIC_RACE }).id;
  seedParticipation(participation, { userId: RUNNER_B, raceId: PUBLIC_RACE });
  entitlements = entitlementBaseState(participation);
  plan = planBaseState(participation, PUBLIC_RACE);
  stored = [];
});

async function withPlan(hours = 3): Promise<void> {
  await generateRacePlan(context(), {
    participantRaceId: own,
    targetDurationSeconds: hours * 3600,
  });
}

describe('lecture — gratuite', () => {
  it('sans Plan, attend le Plan', async () => {
    const view = await getNutritionStrategy(context(), { participantRaceId: own });
    expect(view.state).toBe('no_plan');
  });

  it('avec un Plan et sans cible, attend les cibles du coureur — rien n’est inventé (§1)', async () => {
    await withPlan();
    const view = await getNutritionStrategy(context(), { participantRaceId: own });

    expect(view.state).toBe('off');
    expect(view.result).toBeNull();
    expect(view.canEdit).toBe(false);
  });

  it('ne lit pas la stratégie d’un autre coureur', async () => {
    await expect(
      getNutritionStrategy(context(RUNNER_B), { participantRaceId: own }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe('cibles — Race Pass (04 §44)', () => {
  it('refuse de régler les cibles sans Race Pass', async () => {
    await withPlan();

    await expect(
      saveNutritionSettings(context(), { participantRaceId: own, ...SETTINGS }),
    ).rejects.toBeInstanceOf(EntitlementError);
    expect(stored).toEqual([]);
  });

  it('enregistre les cibles, puis calcule la stratégie sur le Plan actif', async () => {
    racePass();
    await withPlan();
    await saveNutritionSettings(context(), { participantRaceId: own, ...SETTINGS });

    const view = await getNutritionStrategy(context(), { participantRaceId: own });
    expect(view.state).toBe('ready');
    expect(view.canEdit).toBe(true);
    // 3 h de Plan, 60 g/h : 180 g — la cible du coureur, telle quelle.
    expect(view.result?.totals.carbsG).toBeCloseTo(180, 6);
    expect(view.result?.sections.map((section) => section.toName)).toEqual([
      'Col du Test',
      'Arrivée',
    ]);
    expect(view.result?.milestones.some((milestone) => milestone.kind === 'intake')).toBe(true);
  });

  it('refuse sans Plan : la Nutrition est une couche du Plan', async () => {
    racePass();

    await expect(
      saveNutritionSettings(context(), { participantRaceId: own, ...SETTINGS }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('écarte une saisie hors des bornes techniques', async () => {
    racePass();
    await withPlan();

    await expect(
      saveNutritionSettings(context(), {
        participantRaceId: own,
        ...SETTINGS,
        carbsGPerHour: 6000,
      }),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('suit un nouveau Plan avec les mêmes cibles, et le dit', async () => {
    racePass();
    await withPlan(3);
    await saveNutritionSettings(context(), { participantRaceId: own, ...SETTINGS });
    await withPlan(4);

    const view = await getNutritionStrategy(context(), { participantRaceId: own });
    expect(view.planChangedSinceSettings).toBe(true);
    expect(view.result?.totals.carbsG).toBeCloseTo(240, 6);
  });
});

describe('activation — jamais par défaut (décision du 2026-11-17)', () => {
  it('se désactive, garde les réglages, et se réactive en les réenregistrant', async () => {
    racePass();
    await withPlan();
    await saveNutritionSettings(context(), { participantRaceId: own, ...SETTINGS });

    await disableNutrition(context(), { participantRaceId: own });
    const off = await getNutritionStrategy(context(), { participantRaceId: own });
    expect(off.state).toBe('off');
    expect(off.settings?.carbsGPerHour).toBe(60);

    await saveNutritionSettings(context(), { participantRaceId: own, ...SETTINGS });
    expect((await getNutritionStrategy(context(), { participantRaceId: own })).state).toBe('ready');
  });

  it('accepte un rythme imposé, avec sa cadence', async () => {
    racePass();
    await withPlan();
    await saveNutritionSettings(context(), {
      participantRaceId: own,
      ...SETTINGS,
      placementMode: 'interval',
      intervalMinutes: 20,
    });

    expect(stored.at(-1)?.placementMode).toBe('interval');
    expect(stored.at(-1)?.intervalMinutes).toBe(20);
  });
});
