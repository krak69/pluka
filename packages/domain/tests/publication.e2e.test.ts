import { createFactRepositories } from '@pluka/db';
import { createServerClient, createServiceRoleClient } from '@pluka/db/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DomainError,
  decideFactCandidate,
  publishFactCandidate,
  type FactReviewContext,
} from '../src/index.js';
import { e2eName, e2eSlug } from './fixtures/e2e-marker.js';

/**
 * Étape 4 contre la base locale : publication d'un fact.
 *
 *   candidat → décision humaine autorisée → RaceFactVersion publiée
 *
 * Les sessions sont réelles : chaque persona s'authentifie et agit sous sa
 * propre RLS. C'est le seul moyen de vérifier ce que le lot promet — « aucun
 * chemin d'écriture ne doit permettre de publier sans acte humain autorisé et
 * journalisé ». Un test qui publierait avec la clé de service prouverait
 * exactement le contraire de ce qu'on veut savoir.
 *
 * La clé de service ne sert qu'à construire le monde, et elle le construit par
 * les fonctions réelles des étapes 2 et 3 : parsing, run d'extraction,
 * candidats. Rien n'est semé à la main dans le schéma privé, donc rien ne peut
 * décrire un état que la chaîne ne produirait pas.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

const SUFFIX = Date.now().toString(36);

const ORG_ID = 'eeeeeeee-0000-4000-8000-000000000001';
const EVENT_ID = 'eeeeeeee-0000-4000-8000-000000000003';
const EDITION_ID = 'eeeeeeee-0000-4000-8000-000000000004';
const RACE_ID = 'eeeeeeee-0000-4000-8000-000000000005';
const SOURCE_ID = 'eeeeeeee-0000-4000-8000-000000000006';
const SNAPSHOT_ID = 'eeeeeeee-0000-4000-8000-000000000007';
const EXISTING_FACT = 'eeeeeeee-0000-4000-8000-00000000000d';
const EXISTING_VERSION = 'eeeeeeee-0000-4000-8000-00000000000e';

const PASSWORD = 'pluka-test-2026!';

const ASSISTANCE_KEY = 'assistance/lenk/authorization';
const CUTOFF_KEY = 'cutoff/iffigenalp/arrival';
const RULES_KEY = 'rules/parcours_modifie';

const EXCERPT = 'Assistance autorisée uniquement à Lenk.';

type ServiceClient = ReturnType<typeof createServiceRoleClient>;
type Rpc = {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};
type Row = Record<string, unknown>;

interface Persona {
  readonly userId: string;
  readonly context: FactReviewContext;
}

let service: ServiceClient;
let editor: Persona;
let viewer: Persona;
let runner: Persona;
let plukaAdmin: Persona;
let candidates: Record<string, string> = {};
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

/** Crée un utilisateur réel et ouvre sa session : l'acteur est authentique. */
async function signIn(email: string): Promise<Persona> {
  const admin = service as unknown as {
    auth: {
      admin: {
        createUser(input: {
          email: string;
          password: string;
          email_confirm: boolean;
        }): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
      };
    };
  };

  const created = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });

  const userId = created.data.user?.id ?? '';

  const anonymous = createServerClient({ url: SUPABASE_URL, publishableKey: ANON_KEY });
  const session = await anonymous.auth.signInWithPassword({ email, password: PASSWORD });
  const accessToken = session.data.session?.access_token ?? '';

  const client = createServerClient({ url: SUPABASE_URL, publishableKey: ANON_KEY, accessToken });

  return {
    userId,
    context: { repositories: createFactRepositories({ client }), actor: { userId } },
  };
}

async function failure(promise: Promise<unknown>): Promise<DomainError> {
  const error = await promise.catch((thrown: unknown) => thrown);

  if (!(error instanceof DomainError)) {
    throw new Error(`une DomainError était attendue, reçu : ${String(error)}`);
  }

  return error;
}

async function currentVersion(factKey: string): Promise<{ fact: Row; version: Row } | null> {
  const { data: fact } = await service
    .from('race_facts')
    .select('id, current_version_id')
    .eq('race_id', RACE_ID)
    .eq('fact_key', factKey)
    .maybeSingle();

  if (fact === null || fact.current_version_id === null) return null;

  const { data: version } = await service
    .from('race_fact_versions')
    .select('*')
    .eq('id', fact.current_version_id)
    .maybeSingle();

  return { fact: fact as Row, version: (version ?? {}) as Row };
}

function call(client: ServiceClient): Rpc {
  return client as unknown as Rpc;
}

/**
 * Un candidat au format que l'étape 3 produit.
 *
 * Les index de block renvoient au run de parsing : c'est la couche SQL qui les
 * résout en identifiants, exactement comme en production.
 */
function candidate(input: {
  factType: string;
  factKey: string;
  valueText: string;
  reviewState: 'detected' | 'needs_review';
}): Record<string, unknown> {
  return {
    factType: input.factType,
    subjectKey: input.factKey,
    context: null,
    factKey: input.factKey,
    valueText: input.valueText,
    valueNumber: null,
    unit: null,
    valueJson: null,
    validFrom: null,
    validTo: null,
    confidence: 'high',
    notes: null,
    origin: 'ai',
    reviewState: input.reviewState,
    evidence: [
      {
        blockIndex: 0,
        chunkIndex: 0,
        pageNumber: null,
        sectionPath: ['Règlement', 'Assistance'],
        locator: { cssSelector: 'p' },
        excerpt: EXCERPT,
        isPrimary: true,
      },
    ],
  };
}

beforeAll(async () => {
  available = await reachable();
  if (!available) return;

  service = createServiceRoleClient({ url: SUPABASE_URL, secretKey: SERVICE_KEY });

  await service.from('organizations').delete().eq('id', ORG_ID);

  editor = await signIn(`editor-${SUFFIX}@publication.test`);
  viewer = await signIn(`viewer-${SUFFIX}@publication.test`);
  runner = await signIn(`runner-${SUFFIX}@publication.test`);
  plukaAdmin = await signIn(`admin-${SUFFIX}@publication.test`);

  await service.from('users').update({ platform_role: 'pluka_admin' }).eq('id', plukaAdmin.userId);

  await service
    .from('organizations')
    .insert({ id: ORG_ID, name: e2eName('Org Publication'), slug: e2eSlug('org-pub', SUFFIX) });

  await service.from('organization_members').insert([
    { organization_id: ORG_ID, user_id: editor.userId, role: 'editor' },
    { organization_id: ORG_ID, user_id: viewer.userId, role: 'viewer' },
  ]);

  await service.from('events').insert({
    id: EVENT_ID,
    organization_id: ORG_ID,
    name: e2eName('Trail Publication'),
    slug: e2eSlug('trail-pub', SUFFIX),
    status: 'published',
  });
  await service.from('editions').insert({
    id: EDITION_ID,
    event_id: EVENT_ID,
    year: 2026,
    slug: e2eSlug('trail-pub-2026', SUFFIX),
    start_date: '2026-06-20',
    status: 'published',
  });
  await service.from('races').insert({
    id: RACE_ID,
    edition_id: EDITION_ID,
    name: e2eName('Grand Parcours'),
    slug: e2eSlug('grand-parcours', SUFFIX),
    distance_km: 70,
    start_datetime: '2026-06-20T05:10:00Z',
    status: 'published',
    public_visibility: 'public',
  });

  await service.from('sources').insert({
    id: SOURCE_ID,
    edition_id: EDITION_ID,
    organization_id: ORG_ID,
    source_type: 'url',
    title: 'Règlement 2026',
    url: 'https://organisation.example/reglement',
  });
  await service.from('source_snapshots').insert({
    id: SNAPSHOT_ID,
    source_id: SOURCE_ID,
    version_number: 1,
    content_hash: 'c'.repeat(64),
  });

  // Une barrière déjà publiée, que le règlement contredira (§38). Elle nomme
  // son auteur : la base n'accepterait pas une publication anonyme.
  await service.from('race_facts').insert({
    id: EXISTING_FACT,
    race_id: RACE_ID,
    category: 'cutoff',
    fact_key: CUTOFF_KEY,
  });
  await service.from('race_fact_versions').insert({
    id: EXISTING_VERSION,
    fact_id: EXISTING_FACT,
    version_number: 1,
    value_text: '16:20',
    workflow_status: 'published',
    published_at: new Date().toISOString(),
    published_by_user_id: editor.userId,
  });
  await service
    .from('race_facts')
    .update({ current_version_id: EXISTING_VERSION })
    .eq('id', EXISTING_FACT);

  // ---------------------------------------------------------
  // Les étapes 2 et 3, par leurs fonctions réelles
  // ---------------------------------------------------------
  const parse = await call(service).rpc('worker_start_parse_run', {
    p_snapshot_id: SNAPSHOT_ID,
    p_parser_version: 'parser-1.0.0',
    p_chunker_version: 'chunker-1.0.0',
    p_input_hash: null,
  });

  const parseRunId = String((parse.data as Row[])[0]?.run_id);

  await call(service).rpc('worker_complete_parse_run', {
    p_run_id: parseRunId,
    p_snapshot_id: SNAPSHOT_ID,
    p_blocks: [
      {
        blockIndex: 0,
        pageNumber: null,
        sectionPath: ['Règlement', 'Assistance'],
        heading: 'Assistance',
        blockType: 'paragraph',
        text: EXCERPT,
        locator: { cssSelector: 'p' },
      },
    ],
    p_chunks: [
      {
        chunkIndex: 0,
        text: EXCERPT,
        contentHash: 'd'.repeat(64),
        blockIndexes: [0],
        pageStart: null,
        pageEnd: null,
        sectionLabel: 'Assistance',
      },
    ],
    p_chunker_version: 'chunker-1.0.0',
  });

  const extraction = await call(service).rpc('worker_start_extraction_run', {
    p_parse_run_id: parseRunId,
    p_snapshot_id: SNAPSHOT_ID,
    p_engine_version: 'sources-v1.0.0',
    p_schema_version: 'extractor-1.0.0',
    p_prompt_version: 'extract-facts-1.0.0',
    p_provider: 'fournisseur-test',
    p_model: 'modele-test',
    p_input_hash: null,
  });

  const extractionRunId = String((extraction.data as Row[])[0]?.run_id);

  const recorded = await call(service).rpc('worker_record_fact_candidates', {
    p_run_id: extractionRunId,
    p_parse_run_id: parseRunId,
    p_snapshot_id: SNAPSHOT_ID,
    p_candidates: [
      candidate({
        factType: 'assistance',
        factKey: ASSISTANCE_KEY,
        valueText: 'autorisée uniquement à Lenk',
        reviewState: 'needs_review',
      }),
      // Même clé logique qu'une barrière publiée : l'étape 3 en fait un
      // conflit d'elle-même (§38), aucun statut n'est semé à la main.
      candidate({
        factType: 'cutoff',
        factKey: CUTOFF_KEY,
        valueText: '16:20 selon le guide',
        reviewState: 'detected',
      }),
      candidate({
        factType: 'rules',
        factKey: RULES_KEY,
        valueText: 'parcours modifié',
        reviewState: 'detected',
      }),
    ],
  });

  if (recorded.error !== null && recorded.error !== undefined) {
    throw new Error(`candidats non enregistrés : ${JSON.stringify(recorded.error)}`);
  }

  const read = await call(service).rpc('worker_read_candidates', { p_snapshot_id: SNAPSHOT_ID });

  candidates = Object.fromEntries(
    (read.data as Row[]).map((row) => [String(row.fact_key), String(row.candidate_id)]),
  );
}, 180000);

afterAll(async () => {
  if (!available) return;

  await service.from('organizations').delete().eq('id', ORG_ID);
}, 60000);

describe.runIf(process.env.SUPABASE_SERVICE_ROLE_KEY !== undefined)('publication de facts', () => {
  // ============================================================
  // §30 — la revue, et qui y a accès
  // ============================================================

  it('montre au relecteur ce que §30 exige', async () => {
    if (!available) return;

    const rows = await editor.context.repositories.factReview.listForReview(RACE_ID, 50);
    const assistance = rows.find((row) => row.factKey === ASSISTANCE_KEY);

    // « valeur proposée ; type ; source ; extrait ; page / section ;
    // anciennes valeurs ; contradictions ; action proposée ».
    expect(assistance?.valueText).toBe('autorisée uniquement à Lenk');
    expect(assistance?.category).toBe('assistance');
    expect(assistance?.sourceTitle).toBe('Règlement 2026');
    expect(assistance?.excerpt).toBe(EXCERPT);
    expect(assistance?.sectionPath).toEqual(['Règlement', 'Assistance']);
    expect(assistance?.provider).toBe('fournisseur-test');

    const cutoff = rows.find((row) => row.factKey === CUTOFF_KEY);

    expect(cutoff?.status).toBe('conflict');
    expect(cutoff?.publishedValueText).toBe('16:20');
    expect(cutoff?.conflictType).toBe('published_fact_conflict');
  });

  it("rend l'adresse de la preuve, pas seulement sa citation", () => {
    if (!available) return;

    // §20 : « snapshot_id, block_id ou chunk_id ». Un extrait sans adresse ne
    // se remonte pas jusqu'au document, et l'écran de revue en a besoin pour
    // qu'un réviseur puisse vérifier avant de décider.
    return editor.context.repositories.factReview.listForReview(RACE_ID, 50).then((rows) => {
      const assistance = rows.find((row) => row.factKey === ASSISTANCE_KEY);

      expect(assistance?.snapshotId).toBe(SNAPSHOT_ID);
      expect(assistance?.snapshotContentHash).toBe('c'.repeat(64));
      expect(assistance?.blockIndex).toBe(0);
      expect(assistance?.chunkIndex).toBe(0);
      expect(assistance?.blockContent).toBe(EXCERPT);
      expect(assistance?.locator).toEqual({ cssSelector: 'p' });
      expect(assistance?.sourceType).toBe('url');
      expect(assistance?.organizationName).toBe('Org Publication');
    });
  });

  it('ne montre rien à un coureur', async () => {
    if (!available) return;

    // Deny by default : la fonction contourne la RLS, elle porte donc sa
    // propre condition d'accès (03_PRIVACY_RLS §8).
    expect(await runner.context.repositories.factReview.listForReview(RACE_ID, 50)).toEqual([]);
  });

  // ============================================================
  // §25, §30 — aucune publication sans acte humain autorisé
  // ============================================================

  it('refuse la publication à la clé de service', async () => {
    if (!available) return;

    // Le worker n'a pas de session : `auth.uid()` est nul, et c'est
    // exactement le chemin que §25 ferme. Aucune IA ne publie.
    const { error } = await call(service).rpc('publish_fact_candidate', {
      p_candidate_id: candidates[ASSISTANCE_KEY],
      p_actor_user_id: editor.userId,
      p_trust_level: 'official',
    });

    expect(error).not.toBeNull();
    expect(await currentVersion(ASSISTANCE_KEY)).toBeNull();
  });

  it('refuse la publication à un coureur', async () => {
    if (!available) return;

    const error = await failure(
      publishFactCandidate(runner.context, {
        candidateId: candidates[ASSISTANCE_KEY] ?? '',
        trustLevel: 'official',
        resolveConflict: false,
      }),
    );

    // §120 : un candidat qu'on n'a pas le droit de voir revient absent.
    expect(error.code).toBe('not_found');
  });

  it('refuse la publication à un rôle viewer', async () => {
    if (!available) return;

    const error = await failure(
      publishFactCandidate(viewer.context, {
        candidateId: candidates[ASSISTANCE_KEY] ?? '',
        trustLevel: 'official',
        resolveConflict: false,
      }),
    );

    expect(error.code).toBe('forbidden');
  });

  it("refuse « officielle » à un admin PLUKA non membre de l'organisation", async () => {
    if (!available) return;

    // §32 : PLUKA ne se substitue pas silencieusement à l'organisateur.
    const error = await failure(
      publishFactCandidate(plukaAdmin.context, {
        candidateId: candidates[ASSISTANCE_KEY] ?? '',
        trustLevel: 'official',
        resolveConflict: false,
      }),
    );

    expect(error.code).toBe('forbidden');
    expect(error.details.reason).toBe('OFFICIAL_AUTHORIZATION_REQUIRED');
    expect(await currentVersion(ASSISTANCE_KEY)).toBeNull();
  });

  // ============================================================
  // §33 — les huit étapes
  // ============================================================

  it("publie sur décision de l'éditeur de l'organisation", async () => {
    if (!available) return;

    const published = await publishFactCandidate(editor.context, {
      candidateId: candidates[ASSISTANCE_KEY] ?? '',
      trustLevel: 'official',
      note: 'validé en revue',
      resolveConflict: false,
    });

    expect(published.action).toBe('publish');
    expect(published.versionNumber).toBe(1);
    expect(published.supersededVersionId).toBeNull();
  });

  it("déplace le pointeur, nomme l'auteur et l'organisation", async () => {
    if (!available) return;

    // §33.4, §33.5, §33.6, et §32 pour l'organisation qui confère le niveau.
    const current = await currentVersion(ASSISTANCE_KEY);

    expect(current?.version.value_text).toBe('autorisée uniquement à Lenk');
    expect(current?.version.workflow_status).toBe('published');
    expect(current?.version.trust_level).toBe('official');
    expect(current?.version.published_by_user_id).toBe(editor.userId);
    expect(current?.version.validated_by_organization_id).toBe(ORG_ID);
  });

  it('rattache la preuve à la version publiée', async () => {
    if (!available) return;

    // §33.3 et §34 : « la relation doit conserver le locator exact ».
    const current = await currentVersion(ASSISTANCE_KEY);

    const { data: sources } = await service
      .from('fact_sources')
      .select('source_id, source_snapshot_id, excerpt, section_label, locator, is_primary')
      .eq('fact_version_id', String(current?.version.id));

    const primary = (sources ?? []).find((row) => row.is_primary === true) as Row | undefined;

    expect(primary?.source_id).toBe(SOURCE_ID);
    expect(primary?.source_snapshot_id).toBe(SNAPSHOT_ID);
    expect(primary?.excerpt).toBe(EXCERPT);
    expect(primary?.section_label).toBe('Règlement › Assistance');
    expect((primary?.locator as Row).cssSelector).toBe('p');
  });

  it('signale le changement sans réécrire aucun objet downstream', async () => {
    if (!available) return;

    // §43 et §44 : « le moteur Sources ne réécrit pas lui-même les objets
    // downstream. Il signale le changement. »
    const { data: changes } = await service
      .from('race_change_events')
      .select('severity, published_by_user_id, published_by_organization_id')
      .eq('race_id', RACE_ID);

    expect((changes ?? []).length).toBe(1);
    expect((changes ?? [])[0]).toMatchObject({
      severity: 'important',
      published_by_user_id: editor.userId,
      published_by_organization_id: ORG_ID,
    });

    const { count } = await service
      .from('participant_change_impacts')
      .select('id', { count: 'exact', head: true });

    expect(count).toBe(0);
  });

  // ============================================================
  // §38, §40 — conflits
  // ============================================================

  it('refuse de publier par-dessus une valeur contradictoire', async () => {
    if (!available) return;

    const error = await failure(
      publishFactCandidate(editor.context, {
        candidateId: candidates[CUTOFF_KEY] ?? '',
        trustLevel: 'official',
        resolveConflict: false,
      }),
    );

    expect(error.code).toBe('conflict');
    expect(error.details.reason).toBe('FACT_CONFLICT_UNRESOLVED');

    const current = await currentVersion(CUTOFF_KEY);

    expect(current?.fact.current_version_id).toBe(EXISTING_VERSION);
  });

  it('publie une nouvelle version quand le conflit est tranché', async () => {
    if (!available) return;

    // §40 : « la résolution crée une nouvelle RaceFactVersion. »
    const published = await publishFactCandidate(editor.context, {
      candidateId: candidates[CUTOFF_KEY] ?? '',
      trustLevel: 'official',
      valueText: '16:35',
      note: 'le règlement 2026 fait foi',
      resolveConflict: true,
    });

    expect(published.action).toBe('edit_and_publish');
    expect(published.versionNumber).toBe(2);
    expect(published.supersededVersionId).toBe(EXISTING_VERSION);
  });

  it("n'écrase jamais l'ancienne version", async () => {
    if (!available) return;

    // §35 : « ne jamais écraser ». L'ancienne garde sa valeur et reste
    // accessible à l'audit.
    const { data: old } = await service
      .from('race_fact_versions')
      .select('value_text, workflow_status')
      .eq('id', EXISTING_VERSION)
      .maybeSingle();

    expect(old?.value_text).toBe('16:20');
    expect(old?.workflow_status).toBe('superseded');

    const current = await currentVersion(CUTOFF_KEY);

    expect(current?.version.value_text).toBe('16:35');
    expect(current?.fact.current_version_id).not.toBe(EXISTING_VERSION);
  });

  it('marque un changement de barrière comme critique', async () => {
    if (!available) return;

    // §43 : les barrières font partie des changements à fort impact.
    const { data: changes } = await service
      .from('race_change_events')
      .select('severity')
      .eq('fact_id', EXISTING_FACT);

    expect((changes ?? [])[0]?.severity).toBe('critical');
  });

  // ============================================================
  // §30, §31 — le journal
  // ============================================================

  it('journalise chaque décision, avec son auteur et son autorité', async () => {
    if (!available) return;

    const acts = await editor.context.repositories.factReview.listPublicationActs(RACE_ID, 50);

    const publish = acts.find((act) => act.candidateId === candidates[ASSISTANCE_KEY]);
    const edited = acts.find((act) => act.candidateId === candidates[CUTOFF_KEY]);

    expect(publish).toMatchObject({
      action: 'publish',
      actorUserId: editor.userId,
      authority: 'organization_member',
      actorRole: 'editor',
      trustLevel: 'official',
    });

    // §31 : « une modification manuelle avant publication doit être auditée ».
    expect(edited?.action).toBe('edit_and_publish');
    expect(edited?.originalValue?.valueText).toBe('16:20 selon le guide');
    expect(edited?.publishedValue?.valueText).toBe('16:35');
  });

  it('ne montre le journal quaux personnes autorisées', async () => {
    if (!available) return;

    expect(await runner.context.repositories.factReview.listPublicationActs(RACE_ID, 50)).toEqual(
      [],
    );
  });

  // ============================================================
  // §31 — les décisions qui ne publient pas
  // ============================================================

  it('rejette un candidat sans rien publier', async () => {
    if (!available) return;

    const status = await decideFactCandidate(editor.context, {
      candidateId: candidates[RULES_KEY] ?? '',
      decision: 'reject',
      note: 'information non confirmée par la source',
    });

    expect(status).toBe('rejected');
    expect(await currentVersion(RULES_KEY)).toBeNull();
  });

  it('journalise aussi un rejet', async () => {
    if (!available) return;

    const acts = await editor.context.repositories.factReview.listPublicationActs(RACE_ID, 50);
    const reject = acts.find((act) => act.candidateId === candidates[RULES_KEY]);

    expect(reject).toMatchObject({ action: 'reject', actorUserId: editor.userId });
    expect(reject?.factVersionId).toBeNull();
  });

  it('refuse une décision à un rôle viewer', async () => {
    if (!available) return;

    const error = await failure(
      decideFactCandidate(viewer.context, {
        candidateId: candidates[CUTOFF_KEY] ?? '',
        decision: 'mark_duplicate',
      }),
    );

    expect(error.code).toBe('forbidden');
  });

  it('refuse de republier un candidat déjà tranché', async () => {
    if (!available) return;

    // §25 : republier créerait une seconde version identique sans décision
    // nouvelle.
    const error = await failure(
      publishFactCandidate(editor.context, {
        candidateId: candidates[ASSISTANCE_KEY] ?? '',
        trustLevel: 'official',
        resolveConflict: false,
      }),
    );

    expect(error.code).toBe('invalid_state');
  });
});
