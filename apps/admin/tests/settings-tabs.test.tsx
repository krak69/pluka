import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SettingsHeader, firstSettingsTab } from '@/app/parametres/tabs';

/** Paramètres — les onglets suivent le rôle ; le journal y vit (2026-10-07). */

describe('onglets de Paramètres', () => {
  it('montre l’équipe et le journal au super-admin', () => {
    const markup = renderToStaticMarkup(
      <SettingsHeader current="/parametres/equipe" staffRole="super_admin" />,
    );

    expect(markup).toContain('href="/parametres/equipe"');
    expect(markup).toContain('href="/parametres/journal"');
  });

  it('ne montre que le journal à un admin ou à un support', () => {
    for (const role of ['admin', 'support'] as const) {
      const markup = renderToStaticMarkup(
        <SettingsHeader current="/parametres/journal" staffRole={role} />,
      );

      expect(markup, role).toContain('href="/parametres/journal"');
      expect(markup, role).not.toContain('href="/parametres/equipe"');
    }
  });

  it('ouvre /parametres sur le premier onglet permis', () => {
    expect(firstSettingsTab('super_admin')).toBe('/parametres/equipe');
    expect(firstSettingsTab('admin')).toBe('/parametres/journal');
    expect(firstSettingsTab('support')).toBe('/parametres/journal');
    expect(firstSettingsTab(null)).toBe('/parametres/journal');
  });
});
