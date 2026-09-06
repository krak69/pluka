import { beforeEach, describe, expect, it } from 'vitest';
import type { TrailProfileRecord } from '@pluka/db';

import {
  computeOnboarding,
  createParticipantRace,
  DomainError,
  getOnboardingState,
  ONBOARDING_FLOWS,
  ONBOARDING_STEPS,
  resolveOnboardingFlow,
  setRaceGoal,
  stepsForFlow,
  updateTrailProfile,
  type OnboardingContext,
  type OnboardingSnapshot,
  type ParticipationContext,
  type ProfileContext,
} from '../src/index.js';
import {
  CANCELLED_RACE,
  COMPLETED_RACE,
  createFakeParticipationRepositories,
  DRAFT_RACE,
  FIXED_NOW,
  participationBaseState,
  PUBLIC_RACE,
  RUNNER_A,
  RUNNER_B,
  seedParticipation,
  type ParticipationState,
} from './fixtures/participation-repositories.js';
import { createFakeProfileRepositories } from './fixtures/profile-repositories.js';

/**
 * Onboarding coureur — 00_PRODUCT_SPEC §7.
 *
 * Deux familles de tests, et la seconde est la vraie :
 *
 * - les fonctions pures, qui traduisent §7.1, §7.2 et §7.3 ;
 * - le parcours réel, joué commande par commande, puis **recalculé de zéro**
 *   après chaque interruption. C'est la preuve de la reprise : si l'état se
 *   déduit toujours de la base, il n'y a rien à perdre en fermant l'onglet.
 */

let participation: ParticipationState;
let profiles: Map<string, TrailProfileRecord>;

function onboardingContext(userId: string): OnboardingContext {
  return {
    repositories: {
      ...createFakeParticipationRepositories(participation),
      ...createFakeProfileRepositories(profiles),
    },
    actor: { userId },
  };
}

function profileContext(userId: string): ProfileContext {
  return {
    repositories: createFakeProfileRepositories(profiles),
    actor: { userId },
    now: () => FIXED_NOW,
  };
}

function participationContext(userId: string): ParticipationContext {
  return {
    repositories: createFakeParticipationRepositories(participation),
    actor: { userId },
    now: () => FIXED_NOW,
  };
}

function snapshot(overrides: Partial<OnboardingSnapshot> = {}): OnboardingSnapshot {
  return {
    profile: null,
    participation: null,
    targetDurationSeconds: null,
    attachment: { ok: true },
    ...overrides,
  };
}

const PACED_PROFILE = {
  representativeDistanceKm: null,
  representativeElevationGainM: null,
  representativeDurationSeconds: null,
  representativeEffortDate: null,
  fallbackTrailPaceSecondsPerKm: 420,
};

const PARTIAL_PROFILE = { ...PACED_PROFILE, fallbackTrailPaceSecondsPerKm: null };

async function expectDomainError(
  promise: Promise<unknown>,
  code: DomainError['code'],
): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );

  expect(error, 'la commande aurait dû échouer').toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}

beforeEach(() => {
  participation = participationBaseState();
  profiles = new Map();
});

// ============================================================
// Le catalogue des étapes
// ============================================================

describe('étapes et parcours (00_PRODUCT_SPEC §7)', () => {
  it('ne retient que les étapes qui laissent une trace en base', () => {
    // « Fiche course », « cadrage / aperçu » et « création compte / offre » sont
    // de la navigation : les suivre demanderait un état applicatif, donc une
    // seconde source de vérité.
    expect([...ONBOARDING_STEPS]).toEqual(['trail_profile', 'race_attachment', 'race_goal']);
  });

  it('décrit les trois parcours de §7, et pas un de plus', () => {
    expect([...ONBOARDING_FLOWS]).toEqual([
      'new_runner',
      'returning_runner',
      'organizer_invitation',
    ]);
  });

  it('pose le profil avant l’objectif dans les parcours §7.1 et §7.2', () => {
    for (const flow of ['new_runner', 'returning_runner'] as const) {
      expect([...stepsForFlow(flow)]).toEqual(['trail_profile', 'race_attachment', 'race_goal']);
    }
  });

  it('raccourcit le parcours d’un invité (§3.2, §7.3, §29.2)', () => {
    // « Invitation → vérifier les informations préremplies → choisir l'objectif
    // → générer le Plan. » Le Profil trailer n'y figure pas : §3.2 veut un
    // onboarding « plus court », §29.2 « court et co-brandé ».
    expect([...stepsForFlow('organizer_invitation')]).toEqual(['race_attachment', 'race_goal']);
  });

  it('ne demande l’Assistance dans aucun parcours (§7.3, §15.1)', () => {
    // « L'Assistance n'est pas demandée dans le cœur de l'onboarding. »
    const everyStep = ONBOARDING_FLOWS.flatMap((flow) => [...stepsForFlow(flow)]);

    expect(everyStep.filter((step) => String(step).includes('assistance'))).toEqual([]);
    expect([...ONBOARDING_STEPS].filter((step) => String(step).includes('assistance'))).toEqual([]);
  });
});

// ============================================================
// Choix du parcours
// ============================================================

describe('resolveOnboardingFlow', () => {
  it('envoie un compte neuf sur §7.1', () => {
    expect(resolveOnboardingFlow(snapshot())).toBe('new_runner');
  });

  it('envoie un coureur qui a déjà un profil sur §7.2', () => {
    expect(resolveOnboardingFlow(snapshot({ profile: PACED_PROFILE }))).toBe('returning_runner');
  });

  it('y envoie aussi celui dont le profil est incomplet', () => {
    // §7.2 dit « si le profil existe déjà », pas « s'il est complet ». Ses
    // réponses déjà données ne doivent pas être reposées.
    expect(resolveOnboardingFlow(snapshot({ profile: PARTIAL_PROFILE }))).toBe('returning_runner');
  });

  it('reconnaît une arrivée par invitation d’organisation (§7.3)', () => {
    for (const registrationSource of ['organizer_import', 'organizer_invitation']) {
      expect(resolveOnboardingFlow(snapshot({ participation: { registrationSource } }))).toBe(
        'organizer_invitation',
      );
    }
  });

  it('fait primer §7.3 sur §7.2 : l’invité arrive quand même par l’invitation', () => {
    expect(
      resolveOnboardingFlow(
        snapshot({
          profile: PACED_PROFILE,
          participation: { registrationSource: 'organizer_import' },
        }),
      ),
    ).toBe('organizer_invitation');
  });

  it('ne prend pas un rattachement spontané ou un geste de support pour une invitation', () => {
    expect(
      resolveOnboardingFlow(snapshot({ participation: { registrationSource: 'direct' } })),
    ).toBe('new_runner');
    expect(
      resolveOnboardingFlow(snapshot({ participation: { registrationSource: 'admin' } })),
    ).toBe('new_runner');
  });
});

// ============================================================
// Avancement
// ============================================================

describe('computeOnboarding', () => {
  it('commence par le Profil trailer', () => {
    const state = computeOnboarding(snapshot());

    expect(state.flow).toBe('new_runner');
    expect(state.nextStep).toBe('trail_profile');
    expect(state.complete).toBe(false);
  });

  it('laisse le profil à faire tant qu’il ne porte aucun signal d’allure (§8.1)', () => {
    // C'est exactement ce qui rend la reprise possible : un profil enregistré
    // avant la fin reste une étape en cours, pas une étape ratée.
    const state = computeOnboarding(snapshot({ profile: PARTIAL_PROFILE }));

    expect(state.flow).toBe('returning_runner');
    expect(state.nextStep).toBe('trail_profile');
  });

  it('passe au rattachement dès que le profil porte une allure', () => {
    expect(computeOnboarding(snapshot({ profile: PACED_PROFILE })).nextStep).toBe(
      'race_attachment',
    );
  });

  it('passe à l’objectif une fois le coureur rattaché', () => {
    const state = computeOnboarding(
      snapshot({ profile: PACED_PROFILE, participation: { registrationSource: 'direct' } }),
    );

    expect(state.nextStep).toBe('race_goal');
    expect(state.steps).toEqual([
      { step: 'trail_profile', status: 'done' },
      { step: 'race_attachment', status: 'done' },
      { step: 'race_goal', status: 'todo' },
    ]);
  });

  it('se termine quand l’objectif est choisi', () => {
    const state = computeOnboarding(
      snapshot({
        profile: PACED_PROFILE,
        participation: { registrationSource: 'direct' },
        targetDurationSeconds: 43_200,
      }),
    );

    expect(state.nextStep).toBeNull();
    expect(state.complete).toBe(true);
  });

  it('ne repropose jamais une étape déjà faite (§7.2)', () => {
    const state = computeOnboarding(
      snapshot({ profile: PACED_PROFILE, participation: { registrationSource: 'direct' } }),
    );

    expect(state.steps.filter((step) => step.status === 'todo').map((step) => step.step)).toEqual([
      'race_goal',
    ]);
  });

  it('n’exige pas de profil pour terminer un parcours §7.3', () => {
    // Le profil reste renseignable plus tard, comme l'Assistance de §15.1 : il
    // n'est simplement pas une porte d'entrée pour un invité.
    const state = computeOnboarding(
      snapshot({
        participation: { registrationSource: 'organizer_invitation' },
        targetDurationSeconds: 43_200,
      }),
    );

    expect(state.steps.map((step) => step.step)).toEqual(['race_attachment', 'race_goal']);
    expect(state.complete).toBe(true);
  });

  it('signale ce qui empêchera le rattachement plutôt que de le laisser échouer', () => {
    const state = computeOnboarding(
      snapshot({ profile: PACED_PROFILE, attachment: { ok: false, reason: 'race_cancelled' } }),
    );

    expect(state.nextStep).toBe('race_attachment');
    expect(state.blocker).toBe('race_cancelled');
  });

  it('distingue l’épreuve annulée de celle qui n’est plus ouverte', () => {
    expect(
      computeOnboarding(
        snapshot({ profile: PACED_PROFILE, attachment: { ok: false, reason: 'race_not_open' } }),
      ).blocker,
    ).toBe('race_not_open');
  });

  it('ne signale rien quand le rattachement n’est pas l’étape courante', () => {
    // Une participation existante n'est jamais remise en cause par l'état de
    // la course (§4.1).
    const state = computeOnboarding(
      snapshot({
        profile: PACED_PROFILE,
        participation: { registrationSource: 'direct' },
        attachment: { ok: false, reason: 'race_cancelled' },
      }),
    );

    expect(state.nextStep).toBe('race_goal');
    expect(state.blocker).toBeNull();
  });
});

// ============================================================
// Le parcours réel, et sa reprise
// ============================================================

describe('getOnboardingState', () => {
  it('mène un nouveau coureur de son arrivée à un onboarding terminé', async () => {
    const start = await getOnboardingState(onboardingContext(RUNNER_A), { raceId: PUBLIC_RACE });
    expect(start).toMatchObject({ flow: 'new_runner', nextStep: 'trail_profile', blocker: null });

    await updateTrailProfile(profileContext(RUNNER_A), {
      weeklyDistanceKm: 45.5,
      climbComfort: 'medium',
    });

    const partial = await getOnboardingState(onboardingContext(RUNNER_A), { raceId: PUBLIC_RACE });
    expect(partial).toMatchObject({ flow: 'returning_runner', nextStep: 'trail_profile' });

    await updateTrailProfile(profileContext(RUNNER_A), { fallbackTrailPaceSecondsPerKm: 420 });

    const paced = await getOnboardingState(onboardingContext(RUNNER_A), { raceId: PUBLIC_RACE });
    expect(paced.nextStep).toBe('race_attachment');

    const created = await createParticipantRace(participationContext(RUNNER_A), {
      raceId: PUBLIC_RACE,
    });

    const attached = await getOnboardingState(onboardingContext(RUNNER_A), { raceId: PUBLIC_RACE });
    expect(attached.nextStep).toBe('race_goal');

    await setRaceGoal(participationContext(RUNNER_A), {
      participantRaceId: created.id,
      targetDurationSeconds: 43_200,
    });

    const done = await getOnboardingState(onboardingContext(RUNNER_A), { raceId: PUBLIC_RACE });
    expect(done).toMatchObject({ nextStep: null, complete: true });
  });

  it('reprend au même endroit après une interruption', async () => {
    // Rien n'est mémorisé entre deux appels : chaque contexte reconstruit ses
    // repositories. Retrouver la même réponse prouve que l'avancement se déduit
    // de la base, et non d'un curseur qu'on pourrait perdre.
    await updateTrailProfile(profileContext(RUNNER_A), { fallbackTrailPaceSecondsPerKm: 420 });
    await createParticipantRace(participationContext(RUNNER_A), { raceId: PUBLIC_RACE });

    const first = await getOnboardingState(onboardingContext(RUNNER_A), { raceId: PUBLIC_RACE });
    const second = await getOnboardingState(onboardingContext(RUNNER_A), { raceId: PUBLIC_RACE });

    expect(second).toEqual(first);
    expect(second.nextStep).toBe('race_goal');
  });

  it('conserve les réponses déjà données quand le profil est abandonné en route (§7.2)', async () => {
    await updateTrailProfile(profileContext(RUNNER_A), {
      weeklyDistanceKm: 45.5,
      longDistanceExperience: '60_100k',
    });

    const state = await getOnboardingState(onboardingContext(RUNNER_A), { raceId: PUBLIC_RACE });
    expect(state.nextStep).toBe('trail_profile');

    // Le coureur revient et complète : ce qu'il avait répondu est toujours là.
    const resumed = await updateTrailProfile(profileContext(RUNNER_A), {
      fallbackTrailPaceSecondsPerKm: 420,
    });

    expect(resumed.profile.weeklyDistanceKm).toBe(45.5);
    expect(resumed.profile.longDistanceExperience).toBe('60_100k');
    expect(
      (await getOnboardingState(onboardingContext(RUNNER_A), { raceId: PUBLIC_RACE })).nextStep,
    ).toBe('race_attachment');
  });

  it('n’impose pas l’ordre des étapes, il dit seulement par quoi continuer', async () => {
    // Un coureur invité par une organisation choisit son objectif sans avoir
    // jamais rempli de profil : le domaine accepte, et l'onboarding §7.3 est
    // terminé.
    const invited = seedParticipation(participation, {
      userId: RUNNER_A,
      raceId: PUBLIC_RACE,
      registrationSource: 'organizer_invitation',
    });

    await setRaceGoal(participationContext(RUNNER_A), {
      participantRaceId: invited.id,
      targetDurationSeconds: 43_200,
    });

    await expect(
      getOnboardingState(onboardingContext(RUNNER_A), { raceId: PUBLIC_RACE }),
    ).resolves.toMatchObject({ flow: 'organizer_invitation', complete: true });
  });

  it('rend un état, pas une erreur, sur une course annulée', async () => {
    await updateTrailProfile(profileContext(RUNNER_A), { fallbackTrailPaceSecondsPerKm: 420 });

    const state = await getOnboardingState(onboardingContext(RUNNER_A), {
      raceId: CANCELLED_RACE,
    });

    expect(state.nextStep).toBe('race_attachment');
    expect(state.blocker).toBe('race_cancelled');

    // Et la commande correspondante refuse bien : l'état annonçait juste.
    await expectDomainError(
      createParticipantRace(participationContext(RUNNER_A), { raceId: CANCELLED_RACE }),
      'invalid_state',
    );
  });

  it('signale une épreuve déjà courue sans la confondre avec une annulation', async () => {
    await updateTrailProfile(profileContext(RUNNER_A), { fallbackTrailPaceSecondsPerKm: 420 });

    await expect(
      getOnboardingState(onboardingContext(RUNNER_A), { raceId: COMPLETED_RACE }),
    ).resolves.toMatchObject({ nextStep: 'race_attachment', blocker: 'race_not_open' });
  });

  it('ne signale rien tant que le rattachement n’est pas l’étape courante', async () => {
    // Le blocage décrit ce qui empêche l'étape *en cours* d'aboutir. Sans
    // profil, la prochaine étape est le profil, et l'état de la course ne
    // change rien à ce qu'il reste à faire.
    await expect(
      getOnboardingState(onboardingContext(RUNNER_A), { raceId: COMPLETED_RACE }),
    ).resolves.toMatchObject({ nextStep: 'trail_profile', blocker: null });
  });

  it('tait une épreuve que le coureur ne peut pas atteindre', async () => {
    // §120 : répondre autre chose que « introuvable » confirmerait l'existence
    // d'un brouillon à partir d'un simple UUID.
    await expectDomainError(
      getOnboardingState(onboardingContext(RUNNER_A), { raceId: DRAFT_RACE }),
      'not_found',
    );
  });

  it('tait une épreuve inexistante', async () => {
    await expectDomainError(
      getOnboardingState(onboardingContext(RUNNER_A), {
        raceId: 'ffffffff-0000-4000-8000-000000000999',
      }),
      'not_found',
    );
  });

  it('ne lit que l’avancement du coureur de la session', async () => {
    await updateTrailProfile(profileContext(RUNNER_A), { fallbackTrailPaceSecondsPerKm: 420 });
    await createParticipantRace(participationContext(RUNNER_A), { raceId: PUBLIC_RACE });

    const a = await getOnboardingState(onboardingContext(RUNNER_A), { raceId: PUBLIC_RACE });
    const b = await getOnboardingState(onboardingContext(RUNNER_B), { raceId: PUBLIC_RACE });

    expect(a.nextStep).toBe('race_goal');
    // B partage la course, pas l'avancement : il n'a ni profil ni participation.
    expect(b).toMatchObject({ flow: 'new_runner', nextStep: 'trail_profile' });
  });

  it('n’accepte aucun identifiant d’utilisateur', async () => {
    await expect(
      getOnboardingState(onboardingContext(RUNNER_A), {
        raceId: PUBLIC_RACE,
        userId: RUNNER_B,
      }),
    ).rejects.toThrow();
  });
});
