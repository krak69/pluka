import type { PublishedRaceFactRecord } from '@pluka/db';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { RaceFacts } from '@/components/race-facts';

/**
 * Le matériel côté coureur — migration 0045, SOURCES_EXTRACTION §82 : un
 * « recommandé » ne se lit jamais comme « obligatoire », et une exigence que
 * la source ne précise pas reste dite comme telle.
 */

function equipment(
  valueText: string,
  valueJson: PublishedRaceFactRecord['valueJson'],
): PublishedRaceFactRecord {
  return {
    factId: valueText,
    raceId: 'race',
    category: 'equipment',
    factKey: `equipment.${valueText.toLowerCase()}`,
    versionId: 'v',
    versionNumber: 1,
    valueText,
    valueNumber: null,
    unit: null,
    valueJson,
    trustLevel: 'official',
    publishedAt: '2026-10-08T10:00:00Z',
    source: null,
  };
}

const MARKUP = renderToStaticMarkup(
  <RaceFacts
    facts={[
      equipment('Frontale', {
        requirement: 'mandatory',
        condition: null,
        detail: 'Piles de rechange',
      }),
      equipment('Gants', {
        requirement: 'conditional',
        condition: 'Si température < 5 °C',
        detail: null,
      }),
      equipment('Bâtons', { requirement: 'recommended', condition: null, detail: null }),
      equipment('Sifflet', null),
    ]}
    cutoffs={[]}
    waypoints={[]}
    timezone="Europe/Paris"
  />,
);

describe('matériel lu par le coureur', () => {
  it('la catégorie ne prétend plus que tout est obligatoire', () => {
    expect(MARKUP).not.toContain('Matériel obligatoire');
  });

  it('chaque élément dit son exigence, la condition et la précision', () => {
    expect(MARKUP).toMatch(/Frontale[\s\S]*Obligatoire[\s\S]*Piles de rechange/);
    expect(MARKUP).toMatch(/Gants[\s\S]*Conditionnel<\/strong> — Si température &lt; 5 °C/);
    expect(MARKUP).toMatch(/Bâtons[\s\S]*Recommandé/);
  });

  it('sans exigence connue, il le dit au lieu de supposer', () => {
    expect(MARKUP).toMatch(/Sifflet[\s\S]*Exigence non précisée par la source/);
  });

  it('nomme l’élément, pas sa clé technique', () => {
    expect(MARKUP).not.toContain('equipment.frontale');
  });
});
