import { beforeEach, describe, expect, it } from 'vitest';

import {
  changePlanTarget,
  DomainError,
  EntitlementError,
  generateRacePlan,
  getActivePlan,
  listPlanVersions,
  lockPlanWaypoint,
  preserveCurrentPlan,
  previewPlan,
  rebalancePlanToTarget,
  removePlanSegmentOverride,
  resetPlanScope,
  unlockPlanWaypoint,
  updatePlanSegmentDuration,
  updatePlanStop,
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
  type ParticipationState,
} from './fixtures/participation-repositories.js';
import {
  activePlan,
  createFakePlanRepositories,
  planBaseState,
  SEG0,
  WP1,
  type PlanState,
} from './fixtures/plan-repositories.js';

/**
 * Use cases du Plan — docs/engines/PLAN_ENGINE.md §21, §22, §36, §37, §63.
 *
 * Le parcours de test est celui de P01 : dix kilomètres plats en deux segments
 * de 5 km. Pour un objectif d'une heure, le moteur rend 1756 s puis 1844 s —
 * les durées restent donc calculables à la main jusque dans les use cases.
 */

const NOW = new Date('2026-03-01T10:00:00.000Z');
const TARGET = 3600;
const D0 = 1756;
const D1 = 1844;

let participation: ParticipationState;
let entitlements: EntitlementState;
let plan: PlanState;
let ownParticipation: string;
let foreignParticipation: string;

function contextFor(userId: string): PlanContext {
  const planRepositories = createFakePlanRepositories(plan);
  const entitlementRepositories = createFakeEntitlementRepositories(entitlements);

  return {
    repositories: { ...planRepositories, ...entitlementRepositories },
    actor: { userId },
    now: () => NOW,
  };
}

async function expectDomainError(promise: Promise<unknown>, code: DomainError['code']) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );

  expect(error, 'la commande aurait dû échouer').toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}

/** Un Plan initial existant, point de départ de la plupart des scénarios. */
async function withInitialPlan(): Promise<void> {
  await generateRacePlan(contextFor(RUNNER_A), {
    participantRaceId: ownParticipation,
    targetDurationSeconds: TARGET,
  });
}

/** Race Pass sur la participation : les commandes d'édition sont premium (§45). */
function grantRacePass(): void {
  grantEntitlement(entitlements, {
    kind: 'race_pass',
    userId: RUNNER_A,
    participantRaceId: ownParticipation,
  });
}

beforeEach(() => {
  participation = participationBaseState();

  ownParticipation = seedParticipation(participation, {
    userId: RUNNER_A,
    raceId: PUBLIC_RACE,
  }).id;
  foreignParticipation = seedParticipation(participation, {
    userId: RUNNER_B,
    raceId: PUBLIC_RACE,
  }).id;

  entitlements = entitlementBaseState(participation);
  plan = planBaseState(participation, PUBLIC_RACE);
});

// ============================================================
// Génération initiale et versionnement
// ============================================================

describe('generateRacePlan', () => {
  it('crée la version 1, active, terminant sur l’objectif', async () => {
    const outcome = await generateRacePlan(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      targetDurationSeconds: TARGET,
    });

    expect(outcome.result.status).toBe('ok');
    expect(outcome.result.finishElapsedSeconds).toBe(TARGET);
    expect(outcome.persisted).toEqual({ racePlanId: 'plan-1', version: 1 });
    expect(activePlan(plan).record.version).toBe(1);
  });

  it('persiste les durées que le moteur a calculées', async () => {
    await withInitialPlan();

    expect(activePlan(plan).segments.map((segment) => segment.plannedDurationSeconds)).toEqual([
      D0,
      D1,
    ]);
    expect(activePlan(plan).waypoints.map((waypoint) => waypoint.plannedElapsedSeconds)).toEqual([
      0,
      D0,
      TARGET,
    ]);
  });

  it('reste accessible au Free : le Plan initial n’est pas premium (§41, §57)', async () => {
    // Aucun entitlement n'a été accordé dans ce test.
    expect(entitlements.entitlements).toEqual([]);

    await expect(
      generateRacePlan(contextFor(RUNNER_A), {
        participantRaceId: ownParticipation,
        targetDurationSeconds: TARGET,
      }),
    ).resolves.toMatchObject({ persisted: { version: 1 } });
  });

  it('refuse un parcours dont le D+ mesuré manque — §9, §9.0', async () => {
    // Le défaut d'origine : une géométrie d'avant 0026 portait `null`, et le
    // contrôle d'écart de §9 le lisait comme « aucun écart détecté ». Il n'y a
    // rien à dégrader — il n'y a rien à comparer.
    plan.courseElevationGainM = null;

    const error = await generateRacePlan(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      targetDurationSeconds: TARGET,
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('invalid_state');
    expect((error as DomainError).details['code']).toBe('GPX_GAIN_MISSING');
  });

  it('nomme le refus autrement que l’absence de parcours', async () => {
    // Deux incomplétudes distinctes, deux messages : « pas encore de parcours
    // prétraité » ne dit pas ce qu'il faut corriger quand la trace est là.
    const refusal = async (): Promise<DomainError> =>
      generateRacePlan(contextFor(RUNNER_A), {
        participantRaceId: ownParticipation,
        targetDurationSeconds: TARGET,
      }).then(
        () => {
          throw new Error('un refus était attendu');
        },
        (thrown: unknown) => thrown as DomainError,
      );

    plan.courseElevationGainM = null;
    const sansMesure = await refusal();

    plan.courseGeometryId = null;
    const sansParcours = await refusal();

    expect(sansMesure.message).not.toBe(sansParcours.message);
    expect(sansParcours.details['code']).toBeUndefined();
  });

  it('laisse passer un parcours mesuré', async () => {
    // Contrepartie : la porte ne doit pas refuser ce qui est complet. Le
    // rattrapage de 0027 comble la valeur, et le parcours redevient éligible.
    plan.courseElevationGainM = 4600;

    await expect(
      generateRacePlan(contextFor(RUNNER_A), {
        participantRaceId: ownParticipation,
        targetDurationSeconds: TARGET,
      }),
    ).resolves.toMatchObject({ persisted: { version: 1 } });
  });

  it('archive la version précédente : une seule reste active (§36)', async () => {
    await withInitialPlan();
    await generateRacePlan(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      targetDurationSeconds: 5400,
    });

    const versions = await listPlanVersions(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
    });

    expect(versions.map((version) => version.version)).toEqual([1, 2]);
    expect(versions.map((version) => version.status)).toEqual(['superseded', 'active']);
  });

  it('conserve l’objectif initial d’une version à l’autre (§27)', async () => {
    await withInitialPlan();
    await generateRacePlan(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      targetDurationSeconds: 5400,
    });

    const current = activePlan(plan).record;

    expect(current.targetDurationSeconds).toBe(5400);
    expect(current.initialTargetDurationSeconds).toBe(TARGET);
  });

  it('rattache les versions de faits dont l’entrée dépend (§38.5)', async () => {
    await withInitialPlan();

    expect(activePlan(plan).dependencies).toEqual([
      { raceFactVersionId: 'fv-cutoff-1', dependencyType: 'cutoff', dependencyKey: 'barriere-col' },
      { raceFactVersionId: 'fv-wp-1', dependencyType: 'waypoint', dependencyKey: 'col-du-test' },
    ]);
  });

  it('n’accepte aucune configuration moteur venue de l’appelant (§14)', async () => {
    await expect(
      generateRacePlan(contextFor(RUNNER_A), {
        participantRaceId: ownParticipation,
        targetDurationSeconds: TARGET,
        engineConfig: { engineVersion: 'maison' },
      }),
    ).rejects.toThrow();
  });

  it('refuse une participation qui n’est pas la sienne (03_PRIVACY_RLS §120)', async () => {
    await expectDomainError(
      generateRacePlan(contextFor(RUNNER_A), {
        participantRaceId: foreignParticipation,
        targetDurationSeconds: TARGET,
      }),
      'not_found',
    );

    expect(plan.plans).toEqual([]);
  });

  it('refuse une course sans parcours prétraité', async () => {
    plan.courseGeometryId = null;

    await expectDomainError(
      generateRacePlan(contextFor(RUNNER_A), {
        participantRaceId: ownParticipation,
        targetDurationSeconds: TARGET,
      }),
      'invalid_state',
    );
  });
});

// ============================================================
// Les deux modes de §22, deux commandes
// ============================================================

describe('§22 — deux modes, deux commandes', () => {
  beforeEach(async () => {
    await withInitialPlan();
    grantRacePass();
  });

  it('rebalancePlanToTarget ramène l’arrivée sur l’objectif', async () => {
    await updatePlanSegmentDuration(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      raceSegmentId: SEG0,
      durationSeconds: D0 + 600,
      mode: 'preserve_manual_changes',
    });

    expect(activePlan(plan).record.plannedFinishDatetime).not.toBeNull();

    const outcome = await rebalancePlanToTarget(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
    });

    expect(outcome.result.finishElapsedSeconds).toBe(TARGET);
    // Le segment imposé n'a pas bougé ; le flexible a absorbé le delta.
    expect(outcome.result.planSegments.map((segment) => segment.plannedDurationSeconds)).toEqual([
      D0 + 600,
      TARGET - (D0 + 600),
    ]);
  });

  it('preserveCurrentPlan laisse l’arrivée dériver', async () => {
    await updatePlanSegmentDuration(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      raceSegmentId: SEG0,
      durationSeconds: D0 + 600,
      mode: 'rebalance_to_target',
    });

    const outcome = await preserveCurrentPlan(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
    });

    expect(outcome.result.finishElapsedSeconds).toBe(TARGET + 600);
    // §27 : l'objectif ne bouge pas pour autant.
    expect(outcome.result.targetDurationSeconds).toBe(TARGET);
    expect(activePlan(plan).record.targetDurationSeconds).toBe(TARGET);
  });

  it('sont deux commandes distinctes, aux droits distincts', async () => {
    // Les deux exigent `plan.recalculate`, que le Free n'a pas (§57).
    entitlements.entitlements = [];

    await expect(
      rebalancePlanToTarget(contextFor(RUNNER_A), { participantRaceId: ownParticipation }),
    ).rejects.toBeInstanceOf(EntitlementError);
    await expect(
      preserveCurrentPlan(contextFor(RUNNER_A), { participantRaceId: ownParticipation }),
    ).rejects.toBeInstanceOf(EntitlementError);
  });

  it('n’acceptent aucun mode en paramètre : le nom de la commande le porte', async () => {
    await expect(
      rebalancePlanToTarget(contextFor(RUNNER_A), {
        participantRaceId: ownParticipation,
        mode: 'preserve_manual_changes',
      }),
    ).rejects.toThrow();
  });
});

// ============================================================
// Éditions — §21, §24
// ============================================================

describe('éditions du Plan (§21)', () => {
  beforeEach(async () => {
    await withInitialPlan();
    grantRacePass();
  });

  it('impose une durée de segment et la marque manuelle (§21.2)', async () => {
    await updatePlanSegmentDuration(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      raceSegmentId: SEG0,
      durationSeconds: 2000,
      mode: 'rebalance_to_target',
    });

    const segments = activePlan(plan).segments;

    expect(segments[0]).toMatchObject({ plannedDurationSeconds: 2000, manualOverride: true });
    expect(segments[1]).toMatchObject({ plannedDurationSeconds: 1600, manualOverride: false });
  });

  it('ne l’écrase pas lors d’un changement d’objectif (§24, P17)', async () => {
    await updatePlanSegmentDuration(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      raceSegmentId: SEG0,
      durationSeconds: 2000,
      mode: 'rebalance_to_target',
    });

    await changePlanTarget(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      targetDurationSeconds: 5400,
    });

    const segments = activePlan(plan).segments;

    expect(segments[0]).toMatchObject({ plannedDurationSeconds: 2000, manualOverride: true });
    expect(segments[1]?.plannedDurationSeconds).toBe(5400 - 2000);
  });

  it('rend le segment flexible quand l’override est retiré (§21.6)', async () => {
    await updatePlanSegmentDuration(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      raceSegmentId: SEG0,
      durationSeconds: 2000,
      mode: 'rebalance_to_target',
    });

    await removePlanSegmentOverride(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      raceSegmentId: SEG0,
      mode: 'rebalance_to_target',
    });

    expect(activePlan(plan).segments.map((segment) => segment.plannedDurationSeconds)).toEqual([
      D0,
      D1,
    ]);
    expect(activePlan(plan).segments[0]?.manualOverride).toBe(false);
  });

  it('enregistre un arrêt comme manuel, et le conserve (§21.3, §21.6)', async () => {
    await updatePlanStop(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      raceWaypointId: WP1,
      durationSeconds: 600,
      mode: 'rebalance_to_target',
    });

    const waypoint = activePlan(plan).waypoints[1];

    expect(waypoint).toMatchObject({ stopDurationSeconds: 600, stopOrigin: 'manual' });
    // Budget mobile réduit de dix minutes, arrivée toujours sur l'objectif.
    expect(activePlan(plan).waypoints[2]?.plannedElapsedSeconds).toBe(TARGET);
  });

  it('verrouille puis déverrouille un waypoint (§21.4, §21.5)', async () => {
    await lockPlanWaypoint(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      raceWaypointId: WP1,
      arrivalElapsedSeconds: 1500,
      mode: 'rebalance_to_target',
    });

    expect(activePlan(plan).waypoints[1]).toMatchObject({
      plannedElapsedSeconds: 1500,
      isLocked: true,
      lockedElapsedSeconds: 1500,
    });

    await unlockPlanWaypoint(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      raceWaypointId: WP1,
      mode: 'rebalance_to_target',
    });

    expect(activePlan(plan).waypoints[1]).toMatchObject({
      plannedElapsedSeconds: D0,
      isLocked: false,
      lockedElapsedSeconds: null,
    });
  });

  it('ne réinitialise que le périmètre demandé (§21.6)', async () => {
    await updatePlanSegmentDuration(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      raceSegmentId: SEG0,
      durationSeconds: 2000,
      mode: 'rebalance_to_target',
    });
    await updatePlanStop(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      raceWaypointId: WP1,
      durationSeconds: 300,
      mode: 'rebalance_to_target',
    });

    await resetPlanScope(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      scope: { kind: 'segment', raceSegmentId: SEG0 },
      mode: 'rebalance_to_target',
    });

    // L'override est parti, l'arrêt manuel est resté.
    expect(activePlan(plan).segments[0]?.manualOverride).toBe(false);
    expect(activePlan(plan).waypoints[1]?.stopDurationSeconds).toBe(300);
  });

  it('efface toutes les personnalisations quand « all » est demandé nommément', async () => {
    await updatePlanSegmentDuration(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      raceSegmentId: SEG0,
      durationSeconds: 2000,
      mode: 'rebalance_to_target',
    });
    await lockPlanWaypoint(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      raceWaypointId: WP1,
      arrivalElapsedSeconds: 1500,
      mode: 'rebalance_to_target',
    });

    await resetPlanScope(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      scope: { kind: 'all' },
      mode: 'rebalance_to_target',
    });

    const current = activePlan(plan);

    expect(current.segments.every((segment) => !segment.manualOverride)).toBe(true);
    expect(current.waypoints.every((waypoint) => !waypoint.isLocked)).toBe(true);
    // L'objectif reste celui du coureur : ce n'est pas une personnalisation.
    expect(current.record.targetDurationSeconds).toBe(TARGET);
  });

  it('exige un Plan actif avant toute édition', async () => {
    plan.plans = [];

    await expectDomainError(
      changePlanTarget(contextFor(RUNNER_A), {
        participantRaceId: ownParticipation,
        targetDurationSeconds: 5400,
      }),
      'invalid_state',
    );
  });
});

// ============================================================
// Conflits et preview — §37, §63
// ============================================================

describe('rien n’est persisté avant validation (§37, §63)', () => {
  beforeEach(async () => {
    await withInitialPlan();
    grantRacePass();
  });

  it('ne crée aucune version quand le calcul est en conflit', async () => {
    // Ancre à 600 s alors qu'un segment imposé en demande 1200.
    await updatePlanSegmentDuration(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      raceSegmentId: SEG0,
      durationSeconds: 1200,
      mode: 'rebalance_to_target',
    });

    const before = plan.plans.length;
    const outcome = await lockPlanWaypoint(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      raceWaypointId: WP1,
      arrivalElapsedSeconds: 600,
      mode: 'rebalance_to_target',
    });

    expect(outcome.result.status).toBe('error');
    expect(outcome.result.conflicts.map((issue) => issue.code)).toContain(
      'FIXED_DURATION_CONFLICT',
    );
    expect(outcome.persisted).toBeNull();
    expect(plan.plans).toHaveLength(before);
  });

  it('rend l’explication du conflit plutôt que de retirer la contrainte (§24)', async () => {
    await updatePlanSegmentDuration(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      raceSegmentId: SEG0,
      durationSeconds: 1200,
      mode: 'rebalance_to_target',
    });

    const outcome = await lockPlanWaypoint(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      raceWaypointId: WP1,
      arrivalElapsedSeconds: 600,
      mode: 'rebalance_to_target',
    });

    expect(outcome.result.conflicts[0]?.waypointId).toBe(WP1);
    // L'override est toujours là, dans le Plan actif comme dans le résultat.
    expect(activePlan(plan).segments[0]?.manualOverride).toBe(true);
  });

  it('calcule une preview sans rien écrire (§37)', async () => {
    const before = plan.plans.length;

    const outcome = await previewPlan(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      targetDurationSeconds: 7200,
    });

    expect(outcome.result.finishElapsedSeconds).toBe(7200);
    expect(outcome.persisted).toBeNull();
    expect(plan.plans).toHaveLength(before);
    expect(activePlan(plan).record.targetDurationSeconds).toBe(TARGET);
  });
});

// ============================================================
// Droits — §45
// ============================================================

describe('entitlements (§45)', () => {
  beforeEach(withInitialPlan);

  it('refuse une édition au Free, sans masquer le refus derrière l’UI', async () => {
    const error = await changePlanTarget(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
      targetDurationSeconds: 5400,
    }).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(EntitlementError);
    expect((error as EntitlementError).code).toBe('ENTITLEMENT_REQUIRED');
    expect(activePlan(plan).record.targetDurationSeconds).toBe(TARGET);
  });

  it('l’autorise dès qu’un Race Pass couvre la participation', async () => {
    grantRacePass();

    await expect(
      changePlanTarget(contextFor(RUNNER_A), {
        participantRaceId: ownParticipation,
        targetDurationSeconds: 5400,
      }),
    ).resolves.toMatchObject({ persisted: { version: 2 } });
  });

  it('laisse le Free lire son Plan (§41)', async () => {
    const view = await getActivePlan(contextFor(RUNNER_A), {
      participantRaceId: ownParticipation,
    });

    expect(view.plan.version).toBe(1);
    expect(view.segments).toHaveLength(2);
    expect(view.dependencies).toHaveLength(2);
  });

  it('ne laisse pas lire le Plan d’un autre coureur', async () => {
    await expectDomainError(
      getActivePlan(contextFor(RUNNER_A), { participantRaceId: foreignParticipation }),
      'not_found',
    );
  });
});

// ============================================================
// Le moteur reste pur
// ============================================================

describe('frontière moteur / domaine (§38, §45)', () => {
  it('le snapshot persisté ne recopie pas les micro-segments (§36, AGENTS §78)', async () => {
    await withInitialPlan();

    const snapshot = activePlan(plan).inputSnapshot;

    expect(snapshot).toMatchObject({
      mode: 'rebalance_to_target',
      target_duration_seconds: TARGET,
      engine_version: 'plan-v1.0.0',
      micro_segment_count: 2,
    });
    expect(snapshot).not.toHaveProperty('microSegments');
    expect(JSON.stringify(snapshot)).not.toContain('modelGrade');
  });

  it('porte le hash d’entrée, reproductible (§34)', async () => {
    await withInitialPlan();
    const first = activePlan(plan).record.inputHash;

    plan.plans = [];
    await withInitialPlan();

    expect(activePlan(plan).record.inputHash).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('choisit la version du moteur côté serveur (§14, §67 critère 22)', async () => {
    await withInitialPlan();

    expect(activePlan(plan).record.engineVersion).toBe('plan-v1.0.0');
  });
});
