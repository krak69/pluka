import { createServiceRoleClient } from '@pluka/db/server';
import { CHUNKER_VERSION, PARSER_VERSION, type Capture } from '@pluka/sources';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handleParseMessage } from '../src/jobs/source-parse.js';
import { tick } from '../src/loop.js';
import { createPorts } from '../src/ports-supabase.js';
import type { QueueMessage, WorkerPorts } from '../src/ports.js';

/**
 * Étape 2 contre la base locale : parsing et chunking.
 *
 *   snapshot → outbox → pgmq → worker → blocks + chunks + provenance
 *
 * Les tables privées sont réelles, les fonctions SQL aussi. Seule la capture
 * réseau de l'étape 1 est simulée, pour ne pas dépendre d'un serveur tiers.
 *
 * Deux propriétés y sont vérifiées de bout en bout, et elles sont l'objet même
 * du lot : re-parser un snapshot inchangé ne produit rien de nouveau, et un
 * changement de version de parseur est traçable.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const ORG_ID = 'aaaabbbb-0000-4000-8000-000000000001';
const EVENT_ID = 'aaaabbbb-0000-4000-8000-000000000002';
const EDITION_ID = 'aaaabbbb-0000-4000-8000-000000000003';

const REGLEMENT = `<html><body>
  <nav><a href="/">Accueil</a></nav>
  <main>
    <h1>Règlement 2026</h1>
    <p>Le présent règlement s'applique à toutes les épreuves.</p>
    <h2>Assistance</h2>
    <p>Assistance autorisée uniquement à Lenk.</p>
  </main>
  <footer>Mentions légales</footer>
</body></html>`;

type ServiceClient = ReturnType<typeof createServiceRoleClient>;
type Rpc = {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

let client: ServiceClient;
let ports: WorkerPorts;
let sourceId = '';
let snapshotId = '';
let storagePath = '';
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

function parseMessage(): QueueMessage {
  return {
    msgId: 1,
    readCount: 1,
    payload: {
      sourceId,
      snapshotId,
      storagePath,
      contentType: 'text/html',
      idempotencyKey: `source.parse:${snapshotId}`,
    },
  };
}

beforeAll(async () => {
  available = await reachable();
  if (!available) return;

  client = createServiceRoleClient({ url: SUPABASE_URL, secretKey: SERVICE_KEY });

  const capture = (url: string): Promise<Capture> =>
    Promise.resolve({
      bytes: new TextEncoder().encode(REGLEMENT),
      finalUrl: url,
      httpStatus: 200,
      contentType: 'text/html; charset=utf-8',
    });

  const base = createPorts(client);
  ports = { ...base, sources: { ...base.sources, fetch: capture } };

  await client.from('organizations').delete().eq('id', ORG_ID);
  await client.from('organizations').insert({ id: ORG_ID, name: 'Org Parse', slug: 'org-parse' });
  await client.from('events').insert({
    id: EVENT_ID,
    organization_id: ORG_ID,
    name: 'Trail Parse',
    slug: 'trail-parse',
    status: 'published',
  });
  await client.from('editions').insert({
    id: EDITION_ID,
    event_id: EVENT_ID,
    year: 2026,
    slug: 'trail-parse-2026',
    start_date: '2026-06-20',
    status: 'published',
  });

  const { data } = await (client as unknown as Rpc).rpc('enqueue_source_ingest', {
    p_edition_id: EDITION_ID,
    p_source_type: 'url',
    p_title: 'Règlement',
    p_url: 'https://organisation.example/reglement',
  });
  sourceId = String(data);

  // Étape 1, puis étape 2 : deux tours, l'un enfilant l'événement de l'autre.
  await tick(ports);
  await tick(ports);

  const { data: snapshot } = await client
    .from('source_snapshots')
    .select('id, snapshot_storage_path')
    .eq('source_id', sourceId)
    .maybeSingle();

  snapshotId = String(snapshot?.id);
  storagePath = String(snapshot?.snapshot_storage_path);
}, 90000);

afterAll(async () => {
  if (available) await client.from('organizations').delete().eq('id', ORG_ID);
}, 60000);

describe.runIf(process.env.SUPABASE_SERVICE_ROLE_KEY !== undefined)('parsing de sources', () => {
  it('enchaîne capture puis parsing par l’outbox', async () => {
    if (!available) return;

    // La capture a enfilé `source.parse` dans sa propre transaction (§22.2) :
    // aucun appelant n'a eu à demander le parsing.
    const { data: run } = await client
      .from('source_snapshots')
      .select('id')
      .eq('id', snapshotId)
      .maybeSingle();

    expect(run?.id).toBe(snapshotId);
  });

  it('ouvre un run portant les deux versions', async () => {
    if (!available) return;

    const { data: runs } = await (client as unknown as Rpc).rpc('worker_start_parse_run', {
      p_snapshot_id: snapshotId,
      p_parser_version: PARSER_VERSION,
      p_chunker_version: CHUNKER_VERSION,
      p_input_hash: null,
    });

    const row = (runs as Record<string, unknown>[])[0];

    // Le run du tour précédent est terminé : il est rendu tel quel.
    expect(row?.already_completed).toBe(true);
  });

  it('écrit des blocks nettoyés de la navigation et du pied de page', async () => {
    if (!available) return;

    const { data: blocks } = await (client as unknown as Rpc).rpc('worker_read_blocks', {
      p_snapshot_id: snapshotId,
    });

    const texts = (blocks as Record<string, unknown>[]).map((block) => String(block.content));

    expect(texts).toContain('Règlement 2026');
    expect(texts).toContain('Assistance autorisée uniquement à Lenk.');
    expect(texts).not.toContain('Accueil');
    expect(texts).not.toContain('Mentions légales');
  });

  it('conserve la provenance de chaque block', async () => {
    if (!available) return;

    // §18, §20 : c'est ce qui permettra à un fait publié de revenir à sa
    // position dans le document d'origine.
    const { data: blocks } = await (client as unknown as Rpc).rpc('worker_read_blocks', {
      p_snapshot_id: snapshotId,
    });

    const assistance = (blocks as Record<string, unknown>[]).find(
      (block) => String(block.content) === 'Assistance autorisée uniquement à Lenk.',
    );

    expect(assistance?.block_type).toBe('paragraph');
    expect(assistance?.section_path).toEqual(['Règlement 2026', 'Assistance']);
    expect(assistance?.heading).toBe('Assistance');
    expect(String(assistance?.content_hash)).toHaveLength(64);
  });

  it('relie chaque chunk à ses blocks', async () => {
    if (!available) return;

    // §19 : « conserver sa relation aux blocks ».
    const { data: links } = await (client as unknown as Rpc).rpc('worker_read_chunk_links', {
      p_snapshot_id: snapshotId,
    });

    expect((links as unknown[]).length).toBeGreaterThan(0);
  });

  it('ne reparse pas un snapshot inchangé', async () => {
    if (!available) return;

    // « Un re-parsing d'un snapshot inchangé doit produire le même résultat » :
    // ici, littéralement aucun second jeu de blocks.
    const before = await countBlocks();

    const outcome = await handleParseMessage(ports, parseMessage());

    expect(outcome.kind).toBe('already_done');
    expect(await countBlocks()).toBe(before);
  });

  it('trace un changement de version de parseur', async () => {
    if (!available) return;

    // Un nouveau couple de versions ouvre un nouveau run ; l'ancien reste
    // consultable, et le snapshot n'a pas bougé.
    const { data } = await (client as unknown as Rpc).rpc('worker_start_parse_run', {
      p_snapshot_id: snapshotId,
      p_parser_version: 'parser-9.9.9',
      p_chunker_version: CHUNKER_VERSION,
      p_input_hash: null,
    });

    const row = (data as Record<string, unknown>[])[0];
    expect(row?.already_completed).toBe(false);

    const { data: runs } = await (client as unknown as Rpc).rpc('worker_read_runs', {
      p_snapshot_id: snapshotId,
    });

    const versions = (runs as Record<string, unknown>[]).map((run) => String(run.parser_version));

    expect(versions).toContain(PARSER_VERSION);
    expect(versions).toContain('parser-9.9.9');
  });

  it('laisse le snapshot intact malgré les re-parsings', async () => {
    if (!available) return;

    // §9 : un snapshot est immuable. Les versions de traitement vivent dans la
    // couche privée, précisément pour cela.
    const { data: snapshot } = await client
      .from('source_snapshots')
      .select('version_number, content_hash')
      .eq('id', snapshotId)
      .maybeSingle();

    expect(snapshot?.version_number).toBe(1);
    expect(String(snapshot?.content_hash)).toHaveLength(64);
  });
});

async function countBlocks(): Promise<number> {
  const { data } = await (client as unknown as Rpc).rpc('worker_read_blocks', {
    p_snapshot_id: snapshotId,
  });

  return (data as unknown[]).length;
}
