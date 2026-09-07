import { createGpxRepositories, raceGpxStoragePath } from '@pluka/db';
import { createServerClient, createServiceRoleClient } from '@pluka/db/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DomainError,
  getRaceGpxImport,
  importRaceGpx,
  type GpxImportContext,
} from '../src/index.js';
import { e2eName, e2eSlug } from './fixtures/e2e-marker.js';

/**
 * Dépôt d'un GPX contre la base locale.
 *
 * Ce test existe pour une raison précise : le défaut qu'il attrape était
 * invisible aux tests unitaires. 0023 avait ouvert le bucket par une policy
 * `insert` correcte — le prédicat était juste, et un `insert` nu passait — mais
 * l'API Storage écrit avec `returning`, et PostgreSQL applique les policies
 * `select` aux lignes rendues. Sans policy `select`, aucun dépôt n'aboutissait,
 * et le fake du test unitaire, lui, acceptait tout.
 *
 * Un fake ne peut pas porter cette règle : elle appartient à PostgreSQL et à
 * l'API Storage. Seul un dépôt réel, sous une vraie session, la vérifie.
 *
 * Les sessions sont donc réelles et chaque persona agit sous sa propre RLS. La
 * clé de service ne sert qu'à construire le monde et à le relire — jamais à
 * déposer, ce qui prouverait l'inverse de ce qu'on veut savoir.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

const SUFFIX = Date.now().toString(36);
const PASSWORD = 'pluka-test-2026!';
const BUCKET = 'race-sources';

/**
 * Un monde neuf à chaque exécution.
 *
 * Des identifiants fixes seraient plus lisibles, mais ce monde ne peut pas
 * être démonté : un dépôt réel crée un `source_snapshot`, et les snapshots
 * sont immuables par trigger — ce sont des preuves. Un `delete` de
 * l'organisation casserait dessus, l'exécution suivante retrouverait un monde
 * à moitié construit, et les refus deviendraient des `not_found` trompeurs.
 *
 * Chaque exécution laisse donc derrière elle son référentiel de test. C'est le
 * prix de l'immuabilité, et il est assumé : cette suite ne tourne que sur
 * demande, avec `SUPABASE_SERVICE_ROLE_KEY`.
 */
const ORG_ID = crypto.randomUUID();
const EVENT_ID = crypto.randomUUID();
const EDITION_ID = crypto.randomUUID();
const RACE_ID = crypto.randomUUID();
/** Événement sans organisation gestionnaire : le cas signalé (§4.1). */
const ORPHAN_EVENT_ID = crypto.randomUUID();
const ORPHAN_EDITION_ID = crypto.randomUUID();
const ORPHAN_RACE_ID = crypto.randomUUID();

const TRACE = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="pluka-test"><trk><name>Parcours</name><trkseg>
<trkpt lat="46.500" lon="7.500"><ele>1000</ele></trkpt>
<trkpt lat="46.505" lon="7.505"><ele>1080</ele></trkpt>
<trkpt lat="46.510" lon="7.510"><ele>1160</ele></trkpt>
</trkseg></trk></gpx>`;

const OTHER_TRACE = TRACE.replace('<name>Parcours</name>', '<name>Variante</name>');

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

interface Persona {
  readonly userId: string;
  readonly context: GpxImportContext;
  /** Client brut, pour éprouver la policy du bucket hors du use case. */
  readonly client: ReturnType<typeof createServerClient>;
}

let service: ServiceClient;
let editor: Persona;
let viewer: Persona;
let plukaAdmin: Persona;
let outsider: Persona;
let available = false;
const deposited: string[] = [];

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

async function sha256Hex(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
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
        }): Promise<{ data: { user: { id: string } | null } }>;
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
    client,
    context: { repositories: createGpxRepositories({ client }), actor: { userId } },
  };
}

/** Dépose une trace et retient le chemin, pour que le nettoyage le retrouve. */
async function deposit(
  persona: Persona,
  raceId: string,
  content: string,
  fileName = 'parcours.gpx',
): Promise<{ storagePath: string; sourceSnapshotId: string }> {
  const receipt = await importRaceGpx(persona.context, {
    raceId,
    fileName,
    content,
    contentHash: await sha256Hex(content),
  });

  deposited.push(receipt.storagePath);

  return receipt;
}

async function failure(promise: Promise<unknown>): Promise<DomainError> {
  const error = await promise.catch((thrown: unknown) => thrown);

  if (!(error instanceof DomainError)) {
    throw new Error(`une DomainError était attendue, reçu : ${String(error)}`);
  }

  return error;
}

beforeAll(async () => {
  available = await reachable();
  if (!available) return;

  service = createServiceRoleClient({ url: SUPABASE_URL, secretKey: SERVICE_KEY });

  editor = await signIn(`gpx-editor-${SUFFIX}@pluka.test`);
  viewer = await signIn(`gpx-viewer-${SUFFIX}@pluka.test`);
  plukaAdmin = await signIn(`gpx-admin-${SUFFIX}@pluka.test`);
  outsider = await signIn(`gpx-outsider-${SUFFIX}@pluka.test`);

  await service.from('users').update({ platform_role: 'pluka_admin' }).eq('id', plukaAdmin.userId);

  await service
    .from('organizations')
    .insert({ id: ORG_ID, name: e2eName('Org GPX'), slug: e2eSlug('org-gpx', SUFFIX) });

  await service.from('organization_members').insert([
    { organization_id: ORG_ID, user_id: editor.userId, role: 'editor' },
    { organization_id: ORG_ID, user_id: viewer.userId, role: 'viewer' },
  ]);

  await service.from('events').insert([
    {
      id: EVENT_ID,
      organization_id: ORG_ID,
      name: e2eName('Trail GPX'),
      slug: e2eSlug('trail-gpx', SUFFIX),
      status: 'published',
    },
    {
      id: ORPHAN_EVENT_ID,
      organization_id: null,
      name: e2eName('Trail Maintenu PLUKA'),
      slug: e2eSlug('trail-pluka', SUFFIX),
      status: 'published',
    },
  ]);

  await service.from('editions').insert([
    {
      id: EDITION_ID,
      event_id: EVENT_ID,
      year: 2026,
      slug: e2eSlug('trail-gpx-2026', SUFFIX),
      start_date: '2026-06-20',
      status: 'published',
    },
    {
      id: ORPHAN_EDITION_ID,
      event_id: ORPHAN_EVENT_ID,
      year: 2026,
      slug: e2eSlug('trail-pluka-2026', SUFFIX),
      start_date: '2026-08-15',
      status: 'published',
    },
  ]);

  await service.from('races').insert([
    {
      id: RACE_ID,
      edition_id: EDITION_ID,
      name: e2eName('70K'),
      slug: e2eSlug('70k', SUFFIX),
      distance_km: 70,
      start_datetime: '2026-06-20T05:00:00Z',
      status: 'draft',
    },
    {
      id: ORPHAN_RACE_ID,
      edition_id: ORPHAN_EDITION_ID,
      name: e2eName('30K'),
      slug: e2eSlug('30k', SUFFIX),
      distance_km: 30,
      start_datetime: '2026-08-15T05:00:00Z',
      status: 'draft',
    },
  ]);
}, 60000);

afterAll(async () => {
  if (!available) return;

  // Les fichiers partent par l'API Storage : la suppression directe dans
  // `storage.objects` est refusée par la base, et c'est voulu.
  //
  // Le référentiel reste, lui : voir le commentaire des identifiants. Ce qui
  // s'accumule est du contenu de course de test, sans donnée personnelle.
  if (deposited.length > 0) await service.storage.from(BUCKET).remove(deposited);
}, 60000);

describe.runIf(process.env.SUPABASE_SERVICE_ROLE_KEY !== undefined)('dépôt d’un GPX', () => {
  it('aboutit pour l’éditeur de l’organisation gestionnaire', async () => {
    if (!available) return;

    const receipt = await deposit(editor, RACE_ID, TRACE);

    expect(receipt.storagePath).toBe(raceGpxStoragePath(RACE_ID, await sha256Hex(TRACE)));
    expect(receipt.sourceSnapshotId).toMatch(/^[0-9a-f-]{36}$/);
  }, 30000);

  it('aboutit pour `pluka_admin` sur une épreuve sans organisation — §4.1', async () => {
    if (!available) return;

    // Le cas signalé. Il échouait sur « la base a refusé l'opération », non
    // par manque d'autorité mais parce que la policy `select` manquait.
    const receipt = await deposit(plukaAdmin, ORPHAN_RACE_ID, TRACE);

    expect(receipt.storagePath).toContain(ORPHAN_RACE_ID);
  }, 30000);

  it('écrit réellement le fichier dans le bucket', async () => {
    if (!available) return;

    const listed = await service.storage.from(BUCKET).list(`races/${RACE_ID}/gpx`, { limit: 100 });

    expect(listed.error).toBeNull();
    expect(listed.data?.map((entry) => entry.name)).toContain(`${await sha256Hex(TRACE)}.gpx`);
  }, 30000);

  it('arme la chaîne de traitement : job et événement outbox', async () => {
    if (!available) return;

    // Sans le job, le worker ne verra jamais le fichier — et §22.2 veut qu'il
    // soit écrit dans la transaction du dépôt. `private.ingestion_jobs` n'est
    // pas exposé par PostgREST : c'est l'état rendu par le use case qui en
    // atteste, et c'est très bien — il passe par la fonction de 0023, donc par
    // le chemin réel de l'écran.
    const status = await getRaceGpxImport(editor.context, { raceId: RACE_ID });

    // Ce qui se vérifie est l'existence du job, pas son statut à l'instant de
    // la lecture : un worker qui tourne pendant la suite l'aura peut-être déjà
    // réclamé. Exiger `queued` faisait échouer le test une fois sur deux, selon
    // qu'un worker consommait la file ou non.
    expect(status.job).not.toBeNull();
    expect(status.stage).not.toBe('none');
    expect(status.snapshot?.contentHash).toBe(await sha256Hex(TRACE));
  }, 30000);

  it('ne crée pas deux traitements pour le même fichier — §22.1', async () => {
    if (!available) return;

    const again = await deposit(editor, RACE_ID, TRACE);
    const status = await getRaceGpxImport(editor.context, { raceId: RACE_ID });

    expect(again.sourceSnapshotId).toBe(status.snapshot?.id);
  }, 30000);

  it('traite un fichier différent comme une nouvelle version', async () => {
    if (!available) return;

    const receipt = await deposit(editor, RACE_ID, OTHER_TRACE, 'variante.gpx');
    const status = await getRaceGpxImport(editor.context, { raceId: RACE_ID });

    expect(receipt.sourceSnapshotId).toBe(status.snapshot?.id);
    expect(status.snapshot?.contentHash).toBe(await sha256Hex(OTHER_TRACE));
  }, 30000);
});

describe.runIf(process.env.SUPABASE_SERVICE_ROLE_KEY !== undefined)('dépôt refusé', () => {
  it('refuse un viewer : lire n’est pas modifier le parcours', async () => {
    if (!available) return;

    const error = await failure(
      importRaceGpx(viewer.context, {
        raceId: RACE_ID,
        fileName: 'intrus.gpx',
        content: TRACE,
        contentHash: await sha256Hex(TRACE),
      }),
    );

    expect(error.code).toBe('forbidden');
  }, 30000);

  it('refuse un inconnu sans lui confirmer que l’épreuve existe — §120', async () => {
    if (!available) return;

    // Sous RLS réelle, une épreuve en brouillon qu'on n'a pas le droit de voir
    // est une épreuve absente : `loadRaceScope` ne la trouve pas, et le refus
    // est `not_found`. Les tests unitaires voient `forbidden`, leur fake
    // n'ayant pas de RLS — la différence est le sujet même de §120.
    const error = await failure(
      importRaceGpx(outsider.context, {
        raceId: RACE_ID,
        fileName: 'intrus.gpx',
        content: TRACE,
        contentHash: await sha256Hex(TRACE),
      }),
    );

    expect(error.code).toBe('not_found');
  }, 30000);

  it('refuse un éditeur d’organisation sur une épreuve sans organisation', async () => {
    if (!available) return;

    // §4.1 : elle n'est administrable que par `pluka_admin`. Elle ne lui est
    // pas non plus visible, d'où le même refus muet.
    const error = await failure(
      importRaceGpx(editor.context, {
        raceId: ORPHAN_RACE_ID,
        fileName: 'parcours.gpx',
        content: TRACE,
        contentHash: await sha256Hex(TRACE),
      }),
    );

    expect(error.code).toBe('not_found');
  }, 30000);

  it('n’écrit rien dans le bucket quand le dépôt est refusé', async () => {
    if (!available) return;

    // La garde passe avant l'écriture, et la policy du bucket la doublerait de
    // toute façon. Le vérifier ici ferme la question : un refus ne laisse pas
    // de fichier derrière lui.
    await failure(
      importRaceGpx(outsider.context, {
        raceId: RACE_ID,
        fileName: 'intrus.gpx',
        content: OTHER_TRACE,
        contentHash: await sha256Hex(OTHER_TRACE),
      }),
    );

    const listed = await service.storage.from(BUCKET).list(`races/${RACE_ID}/gpx`, { limit: 100 });
    const names = listed.data?.map((entry) => entry.name) ?? [];

    // Rien d'autre que ce que les dépôts autorisés ont écrit.
    expect(names.sort()).toEqual(
      [...new Set(deposited.filter((path) => path.startsWith(`races/${RACE_ID}/`)))]
        .map((path) => path.split('/').pop() as string)
        .sort(),
    );
  }, 30000);

  it('refuse la lecture d’état à qui ne peut pas déposer', async () => {
    if (!available) return;

    const error = await failure(getRaceGpxImport(viewer.context, { raceId: RACE_ID }));

    expect(error.code).toBe('forbidden');
  }, 30000);
});

describe.runIf(process.env.SUPABASE_SERVICE_ROLE_KEY !== undefined)('policy du bucket', () => {
  it('refuse un chemin qui ne désigne aucune épreuve', async () => {
    if (!available) return;

    // Le chemin est une donnée d'autorisation. Éprouvé ici hors du use case,
    // parce que le repository construit toujours un chemin conforme : c'est la
    // base qui doit refuser l'autre, pas notre code.
    const refused = await plukaAdmin.client.storage
      .from(BUCKET)
      .upload(`ailleurs/${SUFFIX}.gpx`, new Blob([TRACE]), { upsert: true });

    expect(refused.error).not.toBeNull();
  }, 30000);

  it('refuse un chemin conforme visant une épreuve inexistante', async () => {
    if (!available) return;

    // Même pour `pluka_admin` : sans cette borne, le statut plateforme
    // ouvrirait le bucket entier.
    const refused = await plukaAdmin.client.storage
      .from(BUCKET)
      .upload(`races/dddddddd-0000-4000-8000-0000000000ff/gpx/${SUFFIX}.gpx`, new Blob([TRACE]), {
        upsert: true,
      });

    expect(refused.error).not.toBeNull();
  }, 30000);
});
