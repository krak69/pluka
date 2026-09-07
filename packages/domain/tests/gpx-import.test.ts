import { raceGpxStoragePath } from '@pluka/db';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  courseQuality,
  divergenceRatio,
  DomainError,
  getRaceGpxImport,
  importRaceGpx,
  importStage,
  MAX_GPX_BYTES,
  type GpxImportContext,
} from '../src/index.js';
import {
  ADMIN_A,
  baseGpxState,
  baseState,
  createFakeGpxRepositories,
  EDITOR_A,
  ORPHAN_RACE_ID,
  OUTSIDER,
  OWNER_B,
  PLUKA_ADMIN,
  RACE_ID,
  VIEWER_A,
  type FakeGpxState,
  type FakeState,
} from './fixtures/repositories.js';

/**
 * Import GPX — 01_ARCHITECTURE §15, PLAN_ENGINE §8, §9, §9.1.
 *
 * Le use case ne traite pas le fichier : il le dépose et enfile un job. Ce
 * qui se teste ici est donc l'autorité, la forme de l'entrée, l'ordre des deux
 * écritures, et la lecture d'état — pas le parsing, qui appartient au worker.
 */

let state: FakeState;
let gpx: FakeGpxState;

function contextFor(userId: string): GpxImportContext {
  return { repositories: createFakeGpxRepositories(state, gpx), actor: { userId } };
}

/** Empreinte quelconque mais bien formée : 64 caractères hexadécimaux. */
const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);

const TRACE = '<?xml version="1.0"?><gpx><trk><trkseg /></trk></gpx>';

function command(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    raceId: RACE_ID,
    fileName: 'parcours.gpx',
    content: TRACE,
    contentHash: HASH,
    ...overrides,
  };
}

async function expectDomainError(
  action: Promise<unknown>,
  code: DomainError['code'],
): Promise<DomainError> {
  try {
    await action;
    expect.unreachable('une DomainError était attendue');
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return error as DomainError;
  }
}

beforeEach(() => {
  state = baseState();
  gpx = baseGpxState();
});

describe('autorisation — écriture de contenu de course', () => {
  it('autorise l’éditeur de l’organisation gestionnaire', async () => {
    const receipt = await importRaceGpx(contextFor(EDITOR_A), command());

    expect(receipt.raceId).toBe(RACE_ID);
    expect(receipt.sourceSnapshotId).not.toBe('');
  });

  it('autorise l’admin de l’organisation, et l’admin plateforme', async () => {
    await expect(importRaceGpx(contextFor(ADMIN_A), command())).resolves.toBeDefined();
    await expect(
      importRaceGpx(contextFor(PLUKA_ADMIN), command({ contentHash: OTHER_HASH })),
    ).resolves.toBeDefined();
  });

  it('refuse un viewer : lire n’est pas modifier le parcours', async () => {
    await expectDomainError(importRaceGpx(contextFor(VIEWER_A), command()), 'forbidden');
  });

  it('refuse une autre organisation', async () => {
    await expectDomainError(importRaceGpx(contextFor(OWNER_B), command()), 'forbidden');
  });

  it('refuse un inconnu', async () => {
    await expectDomainError(importRaceGpx(contextFor(OUTSIDER), command()), 'forbidden');
  });

  it('réserve une épreuve sans organisation à `pluka_admin` — §4.1', async () => {
    await expectDomainError(
      importRaceGpx(contextFor(EDITOR_A), command({ raceId: ORPHAN_RACE_ID })),
      'forbidden',
    );

    await expect(
      importRaceGpx(contextFor(PLUKA_ADMIN), command({ raceId: ORPHAN_RACE_ID })),
    ).resolves.toBeDefined();
  });

  it('ne dépose rien quand l’autorité manque', async () => {
    // La garde passe avant l'écriture : un refus ne doit laisser aucun objet
    // dans le bucket.
    await expectDomainError(importRaceGpx(contextFor(VIEWER_A), command()), 'forbidden');

    expect(gpx.objects.size).toBe(0);
    expect(gpx.snapshots.size).toBe(0);
  });

  it('refuse une épreuve inexistante', async () => {
    await expectDomainError(
      importRaceGpx(
        contextFor(PLUKA_ADMIN),
        command({ raceId: 'aaaaaaaa-0000-4000-8000-0000000fffff' }),
      ),
      'not_found',
    );
  });

  it('refuse un identifiant d’épreuve mal formé', async () => {
    const error = await expectDomainError(
      importRaceGpx(contextFor(PLUKA_ADMIN), command({ raceId: 'pas-un-uuid' })),
      'validation',
    );

    expect(error.details['raceId']).toBeDefined();
  });
});

describe('entrée refusée avec le champ nommé', () => {
  it('refuse un fichier qui n’est pas un .gpx', async () => {
    const error = await expectDomainError(
      importRaceGpx(contextFor(EDITOR_A), command({ fileName: 'parcours.png' })),
      'validation',
    );

    expect(error.details['fileName']).toBeDefined();
  });

  it('refuse un fichier vide', async () => {
    const error = await expectDomainError(
      importRaceGpx(contextFor(EDITOR_A), command({ content: '' })),
      'validation',
    );

    expect(error.details['content']).toBeDefined();
  });

  it('refuse une empreinte mal formée', async () => {
    // Elle sert de nom d'objet et de clé d'idempotence : une empreinte
    // fantaisiste produirait un chemin que la policy ne saurait pas rattacher.
    const error = await expectDomainError(
      importRaceGpx(contextFor(EDITOR_A), command({ contentHash: 'PAS-UN-HASH' })),
      'validation',
    );

    expect(error.details['contentHash']).toBeDefined();
  });

  it('refuse un fichier au-delà de la limite du bucket', async () => {
    const error = await expectDomainError(
      importRaceGpx(contextFor(EDITOR_A), command({ content: 'x'.repeat(MAX_GPX_BYTES + 1) })),
      'validation',
    );

    expect(error.details['content']).toBeDefined();
  });

  it('compte des octets, pas des caractères', async () => {
    // Un GPX est de l'UTF-8 : un nom de sommet accentué pèse plus que sa
    // longueur de chaîne, et la borne du bucket porte sur les octets.
    const justUnder = 'é'.repeat(MAX_GPX_BYTES / 2);

    await expect(
      importRaceGpx(contextFor(EDITOR_A), command({ content: justUnder })),
    ).resolves.toBeDefined();

    await expectDomainError(
      importRaceGpx(contextFor(EDITOR_A), command({ content: `${justUnder}é` })),
      'validation',
    );
  });
});

describe('dépôt puis enfilage', () => {
  it('écrit le fichier au chemin que la policy sait rattacher', async () => {
    const receipt = await importRaceGpx(contextFor(EDITOR_A), command());

    expect(receipt.storagePath).toBe(raceGpxStoragePath(RACE_ID, HASH));
    expect(gpx.objects.get(receipt.storagePath)).toBe(TRACE);
  });

  it('enfile un job pour le fichier déposé', async () => {
    await importRaceGpx(contextFor(EDITOR_A), command());

    expect(gpx.snapshots.has(`gpx.process:${RACE_ID}:${HASH}`)).toBe(true);
  });

  it('ne crée pas deux traitements pour le même fichier — §22.1', async () => {
    const first = await importRaceGpx(contextFor(EDITOR_A), command());
    const second = await importRaceGpx(contextFor(EDITOR_A), command());

    expect(second.sourceSnapshotId).toBe(first.sourceSnapshotId);
    expect(gpx.snapshots.size).toBe(1);
    expect(gpx.objects.size).toBe(1);
  });

  it('traite un fichier différent comme un nouveau dépôt', async () => {
    const first = await importRaceGpx(contextFor(EDITOR_A), command());
    const second = await importRaceGpx(contextFor(EDITOR_A), command({ contentHash: OTHER_HASH }));

    expect(second.sourceSnapshotId).not.toBe(first.sourceSnapshotId);
    expect(gpx.objects.size).toBe(2);
  });
});

describe('état du traitement', () => {
  it('dit qu’aucun GPX n’a été importé', async () => {
    const status = await getRaceGpxImport(contextFor(EDITOR_A), { raceId: RACE_ID });

    expect(status.stage).toBe('none');
    expect(status.source).toBeNull();
  });

  it('passe en attente dès le dépôt', async () => {
    await importRaceGpx(contextFor(EDITOR_A), command());

    const status = await getRaceGpxImport(contextFor(EDITOR_A), { raceId: RACE_ID });

    expect(status.stage).toBe('queued');
    expect(status.snapshot?.contentHash).toBe(HASH);
  });

  it('demande la même autorité que le dépôt', async () => {
    // Savoir qu'un traitement a échoué est une information d'administration
    // de course, pas une lecture publique.
    await expectDomainError(
      getRaceGpxImport(contextFor(VIEWER_A), { raceId: RACE_ID }),
      'forbidden',
    );
  });
});

/** Enveloppe minimale d'un état d'import, pour éprouver les fonctions pures. */
function record(overrides: Record<string, unknown> = {}): never {
  return {
    raceId: RACE_ID,
    officialDistanceMeters: null,
    officialElevationGainMeters: null,
    source: null,
    snapshot: null,
    job: null,
    geometry: null,
    ...overrides,
  } as never;
}

function job(status: string): Record<string, unknown> {
  return {
    status,
    attempts: 1,
    maxAttempts: 5,
    lastError: null,
    startedAt: null,
    completedAt: null,
  };
}

function geometry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'g',
    versionNumber: 1,
    pointCount: 1000,
    lengthMeters: 42000,
    elevationGainMeters: 2050,
    elevationLossMeters: 2050,
    processorVersion: 'gpx-1',
    processedAt: '2026-03-01T08:00:00Z',
    preprocessingStatus: 'completed',
    preprocessingIssue: null,
    preprocessingWarnings: [],
    preprocessedAt: '2026-03-01T08:00:00Z',
    microSegmentCount: 420,
    ...overrides,
  };
}

/** Un constat tel que le moteur le rend et que 0026 le persiste. */
function warning(code: string, message: string): Record<string, unknown> {
  return { code, level: 'warning', message };
}

describe('étape lisible — `importStage`', () => {
  it('rend `none` avant tout dépôt', () => {
    expect(importStage(record())).toBe('none');
  });

  it('rend `queued` quand le job attend', () => {
    expect(importStage(record({ source: {}, job: job('queued') }))).toBe('queued');
    expect(importStage(record({ source: {}, job: job('running') }))).toBe('running');
  });

  it('rend `failed` sur échec comme sur annulation', () => {
    expect(importStage(record({ source: {}, job: job('failed') }))).toBe('failed');
    expect(importStage(record({ source: {}, job: job('cancelled') }))).toBe('failed');
  });

  it('rend `completed` quand la géométrie est prétraitée', () => {
    expect(importStage(record({ source: {}, job: job('completed'), geometry: geometry() }))).toBe(
      'completed',
    );
  });

  it('distingue un prétraitement en attente d’un prétraitement bloqué', () => {
    // §9.1 : la géométrie est valide dans les deux cas. Ce qui change, c'est
    // qu'un blocage demande une décision — un Plan reste impossible sans elle.
    expect(
      importStage(
        record({
          source: {},
          job: job('completed'),
          geometry: geometry({ preprocessingStatus: 'pending' }),
        }),
      ),
    ).toBe('preprocessing_pending');

    expect(
      importStage(
        record({
          source: {},
          job: job('completed'),
          geometry: geometry({ preprocessingStatus: 'blocked' }),
        }),
      ),
    ).toBe('blocked');
  });
});

describe('contrôles qualité — §9, §9.1', () => {
  it('ne signale rien quand le moteur n’a rien constaté', () => {
    expect(courseQuality(record({ geometry: geometry() }))).toEqual([]);
  });

  it('reprend les constats du moteur tels quels', () => {
    // Ils ne sont pas recalculés ici : le moteur compare le parcours
    // ré-échantillonné, le domaine ne verrait que la longueur brute, et les
    // deux verdicts divergeraient.
    const findings = courseQuality(
      record({
        officialDistanceMeters: 42000,
        geometry: geometry({
          lengthMeters: 60000,
          preprocessingWarnings: [
            warning(
              'GPX_DISTANCE_MISMATCH',
              'écart de 42.9 % entre la distance GPX et la distance officielle',
            ),
          ],
        }),
      }),
    );

    expect(findings).toEqual([
      {
        code: 'GPX_DISTANCE_MISMATCH',
        level: 'warning',
        message: 'écart de 42.9 % entre la distance GPX et la distance officielle',
      },
    ]);
  });

  it('remonte le contrôle de D+ de §9', () => {
    // « D+ GPX vs officiel > 15 % → warning qualité ». Il était perdu : le D+
    // mesuré n'était persisté nulle part, et le warning partait en logs.
    const findings = courseQuality(
      record({
        officialElevationGainMeters: 2000,
        geometry: geometry({
          elevationGainMeters: 3200,
          preprocessingWarnings: [
            warning('GPX_GAIN_MISMATCH', 'écart de 60.0 % entre le D+ GPX et le D+ officiel'),
          ],
        }),
      }),
    );

    expect(findings.map((finding) => finding.code)).toEqual(['GPX_GAIN_MISMATCH']);
  });

  it('constate sans corriger — §9.1', () => {
    // Les valeurs mesurées restent celles du fichier : un constat n'est pas un
    // réalignement.
    const status = record({
      officialElevationGainMeters: 2000,
      geometry: geometry({
        elevationGainMeters: 3200,
        preprocessingWarnings: [warning('GPX_GAIN_MISMATCH', 'écart de 60.0 %')],
      }),
    });

    expect(courseQuality(status)).toHaveLength(1);
    expect(
      (status as { geometry: { elevationGainMeters: number } }).geometry.elevationGainMeters,
    ).toBe(3200);
  });

  it('ajoute le blocage de §9.1 aux constats du moteur', () => {
    // Le blocage n'est pas un warning du moteur : c'est son refus. Les deux se
    // lisent au même endroit.
    const findings = courseQuality(
      record({
        geometry: geometry({
          preprocessingStatus: 'blocked',
          preprocessingIssue: 'waypoint « Ravito 2 » à 312 m de la trace',
          preprocessingWarnings: [],
        }),
      }),
    );

    expect(findings).toEqual([
      {
        code: 'PREPROCESSING_BLOCKED',
        level: 'error',
        message: 'waypoint « Ravito 2 » à 312 m de la trace',
      },
    ]);
  });

  it('n’invente aucun constat sans géométrie', () => {
    expect(courseQuality(record({ officialDistanceMeters: 42000 }))).toEqual([]);
  });
});

describe('écart affichable', () => {
  it('rend l’écart relatif entre mesuré et déclaré', () => {
    // Pour l'affichage seulement : le verdict appartient au moteur.
    expect(divergenceRatio(2300, 2000)).toBeCloseTo(0.15, 5);
    expect(divergenceRatio(1700, 2000)).toBeCloseTo(0.15, 5);
  });

  it('ne compare pas à une valeur officielle absente ou nulle', () => {
    expect(divergenceRatio(2300, null)).toBeNull();
    expect(divergenceRatio(2300, 0)).toBeNull();
  });

  it('ne compare pas une mesure absente', () => {
    // Une géométrie d'avant 0026 n'a pas de D+ : ne rien dire vaut mieux que
    // laisser croire à un écart nul.
    expect(divergenceRatio(null, 2000)).toBeNull();
  });
});
