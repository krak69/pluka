import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { EventOrganizationForm } from '@/app/evenements/[eventId]/event-organization-form';

vi.mock('@/app/console-actions', () => ({
  changeEventOrganizationAction: async () => ({}),
}));

/**
 * Changer l'organisation d'un événement — 0044. Le formulaire part de
 * l'organisation actuelle, propose de détacher, et ne s'active pas tant que
 * rien n'est choisi d'autre. La garde super-admin est en base (pgTAP 30).
 */

const ORGANIZATIONS = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Org A' },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Org B' },
];

describe('changer l’organisation', () => {
  const markup = renderToStaticMarkup(
    <EventOrganizationForm
      eventId="e"
      currentOrganizationId="aaaaaaaa-0000-4000-8000-000000000001"
      organizations={ORGANIZATIONS}
    />,
  );

  it('part de l’organisation actuelle, et propose de détacher', () => {
    expect(markup).toContain(
      '<option value="aaaaaaaa-0000-4000-8000-000000000001" selected="">Org A</option>',
    );
    expect(markup).toContain('<option value="">Aucune — maintenu par PLUKA</option>');
    expect(markup).toContain('name="eventId" value="e"');
  });

  it('rien de choisi d’autre : ni confirmation, ni bouton actif', () => {
    expect(markup).not.toContain('name="confirmed"');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Changer l’organisation/);
  });

  it('un événement sans organisation part de « Aucune »', () => {
    const detached = renderToStaticMarkup(
      <EventOrganizationForm
        eventId="e"
        currentOrganizationId={null}
        organizations={ORGANIZATIONS}
      />,
    );
    expect(detached).toContain('<option value="" selected="">Aucune — maintenu par PLUKA</option>');
  });
});
