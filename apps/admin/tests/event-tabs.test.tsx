import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EventTabs } from '@/app/evenements/[eventId]/event-tabs';

/**
 * Les onglets d'un événement : vue d'ensemble, matériel, documents. L'onglet
 * courant est annoncé, et une pastille dit ce qui attend ailleurs.
 */

describe('onglets d’un événement', () => {
  it('trois onglets, le courant annoncé comme la page', () => {
    const html = renderToStaticMarkup(<EventTabs eventId="event-1" current="materiel" />);

    expect(html).toContain('href="/evenements/event-1"');
    expect(html).toContain('href="/evenements/event-1/materiel"');
    expect(html).toContain('href="/evenements/event-1/documents"');
    const currentTab = html.match(/<a [^>]*aria-current="page"[^>]*>/)?.[0] ?? '';
    expect(currentTab).toContain('href="/evenements/event-1/materiel"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('une pastille pour les propositions à relire et les documents en erreur, jamais à zéro', () => {
    const html = renderToStaticMarkup(
      <EventTabs eventId="event-1" current="overview" equipmentPending={3} documentsDue={0} />,
    );

    expect(html).toContain('3<span class="pk-visually-hidden"> propositions à relire</span>');
    expect(html).not.toContain('documents en erreur');
  });

  it('garde l’édition affichée d’un onglet à l’autre', () => {
    const html = renderToStaticMarkup(
      <EventTabs eventId="event-1" current="documents" editionId="edition-2025" />,
    );

    expect(html).toContain('href="/evenements/event-1/materiel?edition=edition-2025"');
    expect(html).toContain('href="/evenements/event-1/documents?edition=edition-2025"');
    // La vue d'ensemble suit toujours l'édition la plus récente.
    expect(html).toContain('href="/evenements/event-1"');
  });
});
