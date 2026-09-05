import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

import { handleGpxMessage } from '../src/jobs/gpx-process.js';
import { tick } from '../src/loop.js';
import { formatForStorage, normalizeError, permanent, transient } from '../src/errors.js';
import type { JobClaim, QueueMessage, WorkerPorts } from '../src/ports.js';

/**
 * Idempotence et gestion d'échec — 01_ARCHITECTURE §22.1.
 *
 * Ces tests emploient des frontières en mémoire : ce qui est vérifié ici est
 * la décision du worker — réclamer, archiver, réessayer, abandonner — pas le
 * SQL, que le test de bout en bout exerce pour de vrai.
 *
 * « Un retry ne doit pas créer deux versions identiques » : c'est la propriété
 * centrale, et un message pgmq revient nécessairement un jour, ne serait-ce
 * que si le processus meurt entre la persistance et l'archivage.
 */

const REFERENCE_GPX = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'packages',
    'gpx',
    'tests',
    'fixtures',
    'reference.gpx',
  ),
  'utf8',
);

const IDEMPOTENCY_KEY = 'gpx.process:race-1:hash-1';

interface Recorder {
  ports: WorkerPorts;
  readonly persisted: { count: number; keys: string[] };
  readonly archived: number[];
  readonly failures: { key: string; error: string }[];
  job: JobClaim;
  downloadError: Error | null;
  gpxContent: string;
}

function createRecorder(): Recorder {
  const persisted = { count: 0, keys: [] as string[] };
  const archived: number[] = [];
  const failures: { key: string; error: string }[] = [];
  const geometryByKey = new Map<string, string>();

  const state: Recorder = {
    ports: undefined as unknown as WorkerPorts,
    persisted,
    archived,
    failures,
    job: { jobId: 'job-1', status: 'running', attempts: 1, maxAttempts: 5 },
    downloadError: null,
    gpxContent: REFERENCE_GPX,
  };

  const ports: WorkerPorts = {
    queue: {
      read: async (): Promise<readonly QueueMessage[]> => [],
      archive: async (_queue: string, msgId: number): Promise<void> => {
        archived.push(msgId);
      },
    },
    jobs: {
      claim: async (): Promise<JobClaim | null> => state.job,
      fail: async (key: string, error: string): Promise<string | null> => {
        failures.push({ key, error });
        return state.job.attempts >= state.job.maxAttempts ? 'failed' : 'queued';
      },
    },
    objects: {
      downloadText: async (): Promise<string> => {
        if (state.downloadError !== null) throw state.downloadError;
        return state.gpxContent;
      },
      upload: async (): Promise<void> => undefined,
    },
    sources: {
      fetch: async () => {
        throw new Error('non employé dans ces tests');
      },
      knownHashes: async () => [],
      recordSnapshot: async () => ({ snapshotId: 'snapshot-1', created: true }),
      markFailed: async (): Promise<void> => undefined,
    },
    geometries: {
      // Reproduit la garantie de `private.persist_race_geometry` : rejouer
      // une clé déjà persistée rend la géométrie existante.
      persist: async ({ idempotencyKey }): Promise<string> => {
        const existing = geometryByKey.get(idempotencyKey);
        if (existing !== undefined) return existing;

        persisted.count += 1;
        persisted.keys.push(idempotencyKey);
        const id = `geometry-${persisted.count}`;
        geometryByKey.set(idempotencyKey, id);
        return id;
      },
    },
    parsing: {
      startRun: async () => ({ runId: 'run-1', alreadyCompleted: false }),
      completeRun: async () => 0,
      failRun: async (): Promise<void> => undefined,
    },
    outbox: { dispatch: async (): Promise<number> => 0 },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };

  state.ports = ports;
  return state;
}

function message(overrides: Partial<QueueMessage['payload']> = {}, msgId = 1): QueueMessage {
  return {
    msgId,
    readCount: 1,
    payload: {
      raceId: '11111111-1111-4111-8111-111111111111',
      sourceSnapshotId: '22222222-2222-4222-8222-222222222222',
      storagePath: 'races/80k.gpx',
      idempotencyKey: IDEMPOTENCY_KEY,
      ...overrides,
    },
  };
}

let recorder: Recorder;

beforeEach(() => {
  recorder = createRecorder();
});

describe('traitement nominal', () => {
  it('persiste la géométrie et rend son identifiant', async () => {
    const outcome = await handleGpxMessage(recorder.ports, message());

    expect(outcome).toEqual({ kind: 'processed', geometryId: 'geometry-1' });
    expect(recorder.persisted.count).toBe(1);
  });
});

describe('idempotence', () => {
  it('ne retraite pas un job déjà terminé', async () => {
    // Le cas normal du message revenant : le processus est mort entre la
    // persistance et l'archivage.
    recorder.job = { ...recorder.job, status: 'completed' };

    const outcome = await handleGpxMessage(recorder.ports, message());

    expect(outcome).toEqual({ kind: 'already_done' });
    expect(recorder.persisted.count).toBe(0);
  });

  it('ne crée pas deux géométries pour la même clé', async () => {
    // §22.1 : « un retry ne doit pas créer deux versions identiques ».
    await handleGpxMessage(recorder.ports, message());
    await handleGpxMessage(recorder.ports, message({}, 2));

    expect(recorder.persisted.count).toBe(1);
    expect(recorder.persisted.keys).toEqual([IDEMPOTENCY_KEY]);
  });

  it('abandonne un message sans job connu', async () => {
    recorder.ports.jobs.claim = async () => null;

    const outcome = await handleGpxMessage(recorder.ports, message());

    expect(outcome).toEqual({ kind: 'abandoned', code: 'JOB_UNKNOWN' });
  });
});

describe('échecs', () => {
  it('abandonne un GPX invalide sans user de tentative', async () => {
    // Un fichier invalide le restera : le réessayer cinq fois ne sert à rien.
    recorder.gpxContent = '<html>pas un gpx</html>';

    const outcome = await handleGpxMessage(recorder.ports, message());

    expect(outcome.kind).toBe('abandoned');
    expect(recorder.failures[0]?.error).toContain('GPX_INVALID');
    expect(recorder.failures[0]?.error).toContain('[permanent]');
  });

  it('demande un retry sur une indisponibilité du stockage', async () => {
    // Transitoire : le stockage peut revenir.
    recorder.downloadError = new Error('ECONNRESET');

    const outcome = await handleGpxMessage(recorder.ports, message());

    expect(outcome.kind).toBe('retry');
    expect(recorder.failures[0]?.error).toContain('[transient]');
  });

  it('abandonne quand les tentatives sont épuisées', async () => {
    // `fail_ingestion_job` rend `failed` au-delà de max_attempts : le worker
    // cesse alors de reprendre le message.
    recorder.job = { ...recorder.job, attempts: 5, maxAttempts: 5 };
    recorder.downloadError = new Error('ECONNRESET');

    const outcome = await handleGpxMessage(recorder.ports, message());

    expect(outcome.kind).toBe('abandoned');
  });

  it('abandonne une charge utile incomplète', async () => {
    const outcome = await handleGpxMessage(recorder.ports, {
      msgId: 7,
      readCount: 1,
      payload: { raceId: 'seul' },
    });

    expect(outcome).toEqual({ kind: 'abandoned', code: 'PAYLOAD_INVALID' });
  });
});

describe('erreurs normalisées', () => {
  it('conserve le code et la nature d’une erreur classée', () => {
    expect(normalizeError(permanent('X', 'motif'))).toEqual({
      kind: 'permanent',
      code: 'X',
      message: 'X : motif',
    });
  });

  it('traite une erreur inconnue comme transitoire', () => {
    // Un incident non classé mérite ses tentatives plutôt qu'un abandon.
    expect(normalizeError(new TypeError('boom')).kind).toBe('transient');
  });

  it('ne recopie pas le message d’une erreur inconnue', () => {
    // Il pourrait contenir une requête, un chemin ou un fragment de fichier
    // (03_PRIVACY_RLS §130).
    const normalized = normalizeError(new Error('select * from users where email = x'));

    expect(normalized.message).not.toContain('select');
    expect(normalized.message).not.toContain('email');
  });

  it('produit une ligne courte et lisible pour le stockage', () => {
    expect(formatForStorage(normalizeError(transient('NET', 'coupure')))).toBe(
      '[transient] NET : NET : coupure',
    );
  });
});

describe('boucle', () => {
  it('archive un message traité et laisse revenir un retry', async () => {
    const messages = [message({}, 10), message({ idempotencyKey: 'autre' }, 11)];
    let call = 0;

    recorder.ports.queue.read = async () => (call++ === 0 ? messages : []);
    recorder.ports.jobs.claim = async (key) =>
      key === 'autre'
        ? { jobId: 'job-2', status: 'running', attempts: 1, maxAttempts: 5 }
        : recorder.job;

    // Le second échoue de façon transitoire.
    let downloads = 0;
    recorder.ports.objects.downloadText = async () => {
      downloads += 1;
      if (downloads === 2) throw new Error('ECONNRESET');
      return REFERENCE_GPX;
    };

    const result = await tick(recorder.ports);

    expect(result.processed).toBe(1);
    expect(result.retried).toBe(1);
    // Seul le message traité est archivé : l'autre doit revenir.
    expect(recorder.archived).toEqual([10]);
  });

  it('vide l’outbox avant de lire la file', async () => {
    // §22.2 : sans dispatch, un événement écrit en base n'atteint jamais sa
    // file, et le worker tournerait à vide en permanence.
    const order: string[] = [];

    recorder.ports.outbox.dispatch = async () => {
      order.push('dispatch');
      return 3;
    };
    recorder.ports.queue.read = async (queue) => {
      order.push(`read:${queue}`);
      return [];
    };

    const result = await tick(recorder.ports);

    expect(order[0]).toBe('dispatch');
    expect(result.dispatched).toBe(3);
  });

  it('consomme les deux files du lot', () => {
    // Les queues sont groupées par domaine, pas une par type de job
    // (migration 0002) : le worker en lit plusieurs par tour.
    const order: string[] = [];

    recorder.ports.queue.read = async (queue) => {
      order.push(queue);
      return [];
    };

    return tick(recorder.ports).then(() => {
      expect(order).toEqual(['pluka_geo', 'pluka_sources']);
    });
  });
});
