import { describe, expect, it } from 'vitest';

import {
  accountRepository,
  participantRaceRepository,
  participantRaceSettingsRepository,
  type PlukaClient,
} from '../src/index.js';

/**
 * Repositories de participation.
 *
 * Ce qui est vérifié ici est ce qui sort de la base : la projection nommée et
 * la forme du DTO. Les deux portent une règle de confidentialité que le
 * domaine ne peut pas rattraper une fois la donnée lue —
 * 03_PRIVACY_RLS §28 (email participant) et §29 (préférences propriétaires).
 *
 * Le client est simulé ; les repositories, non. C'est leur requête réelle qui
 * est observée.
 */

interface Recorder {
  readonly client: PlukaClient;
  readonly calls: string[];
}

/** Client minimal, enregistrant la requête construite. */
function fakeClient(result: unknown): Recorder {
  const calls: string[] = [];
  const answer = Promise.resolve({ data: result, error: null });

  const builder: Record<string, unknown> = {
    select: (columns: string) => {
      calls.push(`select:${columns}`);
      return builder;
    },
    insert: (values: unknown) => {
      calls.push(`insert:${JSON.stringify(values)}`);
      return builder;
    },
    update: (values: unknown) => {
      calls.push(`update:${JSON.stringify(values)}`);
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
    is: (column: string, value: unknown) => {
      calls.push(`is:${column}=${String(value)}`);
      return builder;
    },
    order: (column: string) => {
      calls.push(`order:${column}`);
      return builder;
    },
    limit: (count: number) => {
      calls.push(`limit:${count}`);
      return builder;
    },
    single: () => answer,
    maybeSingle: () => answer,
    // `listRoster` termine sur `.limit()` : le builder doit être attendable.
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      answer.then(resolve, reject),
  };

  const client = {
    from: (table: string) => {
      calls.push(`from:${table}`);
      return builder;
    },
  } as unknown as PlukaClient;

  return { client, calls };
}

const PARTICIPANT_ROW = {
  id: 'pr-1',
  race_id: 'race-1',
  user_id: 'user-1',
  first_name_snapshot: 'Sacha',
  last_name_snapshot: 'Import',
  registration_source: 'organizer_import',
  external_registration_id: 'EXT-9',
  bib_number: '101',
  start_wave_id: 'wave-1',
  personal_start_datetime: '2026-06-20T04:10:00Z',
  status: 'active',
  preparation_state: 'preparing',
  joined_at: '2026-03-01T10:00:00Z',
};

const SETTINGS_ROW = {
  participant_race_id: 'pr-1',
  target_duration_seconds: 43_200,
  assistance_status: 'to_define',
  nutrition_enabled: false,
  nutrition_waypoints_visible: true,
  repere_visible: false,
  notifications_enabled: true,
};

function projections(calls: readonly string[]): readonly string[] {
  return calls.filter((call) => call.startsWith('select:'));
}

/** Charges écrites, à l'exclusion des projections de relecture. */
function writes(calls: readonly string[]): readonly string[] {
  return calls.filter((call) => call.startsWith('update:'));
}

describe('participantRaceRepository', () => {
  it('lit une participation par sa projection nommée', async () => {
    const { client, calls } = fakeClient(PARTICIPANT_ROW);

    await participantRaceRepository({ client }).findById('pr-1');

    expect(calls[0]).toBe('from:participant_races');
    expect(calls).toContain('eq:id=pr-1');
    expect(projections(calls)[0]).toContain('bib_number');
  });

  it('traduit la ligne en DTO camelCase, sans email d’invitation', async () => {
    const { client } = fakeClient(PARTICIPANT_ROW);

    const record = await participantRaceRepository({ client }).findById('pr-1');

    expect(record).toEqual({
      id: 'pr-1',
      raceId: 'race-1',
      userId: 'user-1',
      firstNameSnapshot: 'Sacha',
      lastNameSnapshot: 'Import',
      registrationSource: 'organizer_import',
      externalRegistrationId: 'EXT-9',
      bibNumber: '101',
      startWaveId: 'wave-1',
      personalStartDatetime: '2026-06-20T04:10:00Z',
      status: 'active',
      preparationState: 'preparing',
      joinedAt: '2026-03-01T10:00:00Z',
    });
  });

  it('cherche la participation d’un coureur sur une course par les deux clés', async () => {
    const { client, calls } = fakeClient(PARTICIPANT_ROW);

    await participantRaceRepository({ client }).findByRaceAndUser('race-1', 'user-1');

    expect(calls).toContain('eq:race_id=race-1');
    expect(calls).toContain('eq:user_id=user-1');
  });

  it('traduit une absence en null plutôt qu’en erreur', async () => {
    const { client } = fakeClient(null);

    await expect(participantRaceRepository({ client }).findById('inconnu')).resolves.toBeNull();
  });

  it('écrit l’axe préparation sans toucher au statut', async () => {
    const { client, calls } = fakeClient(PARTICIPANT_ROW);

    await participantRaceRepository({ client }).updatePreparationState('pr-1', 'ready');

    // La projection de relecture porte bien les deux colonnes ; c'est la
    // *charge écrite* qui ne doit en nommer qu'une.
    expect(writes(calls)).toEqual(['update:{"preparation_state":"ready"}']);
  });

  it('écrit l’axe participation sans toucher à la préparation', async () => {
    // 02_DATA_MODEL §9.3 : « aucun chemin d'écriture ne calcule l'une à partir
    // de l'autre ». Chaque update ne nomme que sa colonne.
    const { client, calls } = fakeClient(PARTICIPANT_ROW);

    await participantRaceRepository({ client }).updateStatus('pr-1', 'dnf');

    expect(writes(calls)).toEqual(['update:{"status":"dnf"}']);
  });

  it('garde la réclamation atomique : libre, et le bon email', async () => {
    const { client, calls } = fakeClient(PARTICIPANT_ROW);

    await participantRaceRepository({ client }).claimForUser(
      'pr-1',
      'user-1',
      'invite@test.pluka',
      '2026-03-01T10:00:00Z',
    );

    expect(calls).toContain('eq:id=pr-1');
    expect(calls).toContain('is:user_id=null');
    expect(calls).toContain('eq:invite_email=invite@test.pluka');
    expect(calls).toContain('update:{"user_id":"user-1","joined_at":"2026-03-01T10:00:00Z"}');
  });

  it('rend null quand la réclamation ne prend pas', async () => {
    const { client } = fakeClient(null);

    await expect(
      participantRaceRepository({ client }).claimForUser('pr-1', 'user-1', 'x@y.z', 'now'),
    ).resolves.toBeNull();
  });
});

describe('liste d’inscrits (03_PRIVACY_RLS §27)', () => {
  it('projette l’opérationnel, et rien de la préparation', async () => {
    const { client, calls } = fakeClient([PARTICIPANT_ROW]);

    await participantRaceRepository({ client }).listRoster('race-1', 100);

    const projection = projections(calls)[0] as string;
    expect(projection).toContain('bib_number');
    expect(projection).toContain('start_wave_id');
    expect(projection).not.toContain('preparation_state');
    expect(projection).not.toContain('personal_start_datetime');
  });

  it('ne joint jamais la table des préférences', async () => {
    // Une jointure suffirait à faire sortir l'objectif d'un coureur dans une
    // liste B2B (§29). Elle n'existe nulle part dans ce repository.
    const { client, calls } = fakeClient([PARTICIPANT_ROW]);

    await participantRaceRepository({ client }).listRoster('race-1', 100);

    expect(calls.filter((call) => call.includes('participant_race_settings'))).toEqual([]);
    expect(projections(calls)[0]).not.toContain('target_duration_seconds');
  });

  it('rend un DTO borné à ce que §27 autorise', async () => {
    const { client } = fakeClient([PARTICIPANT_ROW]);

    const roster = await participantRaceRepository({ client }).listRoster('race-1', 100);

    expect(roster).toEqual([
      {
        participantRaceId: 'pr-1',
        firstName: 'Sacha',
        lastName: 'Import',
        bibNumber: '101',
        startWaveId: 'wave-1',
        registrationSource: 'organizer_import',
        externalRegistrationId: 'EXT-9',
        activated: true,
      },
    ]);
  });

  it('dit l’activation sans donner le compte', async () => {
    const { client } = fakeClient([{ ...PARTICIPANT_ROW, user_id: null }]);

    const roster = await participantRaceRepository({ client }).listRoster('race-1', 100);

    expect(roster[0]?.activated).toBe(false);
    expect(roster[0]).not.toHaveProperty('userId');
  });

  it('borne la lecture', async () => {
    const { client, calls } = fakeClient([PARTICIPANT_ROW]);

    await participantRaceRepository({ client }).listRoster('race-1', 25);

    expect(calls).toContain('limit:25');
  });
});

describe('minimisation de l’email participant (§28)', () => {
  it('n’est demandé par aucune projection du paquet', async () => {
    // La comparaison de `claimForUser` reste dans le `where` : l'email sert de
    // garde, il ne remonte jamais.
    const reads = [
      (client: PlukaClient) => participantRaceRepository({ client }).findById('pr-1'),
      (client: PlukaClient) => participantRaceRepository({ client }).findByRaceAndUser('r', 'u'),
      (client: PlukaClient) => participantRaceRepository({ client }).listRoster('r', 10),
      (client: PlukaClient) =>
        participantRaceRepository({ client }).claimForUser('pr-1', 'u', 'a@b.c', 'now'),
      (client: PlukaClient) =>
        participantRaceSettingsRepository({ client }).findByParticipantRace('pr-1'),
    ];

    for (const read of reads) {
      const { client, calls } = fakeClient([]);
      await read(client);

      expect(projections(calls).join('|')).not.toContain('invite_email');
    }
  });
});

describe('participantRaceSettingsRepository', () => {
  it('lit les préférences par leur projection nommée', async () => {
    const { client, calls } = fakeClient(SETTINGS_ROW);

    const settings = await participantRaceSettingsRepository({ client }).findByParticipantRace(
      'pr-1',
    );

    expect(calls[0]).toBe('from:participant_race_settings');
    expect(settings).toEqual({
      participantRaceId: 'pr-1',
      targetDurationSeconds: 43_200,
      assistanceStatus: 'to_define',
      nutritionEnabled: false,
      nutritionWaypointsVisible: true,
      repereVisible: false,
      notificationsEnabled: true,
    });
  });

  it('crée la ligne au besoin, sans toucher aux autres préférences', async () => {
    // L'`upsert` n'écrit que l'objectif : les notifications, l'Assistance et
    // l'affichage gardent leur valeur — ou, à la création, celle de la colonne.
    const { client, calls } = fakeClient(SETTINGS_ROW);

    await participantRaceSettingsRepository({ client }).upsertTargetDuration('pr-1', 43_200);

    expect(calls).toContain(
      'upsert:{"participant_race_id":"pr-1","target_duration_seconds":43200}:{"onConflict":"participant_race_id"}',
    );
  });
});

describe('accountRepository', () => {
  it('rend l’email du compte, et seulement pour l’identifiant demandé', async () => {
    const { client, calls } = fakeClient({ id: 'user-1', email: 'runner@test.pluka' });

    await expect(accountRepository({ client }).findAccountEmail('user-1')).resolves.toBe(
      'runner@test.pluka',
    );
    expect(calls).toContain('eq:id=user-1');
  });

  it('rend null pour un compte inconnu', async () => {
    const { client } = fakeClient(null);

    await expect(accountRepository({ client }).findAccountEmail('inconnu')).resolves.toBeNull();
  });
});
