import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/team', () => ({ sessionTeamContext: vi.fn() }));

import { organizerPath } from '@/lib/organizer-link';

/** 05_ROUTES_FLOWS §8 : le lien vers l'espace organisateur n'existe que pour ses membres. */
describe('le lien vers l’espace organisateur', () => {
  it('n’existe pas pour un coureur sans organisation', () => {
    expect(organizerPath([])).toBeNull();
  });

  it('va droit à l’organisation quand il n’y en a qu’une', () => {
    expect(organizerPath(['a'])).toBe('/org/a');
  });

  it('passe par la liste quand il y en a plusieurs', () => {
    expect(organizerPath(['a', 'b'])).toBe('/org');
  });
});
