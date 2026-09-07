import type {
  AIGroundedAnswerResult,
  AIProvider,
  AIStructuredExtractionRequest,
  AIStructuredExtractionResult,
} from '@pluka/contracts';
import { createServiceRoleClient } from '@pluka/db/server';
import { AI_PROMPT_VERSION, SOURCES_ENGINE_VERSION, type Capture } from '@pluka/sources';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handleExtractMessage } from '../src/jobs/source-extract.js';
import { tick } from '../src/loop.js';
import { createPorts } from '../src/ports-supabase.js';
import type { QueueMessage, WorkerPorts } from '../src/ports.js';

/** Base des liens dans les courriels de test — le worker la reçoit, il ne la devine pas. */
const TEST_APP_URL = 'http://localhost:3001';

/**
 * Étape 3 contre la base locale : extraction de candidats.
 *
 *   snapshot → blocks → candidats + preuves, sans rien publier
 *
 * Les tables privées sont réelles, les fonctions SQL aussi. Seules la capture
 * réseau et l'IA sont simulées : la première pour ne pas dépendre d'un serveur
 * tiers, la seconde pour pouvoir fabriquer une réponse précise et vérifier ce
 * qu'elle devient — ce qu'un vrai modèle ne permettrait pas de reproduire.
 *
 * Deux propriétés y sont vérifiées de bout en bout, et ce sont les règles non
 * négociables du lot : aucun candidat n'est publié, et une extraction ne
 * modifie pas une donnée existante.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const ORG_ID = 'ccccdddd-0000-4000-8000-000000000001';
const EVENT_ID = 'ccccdddd-0000-4000-8000-000000000002';
const EDITION_ID = 'ccccdddd-0000-4000-8000-000000000003';
const RACE_ID = 'ccccdddd-0000-4000-8000-000000000004';
const FACT_ID = 'ccccdddd-0000-4000-8000-000000000005';
const VERSION_ID = 'ccccdddd-0000-4000-8000-000000000006';

const REGLEMENT = `<html><body>
  <nav><a href="/">Accueil</a></nav>
  <main>
    <h1>Règlement 2026</h1>
    <h2>Départ</h2>
    <p>Le départ sera donné le 20 juin 2026 à 7h10 depuis Adelboden.</p>
    <h2>Parcours</h2>
    <p>Le parcours mesure 70 km pour 4'600 m D+.</p>
    <h2>Barrières horaires</h2>
    <table>
      <tr><th>Point</th><th>Barrière (arrivée)</th></tr>
      <tr><td>Iffigenalp</td><td>16h20</td></tr>
    </table>
    <h2>Assistance</h2>
    <p>L'assistance personnelle est autorisée uniquement à Lenk.</p>
  </main>
  <footer>Mentions légales</footer>
</body></html>`;

/** Extrait que le modèle simulé cite : il figure réellement dans le document. */
const ASSISTANCE_QUOTE = "L'assistance personnelle est autorisée uniquement à Lenk.";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;
type Rpc = {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};
type Row = Record<string, unknown>;

let client: ServiceClient;
let ports: WorkerPorts;
let snapshotId = '';
let parseRunId = '';
let publisherId = '';
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

/**
 * Modèle simulé.
 *
 * Il cite un chunk qu'on lui a réellement soumis et recopie un extrait présent
 * dans le document : c'est la réponse d'un modèle qui se tient correctement.
 * Les réponses fautives sont exercées dans les tests unitaires du paquet pur.
 */
const fakeAI: AIProvider = {
  name: 'fournisseur-simule',

  extractStructured<T>(
    request: AIStructuredExtractionRequest<T>,
  ): Promise<AIStructuredExtractionResult<T>> {
    const cited = /\[(chunk-\d+)\]\n(?:(?!\n\n)[\s\S])*assistance personnelle/.exec(request.input);

    return Promise.resolve({
      data: {
        candidates: [
          {
            factType: 'assistance',
            subjectKey: 'Lenk',
            context: 'authorization',
            valueText: 'autorisée uniquement à Lenk',
            valueNumber: null,
            unit: null,
            validFrom: null,
            validTo: null,
            confidence: 'high',
            notes: null,
            evidenceIds: [cited?.[1] ?? 'chunk-0'],
            quote: ASSISTANCE_QUOTE,
          },
        ],
      } as T,
      model: { provider: 'simule', model: 'modele-test', promptVersion: AI_PROMPT_VERSION },
      usage: { inputTokens: 900, outputTokens: 120 },
    });
  },

  answerFromEvidence(): Promise<AIGroundedAnswerResult> {
    throw new Error("hors périmètre de l'extraction");
  },
};

function extractMessage(): QueueMessage {
  return {
    msgId: 1,
    readCount: 1,
    payload: {
      snapshotId,
      parseRunId,
      idempotencyKey: `source.extract:${parseRunId}`,
    },
  };
}

async function candidates(): Promise<Row[]> {
  const { data } = await (client as unknown as Rpc).rpc('worker_read_candidates', {
    p_snapshot_id: snapshotId,
  });

  return (data ?? []) as Row[];
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

  const base = createPorts(
    client,
    { appUrl: TEST_APP_URL },
    { provider: fakeAI, model: 'modele-test' },
  );
  ports = { ...base, sources: { ...base.sources, fetch: capture } };

  await client.from('organizations').delete().eq('id', ORG_ID);
  await client
    .from('organizations')
    .insert({ id: ORG_ID, name: 'Org Extract', slug: 'org-extract' });
  await client.from('events').insert({
    id: EVENT_ID,
    organization_id: ORG_ID,
    name: 'Trail Extract',
    slug: 'trail-extract',
    status: 'published',
  });
  await client.from('editions').insert({
    id: EDITION_ID,
    event_id: EVENT_ID,
    year: 2026,
    slug: 'trail-extract-2026',
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

  // Un fact déjà publié, que le document contredit : le règlement annonce
  // 07:10, la base porte 06:00. §35 — l'extraction ne doit pas y toucher.
  //
  // La version publiée nomme un auteur qui a autorité sur la course : depuis
  // 0012, la base refuse une publication anonyme. La fixture ne contourne
  // rien, elle décrit un monde que la base accepte.
  const publisher = await (
    client as unknown as {
      auth: {
        admin: {
          createUser(input: {
            email: string;
            password: string;
            email_confirm: boolean;
          }): Promise<{ data: { user: { id: string } | null } }>;
        };
      };
    }
  ).auth.admin.createUser({
    email: `publisher-${Date.now().toString(36)}@extract.test`,
    password: 'pluka-test-2026!',
    email_confirm: true,
  });

  publisherId = publisher.data.user?.id ?? '';

  await client
    .from('organization_members')
    .insert({ organization_id: ORG_ID, user_id: publisherId, role: 'editor' });

  await client
    .from('race_facts')
    .insert({ id: FACT_ID, race_id: RACE_ID, category: 'start', fact_key: 'start/start_time' });
  await client.from('race_fact_versions').insert({
    id: VERSION_ID,
    fact_id: FACT_ID,
    version_number: 1,
    value_text: '06:00',
    workflow_status: 'published',
    published_at: new Date().toISOString(),
    published_by_user_id: publisherId,
  });
  await client.from('race_facts').update({ current_version_id: VERSION_ID }).eq('id', FACT_ID);

  const { data: enqueued } = await (client as unknown as Rpc).rpc('enqueue_source_ingest', {
    p_edition_id: EDITION_ID,
    p_source_type: 'url',
    p_title: 'Règlement',
    p_url: 'https://organisation.example/reglement-extract',
  });

  // Capture, parsing, extraction : trois tours, chacun enfilant le suivant.
  await tick(ports);
  await tick(ports);
  await tick(ports);

  // Le snapshot de *cette* source : les suites de bout en bout partagent une
  // base, et prendre « le dernier capturé » attraperait celui d'une autre.
  const { data: snapshot } = await client
    .from('source_snapshots')
    .select('id')
    .eq('source_id', String(enqueued))
    .maybeSingle();

  snapshotId = String(snapshot?.id);

  const { data: runs } = await (client as unknown as Rpc).rpc('worker_read_runs', {
    p_snapshot_id: snapshotId,
  });

  parseRunId = String((runs as Row[])[0]?.run_id);
}, 120000);

afterAll(async () => {
  if (available) await client.from('organizations').delete().eq('id', ORG_ID);
}, 60000);

describe.runIf(process.env.SUPABASE_SERVICE_ROLE_KEY !== undefined)(
  'extraction de candidats',
  () => {
    it('enchaîne parsing puis extraction par l’outbox', async () => {
      if (!available) return;

      // §22.2 : le parsing a enfilé `source.extract` dans sa propre transaction.
      const { data: runs } = await (client as unknown as Rpc).rpc('worker_read_extraction_runs', {
        p_snapshot_id: snapshotId,
      });

      expect((runs as Row[]).length).toBe(1);
      expect((runs as Row[])[0]?.status).toBe('completed');
      expect((runs as Row[])[0]?.parent_run_id).toBe(parseRunId);
    });

    it('trace ce qui a produit les candidats', async () => {
      if (!available) return;

      // §26 : moteur, schéma, prompt, fournisseur, modèle — et le run de parsing.
      const { data: runs } = await (client as unknown as Rpc).rpc('worker_read_extraction_runs', {
        p_snapshot_id: snapshotId,
      });

      expect((runs as Row[])[0]).toMatchObject({
        engine_version: SOURCES_ENGINE_VERSION,
        prompt_version: AI_PROMPT_VERSION,
        provider: 'fournisseur-simule',
        model: 'modele-test',
        parent_run_id: parseRunId,
      });
    });

    it('écrit les candidats lus par un parseur déterministe', async () => {
      if (!available) return;

      const rows = await candidates();
      const keys = rows.map((row) => String(row.fact_key));

      expect(keys).toContain('cutoff/iffigenalp/arrival');
      expect(keys).toContain('start/start_time');
      expect(keys).toContain('course/elevation_gain');

      const cutoff = rows.find((row) => row.fact_key === 'cutoff/iffigenalp/arrival');

      expect(cutoff?.value_text).toBe('16:20');
      expect(cutoff?.origin).toBe('deterministic');
      expect(cutoff?.race_id).toBe(RACE_ID);
    });

    it('écrit aussi ce que le modèle a proposé', async () => {
      if (!available) return;

      const assistance = (await candidates()).find((row) => row.category === 'assistance');

      expect(assistance?.origin).toBe('ai');
      // §28 : une confiance élevée ne dispense pas de la validation humaine.
      expect(assistance?.confidence_label).toBe('high');
      expect(assistance?.status).toBe('needs_review');
    });

    it('conserve la provenance de chaque candidat jusquau document', async () => {
      if (!available) return;

      // §20 : « snapshot_id, block_id ou chunk_id, page_number, section_path,
      // quote / excerpt court ».
      const cutoff = (await candidates()).find(
        (row) => row.fact_key === 'cutoff/iffigenalp/arrival',
      );

      const { data: evidence } = await (client as unknown as Rpc).rpc(
        'worker_read_candidate_evidence',
        { p_candidate_id: cutoff?.candidate_id },
      );

      const primary = (evidence as Row[]).find((row) => row.is_primary === true);

      expect(primary?.section_path).toEqual(['Règlement 2026', 'Barrières horaires']);
      expect(primary?.excerpt).toBe('16h20');
      expect(primary?.block_content).toBe('16h20');
      expect((primary?.locator as Row).tableIndex).toBe(0);
      expect((primary?.locator as Row).rowIndex).toBe(1);
      expect(primary?.chunk_index).not.toBeNull();
    });

    it('remonte un extrait IA jusquau block qui le porte', async () => {
      if (!available) return;

      // Le modèle cite un chunk ; la preuve, elle, descend au block. C'est ce qui
      // permet une citation précise sans que le modèle ait jamais vu de locator.
      const assistance = (await candidates()).find((row) => row.category === 'assistance');

      const { data: evidence } = await (client as unknown as Rpc).rpc(
        'worker_read_candidate_evidence',
        { p_candidate_id: assistance?.candidate_id },
      );

      const primary = (evidence as Row[]).find((row) => row.is_primary === true);

      expect(primary?.excerpt).toBe(ASSISTANCE_QUOTE);
      expect(String(primary?.block_content)).toContain('Lenk');
      expect(primary?.section_path).toEqual(['Règlement 2026', 'Assistance']);
    });

    // ============================================================
    // Les deux règles non négociables
    // ============================================================

    it('ne publie aucun candidat', async () => {
      if (!available) return;

      // §25 : « le système ne doit jamais afficher directement un candidat comme
      // fact publié ». Aucune version de fact n'est apparue.
      const { data: versions } = await client
        .from('race_fact_versions')
        .select('id, fact_id')
        .eq('fact_id', FACT_ID);

      expect((versions ?? []).length).toBe(1);

      const { count } = await client
        .from('race_facts')
        .select('id', { count: 'exact', head: true })
        .eq('race_id', RACE_ID);

      // Le seul fact de cette course est celui semé avant l'extraction.
      expect(count).toBe(1);

      const statuses = new Set((await candidates()).map((row) => String(row.status)));

      expect(
        [...statuses].every((status) => ['detected', 'needs_review', 'conflict'].includes(status)),
      ).toBe(true);
    });

    it('ne modifie pas la valeur publiée quun candidat contredit', async () => {
      if (!available) return;

      // §35 : « ne jamais écraser ». Le document annonce 07:10, la base porte
      // 06:00, et elle porte toujours 06:00.
      const { data: version } = await client
        .from('race_fact_versions')
        .select('value_text, workflow_status')
        .eq('id', VERSION_ID)
        .maybeSingle();

      expect(version?.value_text).toBe('06:00');
      expect(version?.workflow_status).toBe('published');

      const { data: fact } = await client
        .from('race_facts')
        .select('current_version_id')
        .eq('id', FACT_ID)
        .maybeSingle();

      expect(fact?.current_version_id).toBe(VERSION_ID);
    });

    it('signale la contradiction au lieu de la résoudre', async () => {
      if (!available) return;

      // §36 : comparer, identifier, et laisser trancher un humain (§30).
      const start = (await candidates()).find((row) => row.fact_key === 'start/start_time');

      expect(start?.value_text).toBe('07:10');
      expect(start?.status).toBe('conflict');
      expect(start?.matched_fact_id).toBe(FACT_ID);
    });

    // ============================================================
    // Idempotence et ré-extraction
    // ============================================================

    it('ne réextrait pas un run de parsing inchangé', async () => {
      if (!available) return;

      const before = (await candidates()).length;
      const outcome = await handleExtractMessage(ports, extractMessage());

      expect(outcome.kind).toBe('already_done');
      expect((await candidates()).length).toBe(before);
    });

    it('trace un changement de version de prompt', async () => {
      if (!available) return;

      // §77 : « une nouvelle version moteur peut justifier une ré-extraction ».
      // Elle ouvre un nouveau run, et « ne modifie jamais directement les
      // RaceFactVersions publiées ».
      const { data } = await (client as unknown as Rpc).rpc('worker_start_extraction_run', {
        p_parse_run_id: parseRunId,
        p_snapshot_id: snapshotId,
        p_engine_version: SOURCES_ENGINE_VERSION,
        p_schema_version: 'extractor-1.0.0',
        p_prompt_version: 'extract-facts-9.9.9',
        p_provider: 'fournisseur-simule',
        p_model: 'modele-test',
        p_input_hash: null,
      });

      expect((data as Row[])[0]?.already_completed).toBe(false);

      const { data: runs } = await (client as unknown as Rpc).rpc('worker_read_extraction_runs', {
        p_snapshot_id: snapshotId,
      });

      const versions = (runs as Row[]).map((row) => String(row.prompt_version));

      expect(versions).toContain(AI_PROMPT_VERSION);
      expect(versions).toContain('extract-facts-9.9.9');

      // Et la valeur publiée n'a toujours pas bougé.
      const { data: version } = await client
        .from('race_fact_versions')
        .select('value_text')
        .eq('id', VERSION_ID)
        .maybeSingle();

      expect(version?.value_text).toBe('06:00');
    });

    it('laisse le snapshot intact', async () => {
      if (!available) return;

      // §9 : un snapshot est immuable. Toutes les versions de traitement vivent
      // dans la couche privée, précisément pour cela.
      const { data: snapshot } = await client
        .from('source_snapshots')
        .select('version_number')
        .eq('id', snapshotId)
        .maybeSingle();

      expect(snapshot?.version_number).toBe(1);
    });
  },
);
