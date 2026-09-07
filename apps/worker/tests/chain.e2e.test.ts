import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServiceRoleClient } from '@pluka/db/server';
import { PROCESSOR_VERSION } from '@pluka/gpx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { tick } from '../src/loop.js';
import { createPorts } from '../src/ports-supabase.js';
import type { WorkerPorts } from '../src/ports.js';

/** Base des liens dans les courriels de test — le worker la reçoit, il ne la devine pas. */
const TEST_APP_URL = 'http://localhost:3001';

/**
 * Chaînage complet contre la base locale.
 *
 *   dépôt → outbox → pgmq → worker → parsing → persistance
 *
 * Tout est réel : les fonctions SQL de la migration 0008, la file pgmq, le
 * bucket de stockage, le moteur `@pluka/gpx`, PostGIS. Rien n'est simulé.
 *
 * C'est le seul test qui prouve que les pièces s'emboîtent : les tests
 * unitaires du worker vérifient ses décisions, ceux de `@pluka/gpx` son
 * calcul, mais aucun ne dirait qu'un `LINESTRING Z` produit ici est accepté
 * par la colonne `geometry(LineStringZ, 4326)`.
 *
 * Nécessite `supabase start`. Ignoré sinon plutôt que rouge : un test
 * d'intégration absent d'un poste sans Docker ne doit pas masquer une vraie
 * régression.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REFERENCE_GPX = readFileSync(
  resolve(HERE, '..', '..', '..', 'packages', 'gpx', 'tests', 'fixtures', 'reference.gpx'),
  'utf8',
);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const BUCKET = 'race-sources';

const ORG_ID = 'eeeeeeee-0000-4000-8000-000000000001';
const EVENT_ID = 'eeeeeeee-0000-4000-8000-000000000002';
const EDITION_ID = 'eeeeeeee-0000-4000-8000-000000000003';
const RACE_ID = 'eeeeeeee-0000-4000-8000-000000000004';

const contentHash = createHash('sha256').update(REFERENCE_GPX).digest('hex');
const storagePath = `${RACE_ID}/reference.gpx`;
const idempotencyKey = `gpx.process:${RACE_ID}:${contentHash}`;

type ServiceClient = ReturnType<typeof createServiceRoleClient>;
type Rpc = {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

let client: ServiceClient;
let ports: WorkerPorts;
let available = false;

async function reachable(): Promise<boolean> {
  if (SERVICE_KEY === '') return false;

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: SERVICE_KEY },
      signal: AbortSignal.timeout(2000),
    });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

/** Insère la hiérarchie minimale : organisation → événement → édition → course. */
async function seed(): Promise<void> {
  await client.from('organizations').insert({ id: ORG_ID, name: 'Org GPX', slug: 'org-gpx' });
  await client.from('events').insert({
    id: EVENT_ID,
    organization_id: ORG_ID,
    name: 'Trail GPX',
    slug: 'trail-gpx',
    status: 'published',
  });
  await client.from('editions').insert({
    id: EDITION_ID,
    event_id: EVENT_ID,
    year: 2026,
    slug: 'trail-gpx-2026',
    start_date: '2026-06-20',
    status: 'published',
  });
  await client.from('races').insert({
    id: RACE_ID,
    edition_id: EDITION_ID,
    name: '80K',
    slug: '80k',
    distance_km: 80,
    start_datetime: '2026-06-20T04:00:00Z',
    timezone: 'Europe/Paris',
    status: 'draft',
  });

  await client.storage.from(BUCKET).upload(storagePath, new Blob([REFERENCE_GPX]), {
    contentType: 'application/gpx+xml',
    upsert: true,
  });
}

async function cleanup(): Promise<void> {
  await client.storage.from(BUCKET).remove([storagePath]);
  await client.from('organizations').delete().eq('id', ORG_ID);
  // events / editions / races / sources tombent en cascade ; le job et
  // l'événement outbox sont retirés par leur clé.
  await (client as unknown as Rpc).rpc('worker_fail_ingestion_job', {
    p_idempotency_key: idempotencyKey,
    p_error: 'nettoyage de test',
  });
}

beforeAll(async () => {
  available = await reachable();
  if (!available) return;

  client = createServiceRoleClient({ url: SUPABASE_URL, secretKey: SERVICE_KEY });
  ports = createPorts(client, { appUrl: TEST_APP_URL });

  await cleanup().catch(() => undefined);
  await seed();
}, 60000);

afterAll(async () => {
  if (available) await cleanup().catch(() => undefined);
}, 60000);

describe.runIf(process.env.SUPABASE_SERVICE_ROLE_KEY !== undefined)('chaîne complète', () => {
  it('dépose le GPX en une transaction : source, snapshot, job, outbox', async () => {
    if (!available) return;

    const { data, error } = await (client as unknown as Rpc).rpc('enqueue_race_gpx', {
      p_race_id: RACE_ID,
      p_storage_path: storagePath,
      p_content_hash: contentHash,
      p_title: 'Trace de référence',
    });

    expect(error).toBeNull();
    expect(typeof data).toBe('string');

    // Le job existe, en attente, avec sa clé d'idempotence (§22.1).
    const claim = await ports.jobs.claim(idempotencyKey);
    expect(claim).not.toBeNull();
    expect(claim?.maxAttempts).toBeGreaterThan(0);
  });

  it('traduit l’outbox en message pgmq puis persiste la géométrie', async () => {
    if (!available) return;

    // Un tour complet : dispatch outbox → lecture pgmq → parsing → persistance.
    const result = await tick(ports);

    expect(result.dispatched).toBeGreaterThanOrEqual(1);
    expect(result.processed).toBeGreaterThanOrEqual(1);

    const { data: race } = await client
      .from('races')
      .select('current_course_geometry_id')
      .eq('id', RACE_ID)
      .maybeSingle();

    expect(race?.current_course_geometry_id).not.toBeNull();

    const { data: geometry } = await client
      .from('race_course_geometries')
      .select('id, point_count, length_m, processor_version, version_number')
      .eq('race_id', RACE_ID)
      .maybeSingle();

    expect(geometry?.point_count).toBe(200);
    expect(geometry?.processor_version).toBe(PROCESSOR_VERSION);
    expect(geometry?.version_number).toBe(1);
    // ~2 km, comme la trace de référence.
    expect(Number(geometry?.length_m)).toBeGreaterThan(1980);
    expect(Number(geometry?.length_m)).toBeLessThan(2000);
  }, 60000);

  it('marque le job terminé et vide la file', async () => {
    if (!available) return;

    const claim = await ports.jobs.claim(idempotencyKey);
    expect(claim?.status).toBe('completed');

    // Plus rien à consommer : le message a été archivé.
    const messages = await ports.queue.read('pluka_geo', 5, 10);
    expect(messages).toHaveLength(0);
  });

  it('ne crée pas une seconde géométrie si le message revient', async () => {
    if (!available) return;

    // §22.1 : « un retry ne doit pas créer deux versions identiques ». On
    // rejoue exactement ce que ferait un message revenu après la mort du
    // processus, en repassant par la persistance réelle.
    const geometryId = await ports.geometries.persist({
      raceId: RACE_ID,
      sourceSnapshotId: '00000000-0000-4000-8000-000000000000',
      track: {
        processorVersion: PROCESSOR_VERSION,
        trackName: null,
        points: [
          { latitude: 45.9, longitude: 6.8, elevationMeters: 1000, distanceMeters: 0 },
          { latitude: 45.91, longitude: 6.8, elevationMeters: 1010, distanceMeters: 100 },
        ],
        pointCount: 2,
        lengthMeters: 100,
        elevationGainMeters: 10,
        elevationLossMeters: 0,
        minElevationMeters: 1000,
        maxElevationMeters: 1010,
        quality: {
          pointCount: 2,
          missingElevationCount: 0,
          missingElevationRatio: 0,
          eligibleForReliefModel: true,
          extremeGradeCount: 0,
          cleaning: { duplicatesRemoved: 0, outliersRemoved: 0, implausibleElevationsDropped: 0 },
        },
      },
      idempotencyKey,
    });

    const { data: geometries } = await client
      .from('race_course_geometries')
      .select('id')
      .eq('race_id', RACE_ID);

    // Une seule version, et c'est bien celle du premier traitement.
    expect(geometries).toHaveLength(1);
    expect(geometries?.[0]?.id).toBe(geometryId);
  });

  it('redéposer le même fichier ne crée pas un second job', async () => {
    if (!available) return;

    // Idempotence du dépôt : la clé est (course, empreinte du contenu).
    const { data: again, error } = await (client as unknown as Rpc).rpc('enqueue_race_gpx', {
      p_race_id: RACE_ID,
      p_storage_path: storagePath,
      p_content_hash: contentHash,
      p_title: 'Trace de référence',
    });

    expect(error).toBeNull();
    expect(typeof again).toBe('string');

    const { data: sources } = await client
      .from('sources')
      .select('id')
      .eq('edition_id', EDITION_ID);
    expect(sources).toHaveLength(1);
  });

  it('écrit une géométrie PostGIS relisable', async () => {
    if (!available) return;

    // La preuve que le EWKT produit par `@pluka/gpx` est accepté par la
    // colonne `geometry(LineStringZ, 4326)` — et pas seulement une chaîne
    // bien formée côté TypeScript.
    const { data } = await client
      .from('race_course_geometries')
      .select('point_count, simplified_geometry')
      .eq('race_id', RACE_ID)
      .maybeSingle();

    expect(data?.point_count).toBe(200);
    expect(data?.simplified_geometry).not.toBeNull();
  });
});
