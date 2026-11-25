import type {
  AidNoteRecord,
  AidStationItemRecord,
  ApplyNutritionInput,
  AssistanceAssignmentRecord,
  AssistanceItemRecord,
  AssistantRecord,
  BagRecord,
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
  applyNutritionToActivePlan,
  createMyNutritionProduct,
  placeNutritionOrphan,
  disableNutrition,
  generateRacePlan,
  getNutritionStrategy,
  resetNutritionMilestone,
  saveNutritionSettings,
  setNutritionMilestoneItems,
  setNutritionRefillPoint,
  setNutritionReserve,
  setNutritionSupplyPoint,
  setNutritionAidDrink,
  setAidNote,
  getMyAidNotes,
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
const DRINK_ID = '0f000000-0000-4000-8000-000000000002';

let entitlements: EntitlementState;
let plan: PlanState;
let own: string;
let myProducts: MyProductRecord[];
let stored: (NutritionSettingsRecord & { participantRaceId: string })[];
let customs: CustomMilestoneRecord[];
let bags: BagRecord[];
let assistants: AssistantRecord[];
let assignments: AssistanceAssignmentRecord[];
let sentItems: AssistanceItemRecord[];
let aidItems: AidStationItemRecord[];
let aidNotes: AidNoteRecord[];
let applied: ApplyNutritionInput[];

function fakeNutrition(): NutritionRepository {
  const fake: NutritionRepository = {
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
    setReserve: async (participantRaceId, reservePercent) => {
      stored = stored.map((entry) =>
        entry.participantRaceId === participantRaceId ? { ...entry, reservePercent } : entry,
      );
    },
    setAidDrink: async (participantRaceId, raceWaypointId, use) => {
      stored = stored.map((entry) =>
        entry.participantRaceId === participantRaceId
          ? {
              ...entry,
              aidDrinkWaypointIds: [
                ...entry.aidDrinkWaypointIds.filter((id) => id !== raceWaypointId),
                ...(use ? [raceWaypointId] : []),
              ],
            }
          : entry,
      );
    },
    setSupplyPoint: async (participantRaceId, raceWaypointId, source) => {
      stored = stored.map((entry) => {
        if (entry.participantRaceId !== participantRaceId) return entry;
        const choices = Object.fromEntries(
          Object.entries(entry.supplyChoices).filter(([id]) => id !== raceWaypointId),
        );
        return {
          ...entry,
          supplyChoices: source === null ? choices : { ...choices, [raceWaypointId]: source },
        };
      });
    },
    listCustomMilestones: async () => customs,
    setMilestoneItems: async (_participantRaceId, milestone) => {
      customs = [
        ...customs.filter((custom) => custom.stableKey !== milestone.stableKey),
        {
          stableKey: milestone.stableKey,
          label: milestone.label,
          elapsedSeconds: milestone.elapsedSeconds,
          distanceKm: milestone.distanceKm,
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
    // Comme 0111 : une copie de la plus récente sur la version active, une seule fois.
    applyToActivePlan: async (participantRaceId, apply) => {
      const active = activePlan(plan).record.id;
      if (stored.some((entry) => entry.racePlanId === active)) return;
      const latest = stored.filter((entry) => entry.participantRaceId === participantRaceId).at(-1);
      if (latest === undefined || latest.id !== apply.fromNutritionPlanId) {
        throw new Error('stratégie périmée');
      }
      stored.push({ ...latest, id: `nutrition-${String(stored.length + 1)}`, racePlanId: active });
      applied.push(apply);
      // Les prises restent dans la liste (un seul jeu ici) ; celles qui gardent leur place bougent.
      customs = customs.map((custom) => {
        const kept = apply.kept.find((entry) => entry.stableKey === custom.stableKey);
        return kept === undefined
          ? custom
          : {
              ...custom,
              label: kept.label,
              elapsedSeconds: kept.elapsedSeconds,
              distanceKm: kept.distanceKm,
            };
      });
    },
    placeOrphan: async (participantRaceId, orphanKey, target) => {
      if (!customs.some((custom) => custom.stableKey === orphanKey)) {
        throw new Error('prise à replacer introuvable');
      }
      customs = customs.filter((custom) => custom.stableKey !== orphanKey);
      await fake.setMilestoneItems(participantRaceId, target);
    },
    disable: async (participantRaceId) => {
      stored = stored.map((entry) =>
        entry.participantRaceId === participantRaceId ? { ...entry, enabled: false } : entry,
      );
    },
    save: async (participantRaceId, settings) => {
      // Comme 0103 : une stratégie par version du Plan ; la réenregistrer garde le reste.
      const active = activePlan(plan).record.id;
      const existing = stored.find((entry) => entry.racePlanId === active);
      if (existing !== undefined) {
        Object.assign(existing, {
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
        });
        return;
      }
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
        reservePercent: 0,
        supplyChoices: {},
        aidDrinkWaypointIds: [],
        confirmedAt: NOW.toISOString(),
      });
    },
  };
  return fake;
}

function context(userId: string = RUNNER_A): NutritionContext & PlanContext {
  const planRepositories = createFakePlanRepositories(plan);
  return {
    repositories: {
      ...planRepositories,
      ...createFakeEntitlementRepositories(entitlements),
      nutrition: fakeNutrition(),
      bags: { listBags: async () => bags },
      aidStations: { listByRace: async () => aidItems },
      aidNotes: {
        listByParticipation: async () => aidNotes,
        set: async (_participantRaceId, waypointId, kinds, note) => {
          aidNotes = [
            ...aidNotes.filter((entry) => entry.waypointId !== waypointId),
            ...(kinds.length === 0 && note === null ? [] : [{ waypointId, kinds, note }]),
          ];
        },
      },
      assistance: {
        listAssistants: async () => assistants,
        listAssignments: async () => assignments,
        listItems: async () => sentItems,
      },
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
  bags = [];
  assistants = [];
  assignments = [];
  sentItems = [];
  aidItems = [];
  aidNotes = [];
  applied = [];
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

describe('le Plan change — valider sa stratégie (§61 à §66, N25 à N28 ; décisions du 2026-11-23)', () => {
  /**
   * Une stratégie sur un Plan de 4 h, avec deux prises modifiées : la première
   * après le ravito (son heure suivra l'arrivée au ravito), et la dernière
   * avant le ravito — sur un Plan de 3 h, la section compte une prise de moins.
   */
  async function changedPlan(): Promise<{ kept: string; orphan: string; start: string }> {
    racePass();
    await withPlan(4);
    await saveNutritionSettings(context(), {
      participantRaceId: own,
      ...SETTINGS,
      waterSharePercent: 100,
      productIds: [GEL_ID],
    });
    await setNutritionReserve(context(), { participantRaceId: own, reservePercent: 10 });

    const view = await getNutritionStrategy(context(), { participantRaceId: own });
    const [first] = view.result?.sections ?? [];
    const start = first?.fromPointId ?? '';
    const aid = first?.toPointId ?? '';
    const leg = (view.result?.milestones ?? []).filter((milestone) =>
      milestone.stableKey.startsWith(`intake:${start}:`),
    );
    const orphan = leg.at(-1)?.stableKey ?? '';
    const kept = `intake:${aid}:1`;

    await setNutritionMilestoneItems(context(), {
      participantRaceId: own,
      stableKey: kept,
      items: [{ userProductId: GEL_ID, quantity: 2 }],
    });
    await setNutritionMilestoneItems(context(), {
      participantRaceId: own,
      stableKey: orphan,
      items: [{ userProductId: GEL_ID, quantity: 2 }],
    });

    await withPlan(3);
    return { kept, orphan, start };
  }

  it('la stratégie se lit sur le nouveau Plan, avec ce qui change, et attend la validation', async () => {
    const { kept, orphan } = await changedPlan();

    const view = await getNutritionStrategy(context(), { participantRaceId: own });

    expect(view.state).toBe('ready');
    expect(view.canEdit).toBe(false);
    expect(view.review?.canApply).toBe(true);
    // N25 : l'heure de la prise gardée a bougé, avant et après.
    expect(view.review?.kept.map((line) => [line.stableKey, line.shifted])).toEqual([[kept, true]]);
    const [line] = view.review?.kept ?? [];
    expect(line?.after.elapsedSeconds).toBeLessThan(line?.before.elapsedSeconds ?? 0);
    // N27 : la prise sans place garde ses 2 gels.
    expect(view.review?.orphaned.map((entry) => [entry.stableKey, entry.items])).toEqual([
      [orphan, [{ userProductId: GEL_ID, label: 'Gel 25', quantity: 2 }]],
    ]);
    expect(view.toPlace).toEqual([]);
  });

  it('rien ne se modifie avant validation : une stratégie neuve perdrait les réglages', async () => {
    const { kept } = await changedPlan();
    const invalid = { code: 'invalid_state' };

    await expect(
      setNutritionReserve(context(), { participantRaceId: own, reservePercent: 20 }),
    ).rejects.toMatchObject(invalid);
    await expect(
      setNutritionMilestoneItems(context(), { participantRaceId: own, stableKey: kept, items: [] }),
    ).rejects.toMatchObject(invalid);
    await expect(
      resetNutritionMilestone(context(), { participantRaceId: own, stableKey: kept }),
    ).rejects.toMatchObject(invalid);
    await expect(
      saveNutritionSettings(context(), { participantRaceId: own, ...SETTINGS }),
    ).rejects.toMatchObject(invalid);
    expect(stored).toHaveLength(1);
  });

  it('valider reporte tout : réglages, prises gardées à leur nouvelle heure, prise sans place', async () => {
    const { kept, orphan } = await changedPlan();

    await applyNutritionToActivePlan(context(), { participantRaceId: own });
    const view = await getNutritionStrategy(context(), { participantRaceId: own });

    expect(view.review).toBeNull();
    expect(view.canEdit).toBe(true);
    expect(view.settings?.reservePercent).toBe(10);
    expect(view.result?.allocation?.customized).toEqual([kept]);
    expect(view.result?.allocation?.items[kept]?.map((item) => item.quantity)).toEqual([2]);
    expect(view.toPlace.map((entry) => [entry.stableKey, entry.placeable])).toEqual([
      [orphan, true],
    ]);
    // Le diff validé : la prise gardée, son heure avant et après ; la prise sans place.
    expect(applied[0]?.diff).toMatchObject({
      orphaned: [orphan],
      warnings: ['PRODUCT_REASSIGNMENT_REQUIRED'],
    });
    expect(applied[0]?.kept.map((entry) => entry.stableKey)).toEqual([kept]);
  });

  it('un nouvel essai ne refait rien', async () => {
    await changedPlan();

    await applyNutritionToActivePlan(context(), { participantRaceId: own });
    await applyNutritionToActivePlan(context(), { participantRaceId: own });

    expect(stored).toHaveLength(2);
    expect(applied).toHaveLength(1);
  });

  it('valider demande d’être le coureur', async () => {
    await changedPlan();

    await expect(
      applyNutritionToActivePlan(context(RUNNER_B), { participantRaceId: own }),
    ).rejects.toBeInstanceOf(Error);
    expect(applied).toEqual([]);
  });

  it('placer la prise sans place : ses gels s’ajoutent à la prise choisie', async () => {
    const { orphan, start } = await changedPlan();
    await applyNutritionToActivePlan(context(), { participantRaceId: own });
    const target = `intake:${start}:1`;
    const before = (await getNutritionStrategy(context(), { participantRaceId: own })).result
      ?.allocation?.items[target];

    await placeNutritionOrphan(context(), {
      participantRaceId: own,
      stableKey: orphan,
      targetKey: target,
    });

    const view = await getNutritionStrategy(context(), { participantRaceId: own });
    expect(view.toPlace).toEqual([]);
    const gels = (items: typeof before) =>
      (items ?? [])
        .filter((item) => item.productId === GEL_ID)
        .reduce((sum, item) => sum + item.quantity, 0);
    expect(gels(view.result?.allocation?.items[target])).toBe(gels(before) + 2);
    expect(view.result?.allocation?.customized).toContain(target);
  });

  it('rendre à PLUKA : la prise sans place est oubliée, sur demande du coureur', async () => {
    const { orphan } = await changedPlan();
    await applyNutritionToActivePlan(context(), { participantRaceId: own });

    await resetNutritionMilestone(context(), { participantRaceId: own, stableKey: orphan });

    expect((await getNutritionStrategy(context(), { participantRaceId: own })).toPlace).toEqual([]);
  });

  it('refuse de placer avant validation, une prise inconnue, ou sur l’arrivée', async () => {
    const { orphan, start } = await changedPlan();
    const invalid = { code: 'invalid_state' };

    await expect(
      placeNutritionOrphan(context(), {
        participantRaceId: own,
        stableKey: orphan,
        targetKey: `intake:${start}:1`,
      }),
    ).rejects.toMatchObject(invalid);

    await applyNutritionToActivePlan(context(), { participantRaceId: own });
    const finish = (
      await getNutritionStrategy(context(), { participantRaceId: own })
    ).result?.milestones.at(-1);
    await expect(
      placeNutritionOrphan(context(), {
        participantRaceId: own,
        stableKey: 'intake:inconnue:1',
        targetKey: `intake:${start}:1`,
      }),
    ).rejects.toMatchObject(invalid);
    await expect(
      placeNutritionOrphan(context(), {
        participantRaceId: own,
        stableKey: orphan,
        targetKey: finish?.stableKey ?? '',
      }),
    ).rejects.toMatchObject(invalid);
  });

  it('une Nutrition désactivée sur un ancien Plan se réactive avec ses réglages', async () => {
    await changedPlan();
    await disableNutrition(context(), { participantRaceId: own });

    await saveNutritionSettings(context(), { participantRaceId: own, ...SETTINGS });

    const view = await getNutritionStrategy(context(), { participantRaceId: own });
    expect(view.state).toBe('ready');
    expect(view.review).toBeNull();
    expect(view.settings?.reservePercent).toBe(10);
    expect(view.toPlace).toHaveLength(1);
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

describe('à préparer pour cette course (§49 à §56, 0108)', () => {
  /** Le ravitaillement du km 5 de la fixture, avec des gels à prendre après lui. */
  async function ready(): Promise<string> {
    racePass();
    await withPlan();
    await saveNutritionSettings(context(), {
      participantRaceId: own,
      ...SETTINGS,
      productIds: [GEL_ID],
    });
    const view = await getNutritionStrategy(context(), { participantRaceId: own });
    const aid = view.preparation?.points[0];
    expect(aid).toBeDefined();
    return aid?.pointId ?? '';
  }

  it('sans sac ni Assistance, tout part du départ ; la réserve s’ajoute sans être consommée', async () => {
    await ready();
    await setNutritionReserve(context(), { participantRaceId: own, reservePercent: 10 });
    const view = await getNutritionStrategy(context(), { participantRaceId: own });
    const gel = view.preparation?.plan.products.find((row) => row.productId === GEL_ID);

    expect(view.preparation?.points[0]).toMatchObject({ auto: 'start', source: 'start' });
    expect(gel?.reserve).toBe(Math.ceil((gel?.planned ?? 0) * 0.1));
    expect(gel?.start).toBe(gel?.total);
    expect(view.preparation?.plan.reservePercent).toBe(10);
  });

  it('un rendez-vous d’Assistance au ravito : ses produits viennent de l’accompagnant', async () => {
    const aidId = await ready();
    assistants = [{ id: 'marie', firstName: 'Marie', lastName: null, phone: null }];
    assignments = [{ id: 'rdv', assistantId: 'marie', raceWaypointId: aidId, instructions: null }];
    bags = [{ id: 'sac', bagType: 'drop_bag', name: 'Drop bag', raceWaypointId: aidId, items: [] }];

    const view = await getNutritionStrategy(context(), { participantRaceId: own });
    expect(view.preparation?.points[0]).toMatchObject({
      options: ['start', 'bag', 'assistance'],
      auto: 'assistance',
      source: 'assistance',
      assistants: ['Marie'],
      bagName: 'Drop bag',
    });
  });

  it('le coureur choisit le drop bag ; s’il le supprime, ses produits restent, sans place', async () => {
    const aidId = await ready();
    bags = [{ id: 'sac', bagType: 'drop_bag', name: 'Drop bag', raceWaypointId: aidId, items: [] }];
    await setNutritionSupplyPoint(context(), {
      participantRaceId: own,
      raceWaypointId: aidId,
      source: 'bag',
    });
    const chosen = await getNutritionStrategy(context(), { participantRaceId: own });
    expect(chosen.preparation?.points[0]).toMatchObject({ chosen: 'bag', source: 'bag' });

    bags = [];
    const orphan = await getNutritionStrategy(context(), { participantRaceId: own });
    const gel = orphan.preparation?.plan.products.find((row) => row.productId === GEL_ID);
    expect(orphan.preparation?.points[0]).toMatchObject({ chosen: 'bag', source: 'unassigned' });
    expect((gel?.start ?? 0) + (gel?.unassigned ?? 0)).toBe(gel?.total);
  });

  it('régler la réserve ou la source demande le Race Pass', async () => {
    await withPlan();
    await expect(
      setNutritionReserve(context(), { participantRaceId: own, reservePercent: 10 }),
    ).rejects.toBeInstanceOf(EntitlementError);
    await expect(
      setNutritionSupplyPoint(context(), {
        participantRaceId: own,
        raceWaypointId: '0a000000-0000-4000-8000-000000000001',
        source: null,
      }),
    ).rejects.toBeInstanceOf(EntitlementError);
  });

  it('refuse une réserve hors de 0 à 100 %, et une source inconnue', async () => {
    const aidId = await ready();
    await expect(
      setNutritionReserve(context(), { participantRaceId: own, reservePercent: 150 }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      setNutritionSupplyPoint(context(), {
        participantRaceId: own,
        raceWaypointId: aidId,
        source: 'poche',
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe('envoyer à l’accompagnant — l’état de la liste (§55, 0109)', () => {
  async function withAlice(): Promise<string> {
    racePass();
    await withPlan();
    await saveNutritionSettings(context(), {
      participantRaceId: own,
      ...SETTINGS,
      productIds: [GEL_ID],
    });
    const before = await getNutritionStrategy(context(), { participantRaceId: own });
    const aidId = before.preparation?.points[0]?.pointId ?? '';
    assistants = [{ id: 'alice', firstName: 'Alice', lastName: null, phone: null }];
    assignments = [{ id: 'rdv', assistantId: 'alice', raceWaypointId: aidId, instructions: null }];
    return aidId;
  }

  const sent = (labels: readonly string[]): AssistanceItemRecord[] =>
    labels.map((label, index) => ({
      id: `envoi-${String(index)}`,
      assignmentId: 'rdv',
      label,
      kind: 'nutrition',
      createdAt: `2026-03-01T10:00:0${String(index)}.000Z`,
    }));

  it('pas encore envoyé : la stratégie prévoit des produits qu’Alice ne voit pas', async () => {
    await withAlice();
    const view = await getNutritionStrategy(context(), { participantRaceId: own });
    expect(view.preparation?.sends).toEqual([
      expect.objectContaining({ assistant: 'Alice', status: 'unsent', sentAt: null }),
    ]);
  });

  it('à jour quand la copie est celle du calcul ; périmée dès que la stratégie change', async () => {
    await withAlice();
    const view = await getNutritionStrategy(context(), { participantRaceId: own });
    const gels = view.preparation?.plan.points[1]?.items[0]?.quantity ?? 0;
    expect(gels).toBeGreaterThan(0);
    sentItems = sent([`${String(gels)} × Test Gel 25`]);
    const upToDate = await getNutritionStrategy(context(), { participantRaceId: own });
    expect(upToDate.preparation?.sends[0]?.status).toBe('sent');

    sentItems = sent([`${String(gels + 1)} × Test Gel 25`]);
    const stale = await getNutritionStrategy(context(), { participantRaceId: own });
    expect(stale.preparation?.sends[0]).toMatchObject({
      status: 'stale',
      sentAt: '2026-03-01T10:00:00.000Z',
      nothingToGive: false,
    });
  });

  it('périmée aussi quand plus rien n’est prévu chez Alice, mais qu’elle a encore une liste', async () => {
    const aidId = await withAlice();
    sentItems = sent(['2 × Test Gel 25']);
    await setNutritionSupplyPoint(context(), {
      participantRaceId: own,
      raceWaypointId: aidId,
      source: 'start',
    });
    const view = await getNutritionStrategy(context(), { participantRaceId: own });
    expect(view.preparation?.sends[0]).toMatchObject({ status: 'stale', nothingToGive: true });
  });
});

describe('ravitaillements — contenu annoncé, note du coureur, boisson du ravito (§32, 0110)', () => {
  /** Une stratégie avec une boisson d'effort, et le ravito de la fixture. */
  async function withDrink(): Promise<string> {
    racePass();
    await withPlan();
    myProducts.push({
      id: DRINK_ID,
      catalogueProductId: null,
      brand: null,
      name: 'Boisson 500',
      category: 'drink',
      servingLabel: null,
      carbsG: 40,
      sodiumMg: 300,
      caffeineMg: 0,
      hydrationMl: 500,
    });
    await saveNutritionSettings(context(), {
      participantRaceId: own,
      ...SETTINGS,
      productIds: [GEL_ID, DRINK_ID],
    });
    const view = await getNutritionStrategy(context(), { participantRaceId: own });
    return view.aid[0]?.pointId ?? '';
  }

  it('sans contenu annoncé, rien n’est supposé', async () => {
    await withDrink();
    const view = await getNutritionStrategy(context(), { participantRaceId: own });
    expect(view.aid[0]).toMatchObject({
      official: [],
      note: null,
      drink: null,
      usesAidDrink: false,
    });
  });

  it('boisson annoncée et choisie : le remplissage se fait sur place, sans dose', async () => {
    const aidId = await withDrink();
    aidItems = [
      { waypointId: aidId, kind: 'water', label: 'Eau', sortOrder: 0 },
      { waypointId: aidId, kind: 'sports_drink', label: 'Boisson d’effort', sortOrder: 1 },
    ];
    const before = await getNutritionStrategy(context(), { participantRaceId: own });
    expect(before.aid[0]).toMatchObject({ drink: 'official', usesAidDrink: false });

    await setNutritionAidDrink(context(), {
      participantRaceId: own,
      raceWaypointId: aidId,
      use: true,
    });
    const after = await getNutritionStrategy(context(), { participantRaceId: own });
    const stop = after.result?.flasks?.stops.find((entry) => entry.pointId === aidId);
    expect(after.aid[0]?.usesAidDrink).toBe(true);
    expect(stop?.aidDrink).toBe(true);
    expect(stop?.actions.every((action) => action.doses === 0)).toBe(true);
  });

  it('un choix sans boisson annoncée n’a pas d’effet', async () => {
    const aidId = await withDrink();
    aidItems = [{ waypointId: aidId, kind: 'water', label: 'Eau', sortOrder: 0 }];
    await setNutritionAidDrink(context(), {
      participantRaceId: own,
      raceWaypointId: aidId,
      use: true,
    });
    const view = await getNutritionStrategy(context(), { participantRaceId: own });
    expect(view.aid[0]).toMatchObject({ drink: null, usesAidDrink: false });
    expect(view.result?.flasks?.stops.some((entry) => entry.aidDrink)).toBe(false);
  });

  it('sans rien d’annoncé, la note du coureur compte — et se lit pour la Course', async () => {
    const aidId = await withDrink();
    await setAidNote(context(), {
      participantRaceId: own,
      raceWaypointId: aidId,
      kinds: ['water', 'sports_drink'],
      note: 'D’après l’édition 2025',
    });
    const view = await getNutritionStrategy(context(), { participantRaceId: own });
    expect(view.aid[0]).toMatchObject({
      official: [],
      note: { kinds: ['water', 'sports_drink'], note: 'D’après l’édition 2025' },
      drink: 'note',
    });
    expect(await getMyAidNotes(context(), { participantRaceId: own })).toHaveLength(1);
  });

  it('noter ou choisir la boisson du ravito demande le Race Pass', async () => {
    await withPlan();
    await expect(
      setAidNote(context(), {
        participantRaceId: own,
        raceWaypointId: '0a000000-0000-4000-8000-000000000001',
        kinds: ['water'],
        note: null,
      }),
    ).rejects.toBeInstanceOf(EntitlementError);
    await expect(
      setNutritionAidDrink(context(), {
        participantRaceId: own,
        raceWaypointId: '0a000000-0000-4000-8000-000000000001',
        use: true,
      }),
    ).rejects.toBeInstanceOf(EntitlementError);
  });
});
