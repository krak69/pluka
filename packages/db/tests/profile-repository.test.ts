import { describe, expect, it } from 'vitest';

import { trailProfileRepository, type PlukaClient } from '../src/index.js';

/**
 * Repository du Profil trailer.
 *
 * Deux choses sont vérifiées ici, et aucune n'est rattrapable plus haut : la
 * projection nommée qui sort de la base, et la forme du DTO.
 *
 * 03_PRIVACY_RLS §13 : « ORGANIZATION : aucun ». Ce fichier prouve la moitié
 * structurelle de cette règle — il n'existe, dans le paquet, aucune requête
 * capable de lire un profil autrement que par son propriétaire. La RLS prouve
 * l'autre moitié, et les deux ne se délèguent pas l'une à l'autre.
 */

interface Recorder {
  readonly client: PlukaClient;
  readonly calls: string[];
}

function fakeClient(result: unknown): Recorder {
  const calls: string[] = [];
  const answer = Promise.resolve({ data: result, error: null });

  const builder: Record<string, unknown> = {
    select: (columns: string) => {
      calls.push(`select:${columns}`);
      return builder;
    },
    upsert: (values: unknown, options: unknown) => {
      calls.push(`upsert:${JSON.stringify(values)}:${JSON.stringify(options)}`);
      return builder;
    },
    eq: (column: string, value: unknown) => {
      calls.push(`eq:${column}=${String(value)}`);
      return builder;
    },
    single: () => answer,
    maybeSingle: () => answer,
  };

  const client = {
    from: (table: string) => {
      calls.push(`from:${table}`);
      return builder;
    },
  } as unknown as PlukaClient;

  return { client, calls };
}

const PROFILE_ROW = {
  user_id: 'user-1',
  representative_effort_label: 'Trail des Tests 2025',
  representative_effort_date: '2025-09-14',
  representative_distance_km: 42,
  representative_elevation_gain_m: 2000,
  representative_duration_seconds: 21_600,
  fallback_trail_pace_seconds_per_km: null,
  weekly_distance_km: 45.5,
  weekly_elevation_gain_m: 1200,
  climb_comfort: 'medium',
  descent_comfort: 'high',
  long_distance_experience: '60_100k',
  profile_completed_at: '2026-03-01T10:00:00Z',
};

describe('trailProfileRepository', () => {
  it('lit un profil par son propriétaire, et par rien d’autre', async () => {
    const { client, calls } = fakeClient(PROFILE_ROW);

    await trailProfileRepository({ client }).findByUser('user-1');

    expect(calls[0]).toBe('from:trail_profiles');
    expect(calls).toContain('eq:user_id=user-1');
    // Aucune jointure, aucun autre filtre : le seul chemin de lecture est le
    // propriétaire.
    expect(calls.filter((call) => call.startsWith('eq:'))).toEqual(['eq:user_id=user-1']);
  });

  it('traduit une absence en null : un compte neuf n’a pas de profil', async () => {
    const { client } = fakeClient(null);

    await expect(trailProfileRepository({ client }).findByUser('inconnu')).resolves.toBeNull();
  });

  it('rend un DTO qui ne porte aucun signal physiologique (§8.2)', async () => {
    // « Ne pas demander par défaut : VO2max ; VMA ; zones cardiaques ;
    // historique détaillé d'entraînement ; puissance ; charge d'entraînement. »
    // La liste exacte des clés est l'assertion : aucune ne peut apparaître par
    // élargissement de projection.
    const { client } = fakeClient(PROFILE_ROW);

    const profile = await trailProfileRepository({ client }).findByUser('user-1');

    expect(profile).toEqual({
      userId: 'user-1',
      representativeEffortLabel: 'Trail des Tests 2025',
      representativeEffortDate: '2025-09-14',
      representativeDistanceKm: 42,
      representativeElevationGainM: 2000,
      representativeDurationSeconds: 21_600,
      fallbackTrailPaceSecondsPerKm: null,
      weeklyDistanceKm: 45.5,
      weeklyElevationGainM: 1200,
      climbComfort: 'medium',
      descentComfort: 'high',
      longDistanceExperience: '60_100k',
      profileCompletedAt: '2026-03-01T10:00:00Z',
    });
  });

  it('projette des colonnes nommées, sans étoile', async () => {
    const { client, calls } = fakeClient(PROFILE_ROW);

    await trailProfileRepository({ client }).findByUser('user-1');

    const projection = calls.find((call) => call.startsWith('select:')) as string;
    expect(projection).toContain('fallback_trail_pace_seconds_per_km');
    expect(projection).not.toContain('*');
  });

  it('écrit sous l’identifiant passé par le use case, qui gagne toujours', async () => {
    // Le `user_id` est la clé primaire : c'est lui qui décide si l'écriture
    // crée ou remplace. Il est posé en dernier pour qu'une charge qui en
    // porterait un autre ne puisse pas rediriger l'écriture.
    const { client, calls } = fakeClient(PROFILE_ROW);

    await trailProfileRepository({ client }).upsert('user-1', {
      user_id: 'user-2',
      climb_comfort: 'high',
    });

    expect(calls).toContain(
      'upsert:{"user_id":"user-1","climb_comfort":"high"}:{"onConflict":"user_id"}',
    );
  });

  it('crée la ligne au besoin plutôt que d’exiger qu’elle existe', async () => {
    const { client, calls } = fakeClient(PROFILE_ROW);

    await trailProfileRepository({ client }).upsert('user-1', { weekly_distance_km: 45.5 });

    expect(calls.some((call) => call.startsWith('upsert:'))).toBe(true);
    expect(calls.some((call) => call.startsWith('update:'))).toBe(false);
  });
});
