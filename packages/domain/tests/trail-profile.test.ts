import { beforeEach, describe, expect, it } from 'vitest';
import type { ProfileRepositories, TrailProfileRecord } from '@pluka/db';

import {
  checkTrailProfile,
  DomainError,
  getTrailProfile,
  hasPaceSignal,
  hasPartialRepresentativeEffort,
  hasRepresentativeEffort,
  updateTrailProfile,
  type ProfileContext,
  type TrailProfileShape,
} from '../src/index.js';

/**
 * Profil trailer — 00_PRODUCT_SPEC §8, 02_DATA_MODEL §4.2.
 *
 * La règle d'accès est prouvée par une absence : aucune commande ne nomme un
 * utilisateur. Les tests d'isolation vérifient donc deux choses différentes —
 * qu'un identifiant reçu est rejeté, et que deux coureurs ne se croisent
 * jamais (03_PRIVACY_RLS §13, §136).
 */

const RUNNER_A = '11111111-1111-4111-8111-111111111111';
const RUNNER_B = '22222222-2222-4222-8222-222222222222';

const FIXED_NOW = new Date('2026-03-01T10:00:00.000Z');

/**
 * Repository en mémoire.
 *
 * Il reproduit la contrainte `trail_profiles_effort_is_whole` de la migration
 * 0019 : sans elle, un test « le domaine refuse un effort partiel » pourrait
 * passer alors que le domaine l'aurait laissé filer jusqu'à une base qui, en
 * vrai, l'aurait refusé.
 */
function createFakeProfileRepositories(
  state: Map<string, TrailProfileRecord>,
): ProfileRepositories {
  return {
    trailProfiles: {
      findByUser: async (userId) => state.get(userId) ?? null,

      upsert: async (userId, values) => {
        const measures = [
          values.representative_distance_km ?? null,
          values.representative_elevation_gain_m ?? null,
          values.representative_duration_seconds ?? null,
        ];
        const present = measures.filter((measure) => measure !== null).length;
        if (present > 0 && present < measures.length) {
          throw new Error('trail_profiles_effort_is_whole : effort représentatif incomplet');
        }

        const record: TrailProfileRecord = {
          userId,
          representativeEffortLabel: values.representative_effort_label ?? null,
          representativeEffortDate: values.representative_effort_date ?? null,
          representativeDistanceKm: values.representative_distance_km ?? null,
          representativeElevationGainM: values.representative_elevation_gain_m ?? null,
          representativeDurationSeconds: values.representative_duration_seconds ?? null,
          fallbackTrailPaceSecondsPerKm: values.fallback_trail_pace_seconds_per_km ?? null,
          weeklyDistanceKm: values.weekly_distance_km ?? null,
          weeklyElevationGainM: values.weekly_elevation_gain_m ?? null,
          climbComfort: values.climb_comfort ?? null,
          descentComfort: values.descent_comfort ?? null,
          longDistanceExperience: values.long_distance_experience ?? null,
          profileCompletedAt: values.profile_completed_at ?? null,
        };

        state.set(userId, record);
        return record;
      },
    },
  };
}

let state: Map<string, TrailProfileRecord>;

function contextFor(userId: string, now: Date = FIXED_NOW): ProfileContext {
  return {
    repositories: createFakeProfileRepositories(state),
    actor: { userId },
    now: () => now,
  };
}

function shape(overrides: Partial<TrailProfileShape> = {}): TrailProfileShape {
  return {
    representativeDistanceKm: null,
    representativeElevationGainM: null,
    representativeDurationSeconds: null,
    representativeEffortDate: null,
    fallbackTrailPaceSecondsPerKm: null,
    ...overrides,
  };
}

const FULL_EFFORT = {
  representativeDistanceKm: 42,
  representativeElevationGainM: 2000,
  representativeDurationSeconds: 21_600,
};

async function expectDomainError(
  promise: Promise<unknown>,
  code: DomainError['code'],
): Promise<DomainError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );

  expect(error, 'la commande aurait dû échouer').toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);

  return error as DomainError;
}

beforeEach(() => {
  state = new Map();
});

// ============================================================
// Invariants purs
// ============================================================

describe('signal d’allure (00_PRODUCT_SPEC §8.1)', () => {
  it('reconnaît un effort représentatif complet', () => {
    expect(hasRepresentativeEffort(shape(FULL_EFFORT))).toBe(true);
  });

  it('n’en reconnaît pas un auquel il manque une mesure', () => {
    for (const missing of [
      'representativeDistanceKm',
      'representativeElevationGainM',
      'representativeDurationSeconds',
    ] as const) {
      expect(hasRepresentativeEffort(shape({ ...FULL_EFFORT, [missing]: null }))).toBe(false);
    }
  });

  it('distingue « rien saisi » de « à moitié saisi »', () => {
    // Une distance sans durée ne situe aucune allure : ce n'est pas un signal
    // faible, c'est une donnée qui ne veut rien dire.
    expect(hasPartialRepresentativeEffort(shape())).toBe(false);
    expect(hasPartialRepresentativeEffort(shape(FULL_EFFORT))).toBe(false);
    expect(hasPartialRepresentativeEffort(shape({ representativeDistanceKm: 42 }))).toBe(true);
    expect(
      hasPartialRepresentativeEffort(
        shape({ representativeDistanceKm: 42, representativeDurationSeconds: 21_600 }),
      ),
    ).toBe(true);
  });

  it('accepte l’allure de repli comme alternative, jamais comme complément obligé', () => {
    // §8.1 : « à défaut, repère d'allure trail ». Les deux voies sont
    // alternatives, et l'une suffit.
    expect(hasPaceSignal(shape())).toBe(false);
    expect(hasPaceSignal(shape(FULL_EFFORT))).toBe(true);
    expect(hasPaceSignal(shape({ fallbackTrailPaceSecondsPerKm: 420 }))).toBe(true);
    expect(hasPaceSignal(shape({ ...FULL_EFFORT, fallbackTrailPaceSecondsPerKm: 420 }))).toBe(true);
  });
});

describe('cohérence d’un profil', () => {
  it('accepte un profil vide : il est incomplet, pas incohérent', () => {
    expect(checkTrailProfile(shape(), FIXED_NOW)).toEqual({ ok: true });
  });

  it('refuse un effort à moitié saisi', () => {
    expect(checkTrailProfile(shape({ representativeDistanceKm: 42 }), FIXED_NOW)).toEqual({
      ok: false,
      reason: 'partial_effort',
    });
  });

  it('refuse un effort daté dans le futur', () => {
    expect(
      checkTrailProfile(
        shape({ ...FULL_EFFORT, representativeEffortDate: '2026-03-02' }),
        FIXED_NOW,
      ),
    ).toEqual({ ok: false, reason: 'effort_in_future' });
  });

  it('accepte un effort daté d’aujourd’hui', () => {
    expect(
      checkTrailProfile(
        shape({ ...FULL_EFFORT, representativeEffortDate: '2026-03-01' }),
        FIXED_NOW,
      ),
    ).toEqual({ ok: true });
  });

  it('n’impose aucune ancienneté maximale', () => {
    // §8 n'en définit aucune. En inventer une rejetterait le profil d'un
    // coureur qui revient de blessure.
    expect(
      checkTrailProfile(
        shape({ ...FULL_EFFORT, representativeEffortDate: '2019-05-04' }),
        FIXED_NOW,
      ),
    ).toEqual({ ok: true });
  });
});

// ============================================================
// getTrailProfile
// ============================================================

describe('getTrailProfile', () => {
  it('rend un profil absent sans en fabriquer un', async () => {
    await expect(getTrailProfile(contextFor(RUNNER_A))).resolves.toEqual({
      profile: null,
      complete: false,
    });
  });

  it('dit qu’un profil partiel n’est pas complet (§7.2)', async () => {
    await updateTrailProfile(contextFor(RUNNER_A), { climbComfort: 'high' });

    const view = await getTrailProfile(contextFor(RUNNER_A));

    expect(view.profile?.climbComfort).toBe('high');
    expect(view.complete).toBe(false);
  });

  it('dit qu’un profil porteur d’un signal d’allure est complet', async () => {
    await updateTrailProfile(contextFor(RUNNER_A), { fallbackTrailPaceSecondsPerKm: 420 });

    await expect(getTrailProfile(contextFor(RUNNER_A))).resolves.toMatchObject({ complete: true });
  });

  it('ne rend que le profil de la session', async () => {
    await updateTrailProfile(contextFor(RUNNER_A), { climbComfort: 'high' });
    await updateTrailProfile(contextFor(RUNNER_B), { climbComfort: 'low' });

    const a = await getTrailProfile(contextFor(RUNNER_A));
    const b = await getTrailProfile(contextFor(RUNNER_B));

    expect(a.profile?.userId).toBe(RUNNER_A);
    expect(a.profile?.climbComfort).toBe('high');
    expect(b.profile?.userId).toBe(RUNNER_B);
    expect(b.profile?.climbComfort).toBe('low');
  });

  it('n’offre aucune façon de désigner le profil d’un autre', async () => {
    // §13 : « ORGANIZATION : aucun ». La garantie tient au fait que la requête
    // ne porte pas d'identifiant — un paramètre en trop est refusé.
    await updateTrailProfile(contextFor(RUNNER_B), { climbComfort: 'low' });

    await expect(getTrailProfile(contextFor(RUNNER_A), { userId: RUNNER_B })).rejects.toThrow();
  });
});

// ============================================================
// updateTrailProfile
// ============================================================

describe('updateTrailProfile', () => {
  it('crée le profil d’un compte qui n’en a pas', async () => {
    const view = await updateTrailProfile(contextFor(RUNNER_A), {
      representativeEffortLabel: 'Trail des Tests 2025',
      ...FULL_EFFORT,
    });

    expect(view.profile.userId).toBe(RUNNER_A);
    expect(view.profile.representativeDistanceKm).toBe(42);
    expect(view.complete).toBe(true);
  });

  it('écrit sous l’acteur de la session, jamais sous un identifiant reçu', async () => {
    await expect(
      updateTrailProfile(contextFor(RUNNER_A), { userId: RUNNER_B, climbComfort: 'high' }),
    ).rejects.toThrow();

    expect(state.get(RUNNER_B)).toBeUndefined();
  });

  it('laisse intact ce que le patch ne nomme pas (§7.2)', async () => {
    await updateTrailProfile(contextFor(RUNNER_A), {
      weeklyDistanceKm: 45.5,
      climbComfort: 'medium',
      longDistanceExperience: '60_100k',
    });

    const view = await updateTrailProfile(contextFor(RUNNER_A), { climbComfort: 'high' });

    expect(view.profile.climbComfort).toBe('high');
    expect(view.profile.weeklyDistanceKm).toBe(45.5);
    expect(view.profile.longDistanceExperience).toBe('60_100k');
  });

  it('efface ce que le patch met à null', async () => {
    // « Je n'ai pas répondu » et « je retire ma réponse » ne sont pas le même
    // geste : sans cette distinction, confirmer un profil écran par écran
    // effacerait ce qui n'est pas à l'écran.
    await updateTrailProfile(contextFor(RUNNER_A), { climbComfort: 'medium' });

    const view = await updateTrailProfile(contextFor(RUNNER_A), { climbComfort: null });

    expect(view.profile.climbComfort).toBeNull();
  });

  it('applique les invariants à l’état résultant, pas au patch', async () => {
    await updateTrailProfile(contextFor(RUNNER_A), FULL_EFFORT);

    // Retirer la seule durée laisserait un effort à moitié saisi en base.
    await expectDomainError(
      updateTrailProfile(contextFor(RUNNER_A), { representativeDurationSeconds: null }),
      'validation',
    );

    expect(state.get(RUNNER_A)?.representativeDurationSeconds).toBe(21_600);
  });

  it('refuse un effort à moitié saisi dès la création', async () => {
    const error = await expectDomainError(
      updateTrailProfile(contextFor(RUNNER_A), { representativeDistanceKm: 42 }),
      'validation',
    );

    expect(error.details['raison']).toBe('partial_effort');
    expect(state.size).toBe(0);
  });

  it('refuse un effort daté dans le futur', async () => {
    const error = await expectDomainError(
      updateTrailProfile(contextFor(RUNNER_A), {
        ...FULL_EFFORT,
        representativeEffortDate: '2026-06-01',
      }),
      'validation',
    );

    expect(error.details['raison']).toBe('effort_in_future');
  });

  it('accepte un profil incomplet : il se reprend plus tard (§7.2)', async () => {
    const view = await updateTrailProfile(contextFor(RUNNER_A), {
      weeklyDistanceKm: 45.5,
      descentComfort: 'low',
    });

    expect(view.complete).toBe(false);
    expect(view.profile.profileCompletedAt).toBeNull();
  });

  it('date la complétion la première fois que le profil porte un signal d’allure', async () => {
    await updateTrailProfile(contextFor(RUNNER_A), { weeklyDistanceKm: 45.5 });
    expect(state.get(RUNNER_A)?.profileCompletedAt).toBeNull();

    const view = await updateTrailProfile(contextFor(RUNNER_A), {
      fallbackTrailPaceSecondsPerKm: 420,
    });

    expect(view.profile.profileCompletedAt).toBe(FIXED_NOW.toISOString());
  });

  it('ne redate pas la complétion à chaque édition', async () => {
    // Sinon la colonne ne serait qu'un doublon d'`updated_at`.
    await updateTrailProfile(contextFor(RUNNER_A), { fallbackTrailPaceSecondsPerKm: 420 });

    const later = new Date('2026-04-15T08:00:00.000Z');
    const view = await updateTrailProfile(contextFor(RUNNER_A, later), { climbComfort: 'high' });

    expect(view.profile.profileCompletedAt).toBe(FIXED_NOW.toISOString());
  });

  it('garde la date de complétion quand le profil redevient incomplet', async () => {
    // L'horodatage date un fait qui a eu lieu ; c'est `complete` qui décrit
    // l'état d'aujourd'hui, et c'est lui que l'onboarding consulte.
    await updateTrailProfile(contextFor(RUNNER_A), { fallbackTrailPaceSecondsPerKm: 420 });

    const view = await updateTrailProfile(contextFor(RUNNER_A), {
      fallbackTrailPaceSecondsPerKm: null,
    });

    expect(view.complete).toBe(false);
    expect(view.profile.profileCompletedAt).toBe(FIXED_NOW.toISOString());
  });

  it('refuse une commande vide', async () => {
    await expect(updateTrailProfile(contextFor(RUNNER_A), {})).rejects.toThrow();
  });

  it('refuse les signaux physiologiques exclus du cœur V1 (§8.2)', async () => {
    // « Ne pas demander par défaut : VO2max ; VMA ; zones cardiaques ;
    // historique détaillé d'entraînement ; puissance ; charge d'entraînement. »
    // Le schéma les rejette au lieu de les ignorer : une donnée envoyée par
    // erreur doit produire une erreur, pas disparaître sans trace.
    for (const excluded of [
      { vo2max: 62 },
      { vma: 17.5 },
      { heartRateZones: [120, 150, 170] },
      { trainingLoad: 480 },
      { powerWatts: 280 },
    ]) {
      await expect(
        updateTrailProfile(contextFor(RUNNER_A), { climbComfort: 'high', ...excluded }),
      ).rejects.toThrow();
    }

    expect(state.size).toBe(0);
  });

  it('refuse les valeurs que la base refuserait', async () => {
    for (const invalid of [
      {
        representativeDistanceKm: 0,
        representativeElevationGainM: 0,
        representativeDurationSeconds: 1,
      },
      { fallbackTrailPaceSecondsPerKm: 0 },
      { fallbackTrailPaceSecondsPerKm: 12.5 },
      { weeklyDistanceKm: -1 },
      { weeklyElevationGainM: -1 },
      // `numeric(7,2)` : une troisième décimale serait arrondie en silence.
      {
        representativeDistanceKm: 42.123,
        representativeElevationGainM: 2000,
        representativeDurationSeconds: 21_600,
      },
    ]) {
      await expect(updateTrailProfile(contextFor(RUNNER_A), invalid)).rejects.toThrow();
    }

    expect(state.size).toBe(0);
  });

  it('refuse une aisance ou une expérience hors nomenclature', async () => {
    await expect(
      updateTrailProfile(contextFor(RUNNER_A), { climbComfort: 'excellent' }),
    ).rejects.toThrow();

    await expect(
      updateTrailProfile(contextFor(RUNNER_A), { longDistanceExperience: '200k' }),
    ).rejects.toThrow();
  });

  it('n’écrit jamais chez un autre coureur', async () => {
    await updateTrailProfile(contextFor(RUNNER_A), { climbComfort: 'high' });
    await updateTrailProfile(contextFor(RUNNER_B), { climbComfort: 'low' });

    expect(state.get(RUNNER_A)?.climbComfort).toBe('high');
    expect(state.get(RUNNER_B)?.climbComfort).toBe('low');
    expect(state.size).toBe(2);
  });
});
