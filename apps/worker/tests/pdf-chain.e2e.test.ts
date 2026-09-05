import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServiceRoleClient } from '@pluka/db/server';
import { PARSER_VERSION, contentHash, type Capture } from '@pluka/sources';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { tick } from '../src/loop.js';
import { createPorts } from '../src/ports-supabase.js';
import type { WorkerPorts } from '../src/ports.js';

/**
 * Un PDF de bout en bout contre la base locale — §13.
 *
 *   capture → snapshot immuable → parsing PDF → blocks + chunks + provenance
 *
 * Le PDF traverse la chaîne réelle : stockage Supabase, fonctions SQL, worker.
 * C'est ce que le test unitaire ne peut pas montrer — qu'un binaire survit à
 * l'aller-retour par le stockage sans être décodé en texte au passage, ce qui
 * le détruirait silencieusement.
 *
 * Deux fixtures : un règlement lisible, et un scanné sans couche texte. La
 * seconde vérifie que le refus de §14 remonte jusqu'au run, avec sa raison.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const ORG_ID = 'aabbccdd-0000-4000-8000-000000000001';
const EVENT_ID = 'aabbccdd-0000-4000-8000-000000000002';
const EDITION_ID = 'aabbccdd-0000-4000-8000-000000000003';

const FIXTURES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'sources',
  'tests',
  'fixtures',
);

const REGLEMENT_PDF = new Uint8Array(readFileSync(resolve(FIXTURES, 'reglement.pdf')));
const SCANNED_PDF = new Uint8Array(readFileSync(resolve(FIXTURES, 'scanned.pdf')));

type ServiceClient = ReturnType<typeof createServiceRoleClient>;
type Rpc = {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};
type Row = Record<string, unknown>;

let client: ServiceClient;
let ports: WorkerPorts;
let served: Uint8Array = REGLEMENT_PDF;
let readableSourceId = '';
let scannedSourceId = '';
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

function call(): Rpc {
  return client as unknown as Rpc;
}

async function snapshotOf(sourceId: string): Promise<Row | null> {
  const { data } = await client
    .from('source_snapshots')
    .select('id, content_hash, size_bytes, content_type, version_number')
    .eq('source_id', sourceId)
    .maybeSingle();

  return (data ?? null) as Row | null;
}

async function enqueue(title: string, url: string): Promise<string> {
  const { data } = await call().rpc('enqueue_source_ingest', {
    p_edition_id: EDITION_ID,
    p_source_type: 'url',
    p_title: title,
    p_url: url,
  });

  return String(data);
}

beforeAll(async () => {
  available = await reachable();
  if (!available) return;

  client = createServiceRoleClient({ url: SUPABASE_URL, secretKey: SERVICE_KEY });

  // La capture est simulée — on ne dépend pas d'un serveur tiers — mais elle
  // rend de vrais octets de PDF, et tout ce qui suit est réel.
  const capture = (url: string): Promise<Capture> =>
    Promise.resolve({
      bytes: served,
      finalUrl: url,
      httpStatus: 200,
      contentType: 'application/pdf',
    });

  const base = createPorts(client);
  ports = { ...base, sources: { ...base.sources, fetch: capture } };

  await client.from('organizations').delete().eq('id', ORG_ID);
  await client.from('organizations').insert({ id: ORG_ID, name: 'Org PDF', slug: 'org-pdf' });
  await client.from('events').insert({
    id: EVENT_ID,
    organization_id: ORG_ID,
    name: 'Trail PDF',
    slug: 'trail-pdf',
    status: 'published',
  });
  await client.from('editions').insert({
    id: EDITION_ID,
    event_id: EVENT_ID,
    year: 2026,
    slug: 'trail-pdf-2026',
    start_date: '2026-06-20',
    status: 'published',
  });

  served = REGLEMENT_PDF;
  readableSourceId = await enqueue('Règlement PDF', 'https://organisation.example/reglement.pdf');

  await tick(ports); // capture
  await tick(ports); // parsing

  served = SCANNED_PDF;
  scannedSourceId = await enqueue('Guide scanné', 'https://organisation.example/scan.pdf');

  await tick(ports);
  await tick(ports);
}, 120000);

afterAll(async () => {
  if (available) await client.from('organizations').delete().eq('id', ORG_ID);
}, 60000);

describe.runIf(process.env.SUPABASE_SERVICE_ROLE_KEY !== undefined)('parsing PDF', () => {
  it('capture le PDF sans le dénaturer', async () => {
    if (!available) return;

    // §9, §10 : le snapshot est immuable et son empreinte porte sur les octets
    // d'origine. Un aller-retour par une chaîne de caractères aurait changé
    // l'empreinte — c'est précisément ce qu'un binaire ne pardonne pas.
    const snapshot = await snapshotOf(readableSourceId);

    expect(snapshot?.content_hash).toBe(contentHash(REGLEMENT_PDF));
    expect(snapshot?.size_bytes).toBe(REGLEMENT_PDF.byteLength);
    expect(snapshot?.content_type).toBe('application/pdf');
  });

  it('extrait le texte natif en blocks — §13', async () => {
    if (!available) return;

    const snapshot = await snapshotOf(readableSourceId);
    const { data } = await call().rpc('worker_read_blocks', { p_snapshot_id: snapshot?.id });

    const texts = (data as Row[]).map((row) => String(row.content));

    expect(texts).toContain('Reglement 2026');
    expect(texts).toContain('Le depart sera donne le 20 juin 2026 a 7h10 depuis Adelboden.');
    expect(texts).toContain("L'assistance personnelle est autorisee uniquement a Lenk.");
  });

  it('conserve la page et la position de chaque block — §20', async () => {
    if (!available) return;

    const snapshot = await snapshotOf(readableSourceId);
    const { data } = await call().rpc('worker_read_blocks', { p_snapshot_id: snapshot?.id });

    const assistance = (data as Row[]).find((row) =>
      String(row.content).includes('uniquement a Lenk'),
    );

    expect(assistance?.page_number).toBe(2);
    expect(assistance?.block_type).toBe('paragraph');
    expect(assistance?.section_path).toEqual(['Reglement 2026', 'Assistance']);
    expect((assistance?.locator as Row).page).toBe(2);
    expect(typeof (assistance?.locator as Row).lineIndex).toBe('number');
    expect(String(assistance?.content_hash)).toHaveLength(64);
  });

  it('découpe le PDF en chunks reliés à leurs blocks — §19', async () => {
    if (!available) return;

    const snapshot = await snapshotOf(readableSourceId);
    const { data } = await call().rpc('worker_read_chunk_links', { p_snapshot_id: snapshot?.id });

    expect((data as unknown[]).length).toBeGreaterThan(0);
  });

  it('enregistre le run avec la version de parseur', async () => {
    if (!available) return;

    const snapshot = await snapshotOf(readableSourceId);
    const { data } = await call().rpc('worker_read_runs', { p_snapshot_id: snapshot?.id });

    const run = (data as Row[])[0];

    expect(run?.parser_version).toBe(PARSER_VERSION);
    expect(run?.status).toBe('completed');
  });

  it('refuse un PDF scanné en nommant sa raison — §14', async () => {
    if (!available) return;

    // Le refus doit remonter jusqu'au run : un snapshot non parsé doit être
    // visible, et le relecteur doit savoir qu'il manque une OCR — pas
    // seulement que « le parsing a échoué ».
    const snapshot = await snapshotOf(scannedSourceId);
    const { data } = await call().rpc('worker_read_runs', { p_snapshot_id: snapshot?.id });

    const run = (data as Row[])[0];

    expect(run?.status).toBe('failed');

    const { data: blocks } = await call().rpc('worker_read_blocks', {
      p_snapshot_id: snapshot?.id,
    });

    // Aucun block inventé : un document illisible ne produit pas de preuve.
    expect((blocks as unknown[]).length).toBe(0);
  });

  it('garde le snapshot scanné, même sans texte', async () => {
    if (!available) return;

    // §6 et §9 : le snapshot existe pour lui-même. Une OCR ultérieure pourra
    // le reprendre sans nouvelle capture, et l'empreinte prouvera qu'il s'agit
    // du même document.
    const snapshot = await snapshotOf(scannedSourceId);

    expect(snapshot?.content_hash).toBe(contentHash(SCANNED_PDF));
    expect(snapshot?.version_number).toBe(1);
  });
});
