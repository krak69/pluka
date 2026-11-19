import type {
  CustomMilestoneRecord,
  MyProductRecord,
  MyProductsRepository,
  NutritionRepository,
  NutritionSettingsRecord,
  RaceWaypointRepository,
} from '@pluka/db';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  DomainError,
  EntitlementError,
  createMyNutritionProduct,
  disableNutrition,
  generateRacePlan,
  getNutritionStrategy,
  resetNutritionMilestone,
  saveNutritionSettings,
  setNutritionMilestoneItems,
  setNutritionRefillPoint,
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
const GEL_ID = '0f000000-0000-4000-8000-000000000001';

let entitlements: EntitlementState;
let plan: PlanState;
let own: string;
let myProducts: MyProductRecord[];
let stored: (NutritionSettingsRecord & { participantRaceId: string })[];
let customs: CustomMilestoneRecord[];

function fakeNutrition(): NutritionRepository {
  return {
    findLatest: async (participantRaceId) => {
      const row = stored.filter((entry) => entry.participantRaceId === participantRaceId).at(-1);
      if (row === undefined) return null;
      const active = plan.plans.find((entry) => entry.record.status === 'active');
      return { ...row, onActivePlan: active?.record.id === row.racePlanId };
    },
    setProducts: async (participantRaceId, ids) => {
      stored = stored.map((entry) =>
        entry.participantRaceId === participantRaceId
          ? { ...entry, selectedProductIds: [...ids] }
          : entry,
      );
    },
    setContainers: async (participantRaceId, containers) => {
      stored = stored.map((entry) =>
        entry.participantRaceId === participantRaceId ? { ...entry, ...containers } : entry,
      );
    },
    setRefillPoint: async (participantRaceId, raceWaypointId, refill) => {
      stored = stored.map((entry) =>
        entry.participantRaceId === participantRaceId
          ? {
              ...entry,
              noRefillWaypointIds: refill
                ? entry.noRefillWaypointIds.filter((id) => id !== raceWaypointId)
                : [...entry.noRefillWaypointIds, raceWaypointId],
            }
          : entry,
      );
    },
    listCustomMilestones: async () => customs,
    setMilestoneItems: async (_participantRaceId, milestone) => {
      customs = [
        ...customs.filter((custom) => custom.stableKey !== milestone.stableKey),
        {
          stableKey: milestone.stableKey,
          items: milestone.items.map((item) => {
            const product = myProducts.find((entry) => entry.id === item.userProductId);
            return {
              userProductId: item.userProductId,
              label: product?.name ?? 'Produit',
              quantity: item.quantity,
              carbsG: product?.carbsG ?? 0,
              sodiumMg: product?.sodiumMg ?? 0,
              caffeineMg: product?.caffeineMg ?? 0,
              hydrationMl: product?.hydrationMl ?? 0,
            };
          }),
        },
      ];
    },
    resetMilestone: async (_participantRaceId, stableKey) => {
      customs = customs.filter((custom) => custom.stableKey !== stableKey);
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
        selectedProductIds: [],
        flaskCount: 2,
        flaskCapacityMl: 500,
        bladderMl: null,
        noRefillWaypointIds: [],
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
      myProducts: {
        list: async () => myProducts,
        searchCatalogue: async () => [],
        addFromCatalogue: async () => 'catalogue-copy',
        setHydration: async () => undefined,
        createCustom: async (_userId: string, product: { name: string }) => {
          myProducts.push({
            id: '0f000000-0000-4000-8000-000000000009',
            catalogueProductId: null,
            brand: null,
            servingLabel: null,
            category: 'gel',
            carbsG: 25,
            sodiumMg: 50,
            caffeineMg: 0,
            hydrationMl: 0,
            name: product.name,
          });
          return '0f000000-0000-4000-8000-000000000009';
        },
      } as unknown as MyProductsRepository,
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
  customs = [];
  myProducts = [
    {
      id: GEL_ID,
      catalogueProductId: null,
      brand: 'Test',
      name: 'Gel 25',
      category: 'gel',
      servingLabel: null,
      carbsG: 25,
      sodiumMg: 50,
      caffeineMg: 0,
      hydrationMl: 0,
    },
  ];
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

describe('produits choisis (§27, 0104)', () => {
  it('répartit les seuls produits choisis pour la stratégie', async () => {
    racePass();
    await withPlan();
    await saveNutritionSettings(context(), {
      participantRaceId: own,
      ...SETTINGS,
      waterSharePercent: 100,
      productIds: [GEL_ID],
    });

    const view = await getNutritionStrategy(context(), { participantRaceId: own });
    const items = Object.values(view.result?.allocation?.items ?? {}).flat();
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.productId === GEL_ID)).toBe(true);
    expect(view.products).toHaveLength(1);
  });

  it('sans produit choisi, le dit plutôt que d’en inventer', async () => {
    racePass();
    await withPlan();
    await saveNutritionSettings(context(), { participantRaceId: own, ...SETTINGS });

    const view = await getNutritionStrategy(context(), { participantRaceId: own });
    expect(view.result?.allocation?.warnings).toContain('no_products');
  });

  it('crée un produit personnel avec le Race Pass, et le refuse sans', async () => {
    await withPlan();
    const product = {
      participantRaceId: own,
      name: 'Purée maison',
      category: 'puree',
      carbsG: 20,
      sodiumMg: 100,
      caffeineMg: 0,
      hydrationMl: 0,
    };

    await expect(createMyNutritionProduct(context(), product)).rejects.toBeInstanceOf(
      EntitlementError,
    );
    racePass();
    await expect(createMyNutritionProduct(context(), product)).resolves.toBe(
      '0f000000-0000-4000-8000-000000000009',
    );
  });
});

describe('prise personnalisée (§57, §58, 0106)', () => {
  const BAR_ID = '0f000000-0000-4000-8000-000000000002';

  async function ready(): Promise<string> {
    racePass();
    myProducts.push({
      id: BAR_ID,
      catalogueProductId: null,
      brand: 'Test',
      name: 'Barre 40',
      category: 'bar',
      servingLabel: null,
      carbsG: 40,
      sodiumMg: 100,
      caffeineMg: 0,
      hydrationMl: 0,
    });
    await withPlan();
    await saveNutritionSettings(context(), {
      participantRaceId: own,
      ...SETTINGS,
      waterSharePercent: 100,
      productIds: [GEL_ID, BAR_ID],
    });
    const view = await getNutritionStrategy(context(), { participantRaceId: own });
    const intake = view.result?.milestones.find((milestone) => milestone.kind === 'intake');
    return intake?.stableKey ?? '';
  }

  it('garde les produits choisis par le coureur à une prise, et revient à PLUKA sur demande', async () => {
    const key = await ready();
    await setNutritionMilestoneItems(context(), {
      participantRaceId: own,
      stableKey: key,
      items: [{ userProductId: BAR_ID, quantity: 1 }],
    });

    let view = await getNutritionStrategy(context(), { participantRaceId: own });
    expect(view.result?.allocation?.items[key]?.map((item) => item.productId)).toEqual([BAR_ID]);
    expect(view.result?.allocation?.customized).toEqual([key]);

    await resetNutritionMilestone(context(), { participantRaceId: own, stableKey: key });
    view = await getNutritionStrategy(context(), { participantRaceId: own });
    expect(view.result?.allocation?.customized).toEqual([]);
  });

  it('refuse une prise inconnue, et sans Race Pass', async () => {
    const key = await ready();
    await expect(
      setNutritionMilestoneItems(context(), {
        participantRaceId: own,
        stableKey: 'intake:inconnue:1',
        items: [],
      }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      setNutritionMilestoneItems(context(RUNNER_B), {
        participantRaceId: own,
        stableKey: key,
        items: [],
      }),
    ).rejects.toBeInstanceOf(Error);
  });

  it('refuse un produit qui n’est pas dans « Mes produits »', async () => {
    const key = await ready();
    await expect(
      setNutritionMilestoneItems(context(), {
        participantRaceId: own,
        stableKey: key,
        items: [{ userProductId: '0f000000-0000-4000-8000-0000000000ff', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe('flasques (§33, §34, 0107)', () => {
  it('enregistre les contenants, et le plan de flasques les suit', async () => {
    racePass();
    await withPlan();
    await saveNutritionSettings(context(), {
      participantRaceId: own,
      ...SETTINGS,
      containers: { flaskCount: 1, flaskCapacityMl: 600, bladderMl: 1500 },
    });
    const view = await getNutritionStrategy(context(), { participantRaceId: own });
    expect(view.result?.flasks?.containers.map((container) => container.capacityMl)).toEqual([
      600, 1500,
    ]);
  });

  it('« je ne remplis pas ici » retire le ravito des points de remplissage', async () => {
    racePass();
    await withPlan();
    await saveNutritionSettings(context(), { participantRaceId: own, ...SETTINGS });
    const before = await getNutritionStrategy(context(), { participantRaceId: own });
    const aid = before.result?.flasks?.stops.find((stop) => stop.kind === 'refill');
    expect(aid).toBeDefined();

    await setNutritionRefillPoint(context(), {
      participantRaceId: own,
      raceWaypointId: aid?.pointId,
      refill: false,
    });
    const after = await getNutritionStrategy(context(), { participantRaceId: own });
    expect(after.result?.flasks?.stops.some((stop) => stop.pointId === aid?.pointId)).toBe(false);
    expect(after.result?.flasks?.skippedPointIds).toEqual([aid?.pointId]);
  });

  it('refuse les contenants hors bornes', async () => {
    racePass();
    await withPlan();
    await expect(
      saveNutritionSettings(context(), {
        participantRaceId: own,
        ...SETTINGS,
        containers: { flaskCount: 9, flaskCapacityMl: 500, bladderMl: null },
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
