import { createHash } from 'node:crypto';

import type { EmailMessage, EmailProvider, EmailSendResult } from '@pluka/contracts';
import { staffTeamRepository, type PlukaClient } from '@pluka/db';
import { createServerClient, createServiceRoleClient } from '@pluka/db/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handleStaffInvitationMessage } from '../src/jobs/staff-invitation-send.js';
import { createPorts } from '../src/ports-supabase.js';
import type { QueueMessage, WorkerPorts } from '../src/ports.js';

/**
 * Invitation à l'équipe PLUKA, de bout en bout contre la base locale —
 * migrations 0035, 0036. Fournisseur email simulé ; gardes SQL réelles.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const PASSWORD = 'pluka-test-2026!';

const SUFFIX = Date.now().toString(36);
const SUPER_EMAIL = `super-${SUFFIX}@staff.test`;
const INVITEE_EMAIL = `support-${SUFFIX}@staff.test`;
const STRANGER_EMAIL = `stranger-${SUFFIX}@staff.test`;

let service: ReturnType<typeof createServiceRoleClient>;
let ports: WorkerPorts;
let available = false;
const userIds: string[] = [];
const sent: EmailMessage[] = [];

const fakeEmail: EmailProvider = {
  name: 'fournisseur-simule',
  send(message: EmailMessage): Promise<EmailSendResult> {
    sent.push(message);
    return Promise.resolve({
      providerMessageId: `m-${sent.length}`,
      acceptedAt: new Date().toISOString(),
    });
  },
};

type AuthClient = {
  auth: {
    admin: {
      createUser(input: { email: string; password: string; email_confirm: boolean }): Promise<{
        data: { user: { id: string } | null };
      }>;
      deleteUser(id: string): Promise<unknown>;
    };
    signInWithPassword(input: { email: string; password: string }): Promise<{
      data: { session: { access_token: string } | null };
    }>;
  };
};

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

async function createUser(email: string): Promise<string> {
  const created = await (service as unknown as AuthClient).auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  const id = created.data.user?.id ?? '';
  userIds.push(id);
  return id;
}

async function clientAs(email: string): Promise<PlukaClient> {
  const anonymous = createServerClient({ url: SUPABASE_URL, publishableKey: ANON_KEY });
  const { data } = await (anonymous as unknown as AuthClient).auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  return createServerClient({
    url: SUPABASE_URL,
    publishableKey: ANON_KEY,
    accessToken: data.session?.access_token ?? '',
  });
}

const hash = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

function tokenFromEmail(): string {
  const message = sent.find((candidate) => candidate.to[0]?.address === INVITEE_EMAIL);
  return /\/invitation-equipe\/([A-Za-z0-9_-]{43})/.exec(message?.textBody ?? '')?.[1] ?? '';
}

beforeAll(async () => {
  available = await reachable();
  if (!available) return;

  service = createServiceRoleClient({ url: SUPABASE_URL, secretKey: SERVICE_KEY });
  ports = {
    ...createPorts(service, { appUrl: 'http://localhost:3001', adminUrl: 'http://localhost:3002' }),
    email: fakeEmail,
  };

  const superId = await createUser(SUPER_EMAIL);
  await createUser(INVITEE_EMAIL);
  await createUser(STRANGER_EMAIL);

  // Sans session : le verrou de colonnes de 0035 laisse passer le service.
  await service
    .from('users')
    .update({ platform_role: 'pluka_admin', staff_role: 'super_admin' })
    .eq('id', superId);
}, 60000);

afterAll(async () => {
  if (!available) return;
  await service.from('staff_invitations').delete().like('email', `%-${SUFFIX}@staff.test`);
  for (const id of userIds) await (service as unknown as AuthClient).auth.admin.deleteUser(id);
}, 60000);

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)(
  'invitation à l’équipe PLUKA, de bout en bout',
  () => {
    let invitationId = '';

    it('le super-admin invite ; le job envoie le lien vers la console', async () => {
      const admin = staffTeamRepository({ client: await clientAs(SUPER_EMAIL) });
      invitationId = await admin.invite(INVITEE_EMAIL, 'support');

      const message: QueueMessage = {
        msgId: 0,
        readCount: 1,
        payload: { staffInvitationId: invitationId },
      };
      await expect(handleStaffInvitationMessage(ports, message)).resolves.toMatchObject({
        kind: 'sent',
      });

      expect(tokenFromEmail()).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(sent.at(-1)?.textBody).toContain('http://localhost:3002/invitation-equipe/');
    });

    it('un autre compte, même avec le lien, est refusé', async () => {
      const stranger = staffTeamRepository({ client: await clientAs(STRANGER_EMAIL) });
      await expect(stranger.acceptInvitation(hash(tokenFromEmail()))).rejects.toMatchObject({
        code: 'permission_denied',
      });
    });

    it('l’invité accepte et devient support ; il ne gère pas l’équipe', async () => {
      const invitee = staffTeamRepository({ client: await clientAs(INVITEE_EMAIL) });

      await expect(invitee.acceptInvitation(hash(tokenFromEmail()))).resolves.toBe('support');
      await expect(invitee.myStaffRole()).resolves.toBe('support');
      await expect(invitee.listMembers()).rejects.toMatchObject({ code: 'permission_denied' });
    });
  },
);
