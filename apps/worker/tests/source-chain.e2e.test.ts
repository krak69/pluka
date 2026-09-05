import { createServiceRoleClient } from '@pluka/db/server';
import { contentHash, snapshotStoragePath, type Capture } from '@pluka/sources';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handleSourceMessage } from '../src/jobs/source-ingest.js';
import { tick } from '../src/loop.js';
import { createPorts } from '../src/ports-supabase.js';
import type { QueueMessage, WorkerPorts } from '../src/ports.js';

/**
 * Ingestion de sources, étape 1, contre la base locale.
 *
 *   déclaration → outbox → pgmq → worker → capture → snapshot immuable
 *
 * La capture réseau est la seule pièce simulée, et volontairement : un test
 * qui téléchargerait une vraie page dépendrait d'un serveur tiers, de sa
 * disponibilité et de son contenu — il ne dirait plus rien sur PLUKA. Le
 * `fetch` est donc remplacé, tout le reste est réel : fonctions SQL,
 * déduplication par empreinte, stockage, provenance.
 *
 * La politique SSRF, elle, est intégralement testée dans `@pluka/sources`,
 * sans réseau.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const BUCKET = 'race-sources';

const ORG_ID = 'ffffffff-0000-4000-8000-000000000001';
const EVENT_ID = 'ffffffff-0000-4000-8000-000000000002';
const EDITION_ID = 'ffffffff-0000-4000-8000-000000000003';

const ORIGINAL = '<html><body>Règlement 2026 — départ 04:00</body></html>';
const REVISED = '<html><body>Règlement 2026 — départ 05:00</body></html>';

type ServiceClient = ReturnType<typeof createServiceRoleClient>;
type Rpc = {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

let client: ServiceClient;
let ports: WorkerPorts;
let sourceId = '';
let available = false;

/** Contenu servi par la capture simulée. Modifiable d'un test à l'autre. */
let served = ORIGINAL;

function fakeCapture(url: string): Promise<Capture> {
  return Promise.resolve({
    bytes: new TextEncoder().encode(served),
    finalUrl: url,
    httpStatus: 200,
    contentType: 'text/html; charset=utf-8',
  });
}

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

async function cleanup(): Promise<void> {
  await client.from('organizations').delete().eq('id', ORG_ID);
}

beforeAll(async () => {
  available = await reachable();
  if (!available) return;

  client = createServiceRoleClient({ url: SUPABASE_URL, secretKey: SERVICE_KEY });

  // Seule la capture réseau est remplacée.
  ports = {
    ...createPorts(client),
    sources: { ...createPorts(client).sources, fetch: fakeCapture },
  };

  await cleanup().catch(() => undefined);

  await client
    .from('organizations')
    .insert({ id: ORG_ID, name: 'Org Sources', slug: 'org-sources' });
  await client.from('events').insert({
    id: EVENT_ID,
    organization_id: ORG_ID,
    name: 'Trail Sources',
    slug: 'trail-sources',
    status: 'published',
  });
  await client.from('editions').insert({
    id: EDITION_ID,
    event_id: EVENT_ID,
    year: 2026,
    slug: 'trail-sources-2026',
    start_date: '2026-06-20',
    status: 'published',
  });
}, 60000);

afterAll(async () => {
  if (available) await cleanup().catch(() => undefined);
}, 60000);

describe.runIf(process.env.SUPABASE_SERVICE_ROLE_KEY !== undefined)('ingestion de sources', () => {
  it('déclare la source et enfile sa capture en une transaction', async () => {
    if (!available) return;

    const { data, error } = await (client as unknown as Rpc).rpc('enqueue_source_ingest', {
      p_edition_id: EDITION_ID,
      p_source_type: 'url',
      p_title: 'Règlement officiel',
      p_url: 'https://organisation.example/reglement',
    });

    expect(error).toBeNull();
    sourceId = String(data);
    expect(sourceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('capture le contenu et enregistre un snapshot avec sa provenance', async () => {
    if (!available) return;

    const result = await tick(ports);

    expect(result.dispatched).toBeGreaterThanOrEqual(1);
    expect(result.processed).toBeGreaterThanOrEqual(1);

    const { data: snapshot } = await client
      .from('source_snapshots')
      .select('id, version_number, content_hash, content_type, size_bytes, final_url, http_status')
      .eq('source_id', sourceId)
      .maybeSingle();

    // §9 : la provenance connue au moment de la capture.
    expect(snapshot?.version_number).toBe(1);
    expect(snapshot?.content_hash).toBe(contentHash(new TextEncoder().encode(ORIGINAL)));
    expect(snapshot?.content_type).toBe('text/html');
    expect(snapshot?.final_url).toBe('https://organisation.example/reglement');
    expect(snapshot?.http_status).toBe(200);
    expect(Number(snapshot?.size_bytes)).toBe(new TextEncoder().encode(ORIGINAL).byteLength);
  }, 60000);

  it('stocke le contenu original, octet pour octet', async () => {
    if (!available) return;

    // « Stockage immuable du contenu original » : ce qui est relu doit être
    // exactement ce qui a été capturé, sans normalisation ni réencodage.
    const path = snapshotStoragePath(sourceId, contentHash(new TextEncoder().encode(ORIGINAL)));
    const { data, error } = await client.storage.from(BUCKET).download(path);

    expect(error).toBeNull();
    expect(await data?.text()).toBe(ORIGINAL);
  });

  it('fait pointer la source vers son snapshot courant', async () => {
    if (!available) return;

    const { data: source } = await client
      .from('sources')
      .select('current_snapshot_id, status')
      .eq('id', sourceId)
      .maybeSingle();

    expect(source?.current_snapshot_id).not.toBeNull();
    expect(source?.status).toBe('ready');
  });

  it('ne recrée pas de snapshot pour un contenu inchangé', async () => {
    if (!available) return;

    // §10 : « éviter les snapshots strictement identiques ». Le cas courant —
    // un règlement relu et inchangé.
    const outcome = await handleSourceMessage(ports, message());

    expect(outcome.kind).toBe('unchanged');

    const { data: snapshots } = await client
      .from('source_snapshots')
      .select('id')
      .eq('source_id', sourceId);

    expect(snapshots).toHaveLength(1);
  });

  it('crée une nouvelle version quand le contenu a changé', async () => {
    if (!available) return;

    // §36 : la détection de changement repose sur cette comparaison.
    served = REVISED;
    const outcome = await handleSourceMessage(ports, message());

    expect(outcome.kind).toBe('captured');

    const { data: snapshots } = await client
      .from('source_snapshots')
      .select('version_number, content_hash')
      .eq('source_id', sourceId)
      .order('version_number');

    expect(snapshots).toHaveLength(2);
    expect(snapshots?.[1]?.version_number).toBe(2);
    expect(snapshots?.[1]?.content_hash).toBe(contentHash(new TextEncoder().encode(REVISED)));
  });

  it('conserve le snapshot précédent : un snapshot est immuable', async () => {
    if (!available) return;

    // §9 : « une fois utilisé pour une publication, un snapshot ne doit pas
    // être modifié ». La v1 doit donc être intacte, contenu compris.
    const path = snapshotStoragePath(sourceId, contentHash(new TextEncoder().encode(ORIGINAL)));
    const { data } = await client.storage.from(BUCKET).download(path);

    expect(await data?.text()).toBe(ORIGINAL);
  });

  it('revient au contenu d’origine sans créer un troisième snapshot', async () => {
    if (!available) return;

    // Une page revenue à son état antérieur : l'empreinte est déjà connue.
    served = ORIGINAL;
    const outcome = await handleSourceMessage(ports, message());

    expect(outcome.kind).toBe('unchanged');

    const { data: snapshots } = await client
      .from('source_snapshots')
      .select('id')
      .eq('source_id', sourceId);

    expect(snapshots).toHaveLength(2);
  });

  it('marque la source en erreur sur une URL refusée', async () => {
    if (!available) return;

    // Une politique SSRF qui laisserait passer ceci ferait télécharger les
    // identifiants machine et les stockerait comme contenu de source.
    const blocked: WorkerPorts = {
      ...ports,
      sources: { ...ports.sources, fetch: createPorts(client).sources.fetch },
    };

    const outcome = await handleSourceMessage(blocked, {
      msgId: 99,
      readCount: 1,
      payload: {
        sourceId,
        url: 'http://169.254.169.254/latest/meta-data/',
        idempotencyKey: `source.ingest:${sourceId}`,
      },
    });

    expect(outcome.kind).toBe('abandoned');
    if (outcome.kind === 'abandoned') {
      expect(['URL_REJECTED', 'ADDRESS_BLOCKED']).toContain(outcome.code);
    }

    const { data: source } = await client
      .from('sources')
      .select('status')
      .eq('id', sourceId)
      .maybeSingle();

    expect(source?.status).toBe('failed');
  });
});

function message(): QueueMessage {
  return {
    msgId: 1,
    readCount: 1,
    payload: {
      sourceId,
      url: 'https://organisation.example/reglement',
      idempotencyKey: `source.ingest:${sourceId}`,
    },
  };
}
