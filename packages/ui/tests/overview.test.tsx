import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ActionList, ActivityFeed, Checklist, StatTiles } from '../src/index.js';

/**
 * Briques d'accueil de course. Elles ne décident rien : elles disent l'état
 * reçu, en mots — jamais par la seule couleur (§44).
 */

describe('ActionList', () => {
  it('une ligne par point, libellée, avec son geste', () => {
    const markup = renderToStaticMarkup(
      <ActionList
        items={[{ key: 'a', title: 'Publier', detail: 'Pourquoi', action: <button>Go</button> }]}
      />,
    );

    expect(markup).toContain('aria-label="À faire, 1"');
    expect(markup).toContain('Publier');
    expect(markup).toContain('<button>Go</button>');
  });

  it('vide : rien n’est rendu', () => {
    expect(renderToStaticMarkup(<ActionList items={[]} />)).toBe('');
  });
});

describe('Checklist', () => {
  const markup = renderToStaticMarkup(
    <Checklist
      title="Préparation"
      items={[
        { key: 'a', label: 'Épreuves', state: 'done' },
        { key: 'b', label: 'GPX', state: 'todo', detail: '1 sur 2' },
        { key: 'c', label: 'Revue', state: 'unknown' },
      ]}
    />,
  );

  it('compte ce qui est fait, sans pourcentage', () => {
    expect(markup).toContain('1 sur 3');
    expect(markup).not.toContain('%');
  });

  it('dit chaque état en mots, pas seulement par l’icône', () => {
    expect(markup).toContain('— fait');
    expect(markup).toContain('— à faire');
    expect(markup).toContain('— inconnu');
  });
});

describe('StatTiles et ActivityFeed', () => {
  it('une tuile signale en mots ce qui est à reprendre', () => {
    const markup = renderToStaticMarkup(
      <StatTiles
        tiles={[{ key: 's', label: 'Sources', value: '6', meta: '2 en erreur', due: true }]}
      />,
    );
    expect(markup).toContain('pk-tile-meta-due');
    expect(markup).toContain('2 en erreur');
  });

  it('un flux vide se dit', () => {
    expect(
      renderToStaticMarkup(<ActivityFeed title="Activité" items={[]} empty="Rien encore." />),
    ).toContain('Rien encore.');
  });
});
