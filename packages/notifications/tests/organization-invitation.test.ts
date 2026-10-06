import type { EmailMessage, EmailProvider } from '@pluka/contracts';
import { describe, expect, it } from 'vitest';

import {
  INVITATION_TEMPLATE_VERSION,
  NotificationError,
  ORGANIZATION_ROLES,
  renderOrganizationInvitation,
  roleLabel,
  sendOrganizationInvitation,
  type OrganizationInvitationNotice,
} from '../src/index.js';

const NOTICE: OrganizationInvitationNotice = {
  recipientEmail: 'marie@trail.fr',
  organizationName: 'Trail du Lac',
  role: 'editor',
  inviterName: 'Jean Dupont',
  expiresAt: '2026-10-13T08:00:00.000Z',
  acceptUrl: 'http://localhost:3001/invitation-equipe/abc',
};

function recordingProvider() {
  const sent: EmailMessage[] = [];
  const provider: EmailProvider = {
    name: 'test',
    send: (message) => {
      sent.push(message);
      return Promise.resolve({ providerMessageId: 'm-1', acceptedAt: '2026-10-06T08:00:00Z' });
    },
  };
  return { provider, sent };
}

describe('gabarit d’invitation d’équipe', () => {
  it('dit qui invite, où, avec quel rôle, jusqu’à quand, et donne le lien', () => {
    const { subject, textBody } = renderOrganizationInvitation(NOTICE);

    expect(subject).toBe('Invitation à rejoindre Trail du Lac sur PLUKA');
    expect(textBody).toContain('Jean Dupont vous invite');
    expect(textBody).toContain('Éditeur');
    expect(textBody).toContain('13 octobre 2026');
    expect(textBody).toContain(NOTICE.acceptUrl);
  });

  it('sans nom d’inviteur, reste correct', () => {
    expect(renderOrganizationInvitation({ ...NOTICE, inviterName: null }).textBody).toContain(
      'Vous êtes invité',
    );
  });

  it('nomme chacun des quatre rôles', () => {
    for (const role of ORGANIZATION_ROLES) {
      expect(roleLabel(role)).not.toBe(role);
    }
  });
});

describe('envoi de l’invitation', () => {
  it('un seul destinataire, l’adresse invitée, avec la clé d’idempotence', async () => {
    const { provider, sent } = recordingProvider();

    const result = await sendOrganizationInvitation(provider, {
      notice: NOTICE,
      idempotencyKey: 'org-invitation:i-1:1',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual([{ address: 'marie@trail.fr' }]);
    expect(sent[0]?.idempotencyKey).toBe('org-invitation:i-1:1');
    expect(result.templateVersion).toBe(INVITATION_TEMPLATE_VERSION);
  });

  it('une adresse inexploitable est un échec définitif, sans appel', async () => {
    const { provider, sent } = recordingProvider();

    const error = await sendOrganizationInvitation(provider, {
      notice: { ...NOTICE, recipientEmail: 'pas-une-adresse' },
      idempotencyKey: 'k',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotificationError);
    expect((error as NotificationError).permanent).toBe(true);
    expect(sent).toEqual([]);
  });
});
