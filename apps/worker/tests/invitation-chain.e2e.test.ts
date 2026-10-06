import { createHash } from 'node:crypto';

import type { EmailMessage, EmailProvider, EmailSendResult } from '@pluka/contracts';
import { organizationTeamRepository, type PlukaClient } from '@pluka/db';
import { createServerClient, createServiceRoleClient } from '@pluka/db/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handleInvitationMessage } from '../src/jobs/organization-invitation-send.js';
import { createPorts } from '../src/ports-supabase.js';
import type { QueueMessage, WorkerPorts } from '../src/ports.js';

/**
 * Invitation d'équipe, de bout en bout contre la base locale — migration 0033.
 *
 *   owner invite → outbox → job → jeton tiré → hash en base → email
 *   → aperçu anonyme → connexion de l'invité → acceptation → membre
 *
 * Le fournisseur email est simulé, tout le reste est réel : les gardes SQL
 * relisent de vrais jetons de session, et le jeton de l'email est le seul
 * moyen d'entrer.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const PASSWORD = 'pluka-test-2026!';

const SUFFIX = Date.now().toString(36);
const ORG_ID = 'ddddeeee-0000-4000-8000-0000000000e1';
const OWNER_EMAIL = `owner-${SUFFIX}@invitation.test`;
const INVITEE_EMAIL = `invitee-${SUFFIX}@invitation.test`;
const STRANGER_EMAIL = `stranger-${SUFFIX}@invitation.test`;

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

type AuthClient = {
  auth: {
    admin: {
      createUser(input: {
        email: string;
        password: string;
        email_confirm: boolean;
      }): Promise<{ data: { user: { id: string } | null } }>;
      deleteUser(id: string): Promise<unknown>;
    };
    signInWithPassword(input: {
      email: string;
      password: string;
    }): Promise<{ data: { session: { access_token: string } | null } }>;
  };
};

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

/** Un client au nom de la personne : les gardes SQL relisent son jeton. */
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

function hash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function jobFor(invitationId: string): QueueMessage {
  return { msgId: 0, readCount: 1, payload: { invitationId } };
}

/** Le jeton, tel qu'il figure dans le lien de l'email reçu par l'invité. */
function tokenFromEmail(): string {
  const message = sent.find((candidate) => candidate.to[0]?.address === INVITEE_EMAIL);
  const match = /\/invitation-equipe\/([A-Za-z0-9_-]{43})/.exec(message?.textBody ?? '');
  return match?.[1] ?? '';
}

beforeAll(async () => {
  available = await reachable();
  if (!available) return;

  service = createServiceRoleClient({ url: SUPABASE_URL, secretKey: SERVICE_KEY });
  ports = { ...createPorts(service, { appUrl: 'http://localhost:3001' }), email: fakeEmail };

  await service.from('organizations').delete().eq('id', ORG_ID);
  await service
    .from('organizations')
    .insert({ id: ORG_ID, name: 'Org Invitation', slug: `org-invitation-${SUFFIX}` });

  const ownerId = await createUser(OWNER_EMAIL);
  await createUser(INVITEE_EMAIL);
  await createUser(STRANGER_EMAIL);

  await service
    .from('organization_members')
    .insert({ organization_id: ORG_ID, user_id: ownerId, role: 'owner' });
}, 60000);

afterAll(async () => {
  if (!available) return;

  await service.from('organizations').delete().eq('id', ORG_ID);
  for (const id of userIds) {
    await (service as unknown as AuthClient).auth.admin.deleteUser(id);
  }
}, 60000);

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)(
  'invitation d’équipe, de bout en bout',
  () => {
    let invitationId = '';

    it('l’owner invite ; le job tire le jeton et l’email porte le seul lien valide', async () => {
      const owner = organizationTeamRepository({ client: await clientAs(OWNER_EMAIL) });

      invitationId = await owner.invite({
        organizationId: ORG_ID,
        email: INVITEE_EMAIL,
        role: 'editor',
      });

      await expect(handleInvitationMessage(ports, jobFor(invitationId))).resolves.toEqual({
        kind: 'sent',
        invitationId,
      });

      const token = tokenFromEmail();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const { data } = await service
        .from('organization_invitations')
        .select('token_hash, status')
        .eq('id', invitationId)
        .single();

      // La base n'a que le hash, jamais le jeton.
      expect(data).toEqual({ token_hash: hash(token), status: 'sent' });
    });

    it('un message rejoué n’envoie pas un second email', async () => {
      const before = sent.length;

      await expect(handleInvitationMessage(ports, jobFor(invitationId))).resolves.toMatchObject({
        kind: 'already_done',
      });
      expect(sent.length).toBe(before);
    });

    it('l’aperçu anonyme donne l’organisation et le rôle', async () => {
      const anonymous = organizationTeamRepository({
        client: createServerClient({ url: SUPABASE_URL, publishableKey: ANON_KEY }),
      });

      await expect(anonymous.previewInvitation(hash(tokenFromEmail()))).resolves.toEqual({
        state: 'valid',
        organizationName: 'Org Invitation',
        role: 'editor',
      });
    });

    it('un autre compte, même avec le lien, est refusé', async () => {
      const stranger = organizationTeamRepository({ client: await clientAs(STRANGER_EMAIL) });

      await expect(stranger.acceptInvitation(hash(tokenFromEmail()))).rejects.toMatchObject({
        code: 'permission_denied',
      });
    });

    it('l’invité accepte, et l’owner le voit dans l’équipe avec son rôle', async () => {
      const invitee = organizationTeamRepository({ client: await clientAs(INVITEE_EMAIL) });

      await expect(invitee.acceptInvitation(hash(tokenFromEmail()))).resolves.toBe(ORG_ID);

      const owner = organizationTeamRepository({ client: await clientAs(OWNER_EMAIL) });
      const members = await owner.listMembers(ORG_ID);

      expect(members.map((member) => [member.email, member.role])).toEqual([
        [OWNER_EMAIL, 'owner'],
        [INVITEE_EMAIL, 'editor'],
      ]);
      await expect(owner.listInvitations(ORG_ID)).resolves.toEqual([]);
    });

    it('le nouvel éditeur n’a pas la main sur l’équipe', async () => {
      const invitee = organizationTeamRepository({ client: await clientAs(INVITEE_EMAIL) });

      await expect(invitee.listMembers(ORG_ID)).rejects.toMatchObject({
        code: 'permission_denied',
      });
    });
  },
);
