import { createServerClient, createServiceRoleClient } from '@pluka/db/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handleImpactMessage } from '../src/jobs/change-impact.js';
import { tick } from '../src/loop.js';
import { createPorts } from '../src/ports-supabase.js';
import type { QueueMessage, WorkerPorts } from '../src/ports.js';

/** Base des liens dans les courriels de test — le worker la reçoit, il ne la devine pas. */
const TEST_APP_URL = 'http://localhost:3001';

/**
 * Impact Analyzer de bout en bout contre la base locale — §44.
 *
 *   publication d'un fact → outbox → pgmq → worker → participant_change_impacts
 *
 * La chaîne entière est réelle : un éditeur publie sous sa propre session,
 * l'événement métier part dans la transaction de publication (§22.2), le
 * dispatcher le traduit en message, le worker consomme, l'analyse s'exécute en
 * base.
 *
 * Ce que le test SQL ne peut pas montrer est précisément ce maillon : jusqu'au
 * lot précédent, `race.fact.published` ne correspondait à aucune file et
 * finissait `failed`. L'événement métier partait sans atteindre personne.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

const SUFFIX = Date.now().toString(36);
const PASSWORD = 'pluka-test-2026!';
const EXCERPT = 'Veste impermeable obligatoire pour toutes les epreuves.';

const ORG_ID = 'bbbbcccc-0000-4000-8000-000000000001';
const EVENT_ID = 'bbbbcccc-0000-4000-8000-000000000002';
const EDITION_ID = 'bbbbcccc-0000-4000-8000-000000000003';
const RACE_ID = 'bbbbcccc-0000-4000-8000-000000000004';
const FACT_ID = 'bbbbcccc-0000-4000-8000-000000000005';
const VERSION_ONE = 'bbbbcccc-0000-4000-8000-000000000006';
const VERSION_TWO = 'bbbbcccc-0000-4000-8000-000000000007';
const CHANGE_ID = 'bbbbcccc-0000-4000-8000-000000000008';

const WITH_PLAN = 'bbbbcccc-0000-4000-8000-000000000010';
const WITHOUT_PLAN = 'bbbbcccc-0000-4000-8000-000000000011';
const PLAN_ID = 'bbbbcccc-0000-4000-8000-000000000012';
const SOURCE_ID = 'bbbbcccc-0000-4000-8000-000000000030';
const SNAPSHOT_ID = 'bbbbcccc-0000-4000-8000-000000000031';

type ServiceClient = ReturnType<typeof createServiceRoleClient>;
type Rpc = {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};
type Row = Record<string, unknown>;

let client: ServiceClient;
let publisherClient: ServiceClient;
let ports: WorkerPorts;
let publisherId = '';
let publisherEmail = '';
let available = false;

async function reachable(): Promise<boolean> {
  if (SERVICE_KEY === '' || ANON_KEY === '') return false;

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

function call(target: ServiceClient = client): Rpc {
  return target as unknown as Rpc;
}

async function createUser(email: string): Promise<string> {
  const admin = client as unknown as {
    auth: {
      admin: {
        createUser(input: {
          email: string;
          password: string;
          email_confirm: boolean;
        }): Promise<{ data: { user: { id: string } | null } }>;
      };
    };
  };

  const created = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });

  return created.data.user?.id ?? '';
}

async function impactsOf(changeEventId: string): Promise<Row[]> {
  const { data } = await call().rpc('worker_read_change_impacts', {
    p_change_event_id: changeEventId,
  });

  return (data ?? []) as Row[];
}

function impactMessage(): QueueMessage {
  return {
    msgId: 1,
    readCount: 1,
    payload: {
      raceId: RACE_ID,
      factId: FACT_ID,
      changeEventId: CHANGE_ID,
      idempotencyKey: `race.fact.published:${VERSION_TWO}`,
    },
  };
}

beforeAll(async () => {
  available = await reachable();
  if (!available) return;

  client = createServiceRoleClient({ url: SUPABASE_URL, secretKey: SERVICE_KEY });
  ports = createPorts(client, { appUrl: TEST_APP_URL });

  await client.from('organizations').delete().eq('id', ORG_ID);

  publisherEmail = `publisher-${SUFFIX}@impact.test`;
  publisherId = await createUser(publisherEmail);

  const runnerWithPlan = await createUser(`runner-plan-${SUFFIX}@impact.test`);
  const runnerWithoutPlan = await createUser(`runner-noplan-${SUFFIX}@impact.test`);

  await client
    .from('organizations')
    .insert({ id: ORG_ID, name: 'Org Impact', slug: `org-impact-${SUFFIX}` });
  await client
    .from('organization_members')
    .insert({ organization_id: ORG_ID, user_id: publisherId, role: 'editor' });

  await client.from('events').insert({
    id: EVENT_ID,
    organization_id: ORG_ID,
    name: 'Trail Impact',
    slug: `trail-impact-${SUFFIX}`,
    status: 'published',
  });
  await client.from('editions').insert({
    id: EDITION_ID,
    event_id: EVENT_ID,
    year: 2026,
    slug: `trail-impact-2026-${SUFFIX}`,
    start_date: '2026-06-20',
    status: 'published',
  });
  await client.from('races').insert({
    id: RACE_ID,
    edition_id: EDITION_ID,
    name: 'Grand Parcours',
    slug: 'grand-parcours',
    distance_km: 70,
    start_datetime: '2026-06-20T05:10:00Z',
    status: 'published',
  });

  // Deux coureurs : l'un a un Plan actif qui dépend de la barrière, l'autre
  // court sans Plan. L'analyse doit les distinguer.
  await client.from('participant_races').insert([
    { id: WITH_PLAN, race_id: RACE_ID, user_id: runnerWithPlan, status: 'active' },
    { id: WITHOUT_PLAN, race_id: RACE_ID, user_id: runnerWithoutPlan, status: 'active' },
  ]);

  await client.from('race_plans').insert({
    id: PLAN_ID,
    participant_race_id: WITH_PLAN,
    version: 1,
    engine_version: 'plan-1.0.0',
    initial_target_duration_seconds: 43200,
    target_duration_seconds: 43200,
  });

  // Une barrière publiée, puis remplacée : c'est ce changement qui descend.
  await client
    .from('race_facts')
    .insert({ id: FACT_ID, race_id: RACE_ID, category: 'cutoff', fact_key: 'cutoff/lenk/arrival' });

  await client.from('race_fact_versions').insert([
    {
      id: VERSION_ONE,
      fact_id: FACT_ID,
      version_number: 1,
      value_text: '16:20',
      workflow_status: 'superseded',
      published_at: new Date().toISOString(),
      published_by_user_id: publisherId,
    },
    {
      id: VERSION_TWO,
      fact_id: FACT_ID,
      version_number: 2,
      value_text: '16:35',
      workflow_status: 'published',
      published_at: new Date().toISOString(),
      published_by_user_id: publisherId,
    },
  ]);

  await client.from('race_facts').update({ current_version_id: VERSION_TWO }).eq('id', FACT_ID);

  // §45 : le Plan déclare la version exacte dont il dépend.
  await client.from('plan_version_dependencies').insert({
    race_plan_id: PLAN_ID,
    race_fact_version_id: VERSION_ONE,
    dependency_type: 'cutoff',
    dependency_key: 'lenk',
  });

  await client.from('race_change_events').insert({
    id: CHANGE_ID,
    race_id: RACE_ID,
    fact_id: FACT_ID,
    from_version_id: VERSION_ONE,
    to_version_id: VERSION_TWO,
    severity: 'critical',
    title: 'cutoff/lenk/arrival',
    published_by_user_id: publisherId,
  });

  // La session de l'éditeur : publier est un acte humain, et la fonction SQL
  // refuse tout appel sans `auth.uid()` (0012).
  const anonymous = createServerClient({ url: SUPABASE_URL, publishableKey: ANON_KEY });
  const session = await anonymous.auth.signInWithPassword({
    email: publisherEmail,
    password: PASSWORD,
  });

  publisherClient = createServerClient({
    url: SUPABASE_URL,
    publishableKey: ANON_KEY,
    accessToken: session.data.session?.access_token ?? '',
  });
}, 180000);

afterAll(async () => {
  if (available) await client.from('organizations').delete().eq('id', ORG_ID);
}, 60000);

describe.runIf(process.env.SUPABASE_SERVICE_ROLE_KEY !== undefined)(
  'analyse d’un changement',
  () => {
    it('analyse sur réception du message', async () => {
      if (!available) return;

      const outcome = await handleImpactMessage(ports, impactMessage());

      expect(outcome).toEqual({ kind: 'analyzed', impactCount: 1 });
    });

    it('ne concerne que le Plan qui dépendait de la version remplacée — §45', async () => {
      if (!available) return;

      const rows = await impactsOf(CHANGE_ID);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        participant_race_id: WITH_PLAN,
        impacted_module: 'plan',
        status: 'pending',
      });
    });

    it('laisse tranquille le coureur sans Plan', async () => {
      if (!available) return;

      const rows = await impactsOf(CHANGE_ID);

      expect(rows.some((row) => row.participant_race_id === WITHOUT_PLAN)).toBe(false);
    });

    it('ne recrée rien quand le message revient — §22.1', async () => {
      if (!available) return;

      const before = (await impactsOf(CHANGE_ID)).length;
      const outcome = await handleImpactMessage(ports, impactMessage());

      expect(outcome).toEqual({ kind: 'analyzed', impactCount: 0 });
      expect((await impactsOf(CHANGE_ID)).length).toBe(before);
    });

    it('ne touche à aucun objet downstream — §46', async () => {
      if (!available) return;

      // « Le Plan existant est marqué potentiellement impacté ; le coureur est
      // informé ; le recalcul se fait selon le workflow produit. »
      const { data: plan } = await client
        .from('race_plans')
        .select('target_duration_seconds, status')
        .eq('id', PLAN_ID)
        .maybeSingle();

      expect(plan).toMatchObject({ target_duration_seconds: 43200, status: 'active' });
    });

    it('abandonne un message sans identifiant d’événement', async () => {
      if (!available) return;

      const outcome = await handleImpactMessage(ports, {
        msgId: 2,
        readCount: 1,
        payload: { idempotencyKey: 'race.fact.published:inconnu' },
      });

      expect(outcome).toEqual({ kind: 'abandoned', code: 'PAYLOAD_INVALID' });
    });

    it('réessaie sur un événement introuvable plutôt que d’abandonner', async () => {
      if (!available) return;

      // Un événement absent au moment du message peut être une transaction non
      // encore visible : la classification par défaut est transitoire.
      const outcome = await handleImpactMessage(ports, {
        msgId: 3,
        readCount: 1,
        payload: {
          changeEventId: 'bbbbcccc-0000-4000-8000-0000000000ff',
          idempotencyKey: 'race.fact.published:absent',
        },
      });

      expect(outcome.kind).toBe('retry');
    });
  },
);

// ============================================================
// La chaîne complète : publication → outbox → pgmq → worker
// ============================================================

describe.runIf(process.env.SUPABASE_SERVICE_ROLE_KEY !== undefined)('chaîne complète', () => {
  it('achemine une publication réelle jusqu’à l’analyse', async () => {
    if (!available) return;

    // Rien n'est simulé : un éditeur publie un candidat par la fonction de
    // 0012, qui écrit l'événement métier dans l'outbox (§22.2). Un tour de
    // boucle suffit ensuite — dispatcher, file, worker, analyse.
    const candidateId = await seedEquipmentCandidate();

    const { error } = await call(publisherClient).rpc('publish_fact_candidate', {
      p_candidate_id: candidateId,
      p_actor_user_id: publisherId,
      p_trust_level: 'official',
    });

    expect(error).toBeNull();

    const result = await tick(ports);

    expect(result.dispatched).toBeGreaterThanOrEqual(1);
    expect(result.processed).toBeGreaterThanOrEqual(1);

    const { data: change } = await client
      .from('race_change_events')
      .select('id')
      .eq('race_id', RACE_ID)
      .eq('title', 'equipment/veste')
      .maybeSingle();

    // Une exigence de matériel concerne toute préparation active : les deux
    // coureurs, celui qui a un Plan comme celui qui n'en a pas.
    const rows = await impactsOf(String(change?.id));

    expect(rows.map((row) => row.impacted_module)).toEqual(['preparation', 'preparation']);
    expect(new Set(rows.map((row) => row.participant_race_id))).toEqual(
      new Set([WITH_PLAN, WITHOUT_PLAN]),
    );
  });

  it('ne modifie toujours aucun objet downstream — §46', async () => {
    if (!available) return;

    const { data: plan } = await client
      .from('race_plans')
      .select('target_duration_seconds, status')
      .eq('id', PLAN_ID)
      .maybeSingle();

    expect(plan).toMatchObject({ target_duration_seconds: 43200, status: 'active' });
  });
});

/**
 * Un candidat de matériel, produit par les fonctions réelles des étapes 2 et 3.
 *
 * Semé par la chaîne plutôt qu'à la main : un état que l'ingestion ne
 * produirait pas ne prouverait rien de la publication qui le consomme.
 */
async function seedEquipmentCandidate(): Promise<string> {
  await client.from('sources').insert({
    id: SOURCE_ID,
    edition_id: EDITION_ID,
    organization_id: ORG_ID,
    source_type: 'url',
    title: 'Règlement 2026',
    url: 'https://organisation.example/reglement',
  });
  await client.from('source_snapshots').insert({
    id: SNAPSHOT_ID,
    source_id: SOURCE_ID,
    version_number: 1,
    content_hash: 'e'.repeat(64),
  });

  const parse = await call().rpc('worker_start_parse_run', {
    p_snapshot_id: SNAPSHOT_ID,
    p_parser_version: 'parser-1.1.0',
    p_chunker_version: 'chunker-1.0.0',
    p_input_hash: null,
  });

  const parseRunId = String((parse.data as Row[])[0]?.run_id);

  await call().rpc('worker_complete_parse_run', {
    p_run_id: parseRunId,
    p_snapshot_id: SNAPSHOT_ID,
    p_blocks: [
      {
        blockIndex: 0,
        pageNumber: null,
        sectionPath: ['Reglement', 'Materiel'],
        heading: 'Materiel',
        blockType: 'paragraph',
        text: EXCERPT,
        locator: { cssSelector: 'p' },
      },
    ],
    p_chunks: [
      {
        chunkIndex: 0,
        text: EXCERPT,
        contentHash: 'f'.repeat(64),
        blockIndexes: [0],
        pageStart: null,
        pageEnd: null,
        sectionLabel: 'Materiel',
      },
    ],
    p_chunker_version: 'chunker-1.0.0',
  });

  const extraction = await call().rpc('worker_start_extraction_run', {
    p_parse_run_id: parseRunId,
    p_snapshot_id: SNAPSHOT_ID,
    p_engine_version: 'sources-v1.0.0',
    p_schema_version: 'extractor-1.0.0',
    p_prompt_version: 'extract-facts-1.0.0',
    p_provider: null,
    p_model: null,
    p_input_hash: null,
  });

  await call().rpc('worker_record_fact_candidates', {
    p_run_id: String((extraction.data as Row[])[0]?.run_id),
    p_parse_run_id: parseRunId,
    p_snapshot_id: SNAPSHOT_ID,
    p_candidates: [
      {
        factType: 'equipment',
        subjectKey: 'equipment/veste',
        context: null,
        factKey: 'equipment/veste',
        valueText: 'Veste impermeable obligatoire',
        valueNumber: null,
        unit: null,
        valueJson: null,
        validFrom: null,
        validTo: null,
        confidence: 'high',
        notes: null,
        origin: 'deterministic',
        reviewState: 'detected',
        evidence: [
          {
            blockIndex: 0,
            chunkIndex: 0,
            pageNumber: null,
            sectionPath: ['Reglement', 'Materiel'],
            locator: { cssSelector: 'p' },
            excerpt: EXCERPT,
            isPrimary: true,
          },
        ],
      },
    ],
  });

  const { data } = await call().rpc('worker_read_candidates', { p_snapshot_id: SNAPSHOT_ID });

  return String((data as Row[])[0]?.candidate_id);
}
