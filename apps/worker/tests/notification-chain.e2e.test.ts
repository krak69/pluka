import type { EmailMessage, EmailProvider, EmailSendResult } from '@pluka/contracts';
import { createServiceRoleClient } from '@pluka/db/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handleNotificationMessage } from '../src/jobs/notification-send.js';
import { tick } from '../src/loop.js';
import { createPorts } from '../src/ports-supabase.js';
import type { QueueMessage, WorkerPorts } from '../src/ports.js';

/**
 * Notification du coureur, de bout en bout contre la base locale — §46.
 *
 *   impact → livraison → outbox → pgmq → worker → EmailProvider
 *
 * Le fournisseur est simulé : c'est le seul maillon qu'on ne peut pas exercer
 * sans envoyer un vrai email. Tout le reste est réel — la livraison, la file,
 * la réclamation, l'idempotence et la dégradation.
 *
 * Ce que le test unitaire ne peut pas montrer : qu'un message pgmq qui revient
 * ne produit pas un second email, et qu'une panne du fournisseur laisse
 * l'impact lisible dans l'application.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const SUFFIX = Date.now().toString(36);

const ORG_ID = 'ddddeeee-0000-4000-8000-000000000001';
const EVENT_ID = 'ddddeeee-0000-4000-8000-000000000002';
const EDITION_ID = 'ddddeeee-0000-4000-8000-000000000003';
const RACE_ID = 'ddddeeee-0000-4000-8000-000000000004';
const FACT_ID = 'ddddeeee-0000-4000-8000-000000000005';
const VERSION_ID = 'ddddeeee-0000-4000-8000-000000000006';
const CHANGE_ID = 'ddddeeee-0000-4000-8000-000000000007';
const RUNNER_RACE = 'ddddeeee-0000-4000-8000-000000000010';
const INVITED_RACE = 'ddddeeee-0000-4000-8000-000000000011';
const SILENT_RACE = 'ddddeeee-0000-4000-8000-000000000012';

type ServiceClient = ReturnType<typeof createServiceRoleClient>;
type Rpc = {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};
type Row = Record<string, unknown>;

let client: ServiceClient;
let ports: WorkerPorts;
let runnerEmail = '';
let publisherId = '';
let available = false;

/** Ce que le fournisseur a reçu, et ce qu'il fait. */
const outbox: EmailMessage[] = [];
let behaviour: 'ok' | 'down' = 'ok';

const fakeEmail: EmailProvider = {
  name: 'fournisseur-simule',
  send(message: EmailMessage): Promise<EmailSendResult> {
    if (behaviour === 'down') return Promise.reject(new Error('502 bad gateway'));

    outbox.push(message);

    return Promise.resolve({
      providerMessageId: `msg-${outbox.length}`,
      acceptedAt: new Date().toISOString(),
    });
  },
};

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

async function deliveries(): Promise<Row[]> {
  const { data } = await call().rpc('worker_read_notifications', {
    p_change_event_id: CHANGE_ID,
  });

  return (data ?? []) as Row[];
}

/**
 * Le message adressé à notre coureur.
 *
 * Les suites de bout en bout partagent une base et la file `pluka_email` : un
 * tour de boucle peut consommer le message d'une autre suite. Chercher par
 * destinataire rend l'assertion indépendante de ce qui traîne.
 */
function ourMessage(): EmailMessage | undefined {
  return outbox.find((message) => message.to[0]?.address === runnerEmail);
}

function messageFor(deliveryId: string, msgId = 1): QueueMessage {
  return {
    msgId,
    readCount: 1,
    payload: { deliveryId, idempotencyKey: `email.send:${deliveryId}` },
  };
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
    password: 'pluka-test-2026!',
    email_confirm: true,
  });

  return created.data.user?.id ?? '';
}

beforeAll(async () => {
  available = await reachable();
  if (!available) return;

  client = createServiceRoleClient({ url: SUPABASE_URL, secretKey: SERVICE_KEY });

  const base = createPorts(client);
  ports = { ...base, email: fakeEmail, appUrl: 'https://app.pluka.test' };

  await client.from('organizations').delete().eq('id', ORG_ID);

  runnerEmail = `runner-${SUFFIX}@notification.test`;
  const runnerId = await createUser(runnerEmail);
  const silentId = await createUser(`silencieux-${SUFFIX}@notification.test`);
  publisherId = await createUser(`publisher-${SUFFIX}@notification.test`);

  await client.from('users').update({ first_name: 'Camille' }).eq('id', runnerId);

  await client
    .from('organizations')
    .insert({ id: ORG_ID, name: 'Org Notification', slug: `org-notif-${SUFFIX}` });
  await client
    .from('organization_members')
    .insert({ organization_id: ORG_ID, user_id: publisherId, role: 'editor' });

  await client.from('events').insert({
    id: EVENT_ID,
    organization_id: ORG_ID,
    name: 'Trail des Tests',
    slug: `trail-notif-${SUFFIX}`,
    status: 'published',
  });
  await client.from('editions').insert({
    id: EDITION_ID,
    event_id: EVENT_ID,
    year: 2026,
    slug: `trail-notif-2026-${SUFFIX}`,
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

  // Un coureur inscrit avec un compte, et un invité qui n'a jamais activé le
  // sien : il n'y a personne à qui écrire pour le second.
  await client.from('participant_races').insert([
    { id: RUNNER_RACE, race_id: RACE_ID, user_id: runnerId, status: 'active' },
    {
      id: INVITED_RACE,
      race_id: RACE_ID,
      invite_email: `invite-${SUFFIX}@notification.test`,
      status: 'active',
    },
    { id: SILENT_RACE, race_id: RACE_ID, user_id: silentId, status: 'active' },
  ]);

  // §46 : informer est la règle, se taire est un choix. Celui-ci l'a fait.
  await client
    .from('participant_race_settings')
    .insert({ participant_race_id: SILENT_RACE, notifications_enabled: false });

  await client.from('race_facts').insert({
    id: FACT_ID,
    race_id: RACE_ID,
    category: 'equipment',
    fact_key: 'equipment/veste',
  });
  await client.from('race_fact_versions').insert({
    id: VERSION_ID,
    fact_id: FACT_ID,
    version_number: 1,
    value_text: 'Veste imperméable obligatoire',
    workflow_status: 'published',
    published_at: new Date().toISOString(),
    published_by_user_id: publisherId,
  });
  await client.from('race_facts').update({ current_version_id: VERSION_ID }).eq('id', FACT_ID);

  await client.from('race_change_events').insert({
    id: CHANGE_ID,
    race_id: RACE_ID,
    fact_id: FACT_ID,
    to_version_id: VERSION_ID,
    severity: 'critical',
    title: 'equipment/veste',
    published_by_user_id: publisherId,
  });

  // L'analyse de 0014, qui crée les impacts et demande les notifications.
  await call().rpc('worker_analyze_change_impact', { p_change_event_id: CHANGE_ID });
}, 180000);

afterAll(async () => {
  if (available) await client.from('organizations').delete().eq('id', ORG_ID);
}, 60000);

describe.runIf(process.env.SUPABASE_SERVICE_ROLE_KEY !== undefined)('livraisons', () => {
  it('crée une livraison par coureur joignable, pas par module', async () => {
    if (!available) return;

    // Un changement peut concerner plusieurs modules ; le coureur ne doit pas
    // recevoir un email par module.
    const rows = await deliveries();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ participant_race_id: RUNNER_RACE, status: 'pending' });
  });

  it('n’en crée aucune pour un invité sans compte', async () => {
    if (!available) return;

    // Il n'y a pas d'adresse à qui écrire : il verra l'impact dans
    // l'application quand il la rejoindra.
    const rows = await deliveries();

    expect(rows.some((row) => row.participant_race_id === INVITED_RACE)).toBe(false);
  });

  it('n’en crée aucune pour un coureur qui a coupé ses notifications — §46', async () => {
    if (!available) return;

    const rows = await deliveries();

    expect(rows.some((row) => row.participant_race_id === SILENT_RACE)).toBe(false);
  });

  it('laisse son impact lisible malgré tout', async () => {
    if (!available) return;

    // Couper l'email ne coupe pas l'information : l'application reste le canal
    // qui ne dépend ni d'un fournisseur, ni d'un réglage.
    const { data } = await call().rpc('worker_read_change_impacts', {
      p_change_event_id: CHANGE_ID,
    });

    expect((data as Row[]).map((row) => row.participant_race_id)).toContain(SILENT_RACE);
  });

  it('a bien produit l’impact correspondant', async () => {
    if (!available) return;

    const { data } = await call().rpc('worker_read_change_impacts', {
      p_change_event_id: CHANGE_ID,
    });

    expect((data as Row[]).map((row) => row.participant_race_id)).toContain(RUNNER_RACE);
  });
});

describe.runIf(process.env.SUPABASE_SERVICE_ROLE_KEY !== undefined)('envoi', () => {
  it('achemine la demande jusqu’au fournisseur — §46', async () => {
    if (!available) return;

    // Un tour : le dispatcher traduit `email.send` en message sur
    // `pluka_email`, la boucle le consomme, le message part.
    const result = await tick(ports);

    expect(result.dispatched).toBeGreaterThanOrEqual(1);
    expect(ourMessage()).toBeDefined();
  });

  it('écrit au coureur, et à lui seul', async () => {
    if (!available) return;

    // §37 : l'organisation ne reçoit aucune copie.
    const message = ourMessage();

    expect(message?.to).toHaveLength(1);
    expect(message?.to[0]?.address).toBe(runnerEmail);
    expect(message?.to[0]?.name).toBe('Camille');
  });

  it('dit ce qui a changé sans rien promettre — §46', async () => {
    if (!available) return;

    const message = ourMessage();

    expect(message?.subject).toContain('Grand Parcours');
    expect(message?.textBody).toContain('Trail des Tests');
    expect(message?.textBody).toContain('equipment/veste');
    expect(message?.textBody).toContain("Rien n'a été modifié à ta place");
    expect(message?.textBody).toContain('https://app.pluka.test/courses/');
  });

  it('ne contient aucune adresse d’un autre coureur', async () => {
    if (!available) return;

    const body = ourMessage()?.textBody ?? '';

    expect(body).not.toContain('@notification.test');
    expect(body).not.toContain('invite-');
  });

  it('marque la livraison envoyée, avec sa trace', async () => {
    if (!available) return;

    const row = (await deliveries())[0];

    expect(row).toMatchObject({
      status: 'sent',
      provider: 'fournisseur-simule',
      template_version: 'change-impact-1.0.0',
      attempts: 1,
    });
  });
});

describe.runIf(process.env.SUPABASE_SERVICE_ROLE_KEY !== undefined)('idempotence', () => {
  it('ne renvoie rien quand le message pgmq revient — §22.1', async () => {
    if (!available) return;

    const deliveryId = String((await deliveries())[0]?.delivery_id);
    const before = outbox.length;

    const outcome = await handleNotificationMessage(ports, messageFor(deliveryId, 2));

    expect(outcome).toEqual({ kind: 'already_done', deliveryId });
    expect(outbox.length).toBe(before);
  });

  it('ne recrée pas de livraison si l’analyse est rejouée', async () => {
    if (!available) return;

    await call().rpc('worker_analyze_change_impact', { p_change_event_id: CHANGE_ID });

    expect(await deliveries()).toHaveLength(1);
  });
});

// ============================================================
// §35 — une panne du fournisseur dégrade explicitement
// ============================================================

describe.runIf(process.env.SUPABASE_SERVICE_ROLE_KEY !== undefined)('dégradation', () => {
  const FACT = 'ddddeeee-0000-4000-8000-000000000020';
  const VERSION = 'ddddeeee-0000-4000-8000-000000000021';
  const CHANGE = 'ddddeeee-0000-4000-8000-000000000022';

  let deliveryId = '';

  async function delivery(): Promise<Row | undefined> {
    const { data } = await call().rpc('worker_read_notifications', {
      p_change_event_id: CHANGE,
    });

    return (data as Row[])[0];
  }

  beforeAll(async () => {
    if (!available) return;

    // Un second changement, pour obtenir une livraison neuve.
    await client
      .from('race_facts')
      .insert({ id: FACT, race_id: RACE_ID, category: 'safety', fact_key: 'safety/kit-froid' });
    await client.from('race_fact_versions').insert({
      id: VERSION,
      fact_id: FACT,
      version_number: 1,
      value_text: 'Kit froid obligatoire',
      workflow_status: 'published',
      published_at: new Date().toISOString(),
      published_by_user_id: publisherId,
    });
    await client.from('race_facts').update({ current_version_id: VERSION }).eq('id', FACT);
    await client.from('race_change_events').insert({
      id: CHANGE,
      race_id: RACE_ID,
      fact_id: FACT,
      to_version_id: VERSION,
      severity: 'critical',
      title: 'safety/kit-froid',
      published_by_user_id: publisherId,
    });

    await call().rpc('worker_analyze_change_impact', { p_change_event_id: CHANGE });

    deliveryId = String((await delivery())?.delivery_id);
  }, 60000);

  it('retente au lieu d’abandonner', async () => {
    if (!available) return;

    behaviour = 'down';
    const before = outbox.length;

    const outcome = await handleNotificationMessage(ports, messageFor(deliveryId, 10));

    expect(outcome.kind).toBe('retry');
    expect(outbox.length).toBe(before);
  });

  it('garde la livraison visible, avec sa raison — jamais perdue', async () => {
    if (!available) return;

    const row = await delivery();

    // Elle redevient en attente : le compteur a avancé, l'erreur est écrite,
    // et rien n'a disparu.
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(1);
    expect(String(row?.last_error)).toContain('PROVIDER_UNAVAILABLE');
    expect(String(row?.last_error)).toContain('[transient]');
  });

  it('laisse l’impact lisible dans l’application malgré la panne', async () => {
    if (!available) return;

    // C'est le canal qui ne dépend de personne : même sans email, le coureur
    // voit que sa préparation est concernée (§46).
    const { data } = await call().rpc('worker_read_change_impacts', {
      p_change_event_id: CHANGE,
    });

    expect((data as Row[]).length).toBeGreaterThan(0);
  });

  it('envoie quand le fournisseur revient', async () => {
    if (!available) return;

    behaviour = 'ok';

    const outcome = await handleNotificationMessage(ports, messageFor(deliveryId, 11));

    expect(outcome.kind).toBe('sent');

    const row = await delivery();

    expect(row?.status).toBe('sent');
    expect(row?.attempts).toBe(2);
    expect(row?.last_error).toBeNull();
  });

  it('n’envoie rien quand aucun fournisseur n’est configuré — §28, §35', async () => {
    if (!available) return;

    // La brique se désactive proprement : la livraison reste persistée, et le
    // job repartira quand un fournisseur sera configuré.
    const { data } = await call().rpc('worker_read_notifications', {
      p_change_event_id: CHANGE_ID,
    });

    const sentDelivery = String((data as Row[])[0]?.delivery_id);

    await call().rpc('worker_fail_notification', {
      p_delivery_id: sentDelivery,
      p_error: 'remise en attente pour le test',
    });

    const outcome = await handleNotificationMessage(
      { ...ports, email: null },
      messageFor(sentDelivery, 12),
    );

    expect(outcome.kind).toBe('retry');
    expect((outcome as { code: string }).code).toBe('EMAIL_NOT_CONFIGURED');
  });
});
