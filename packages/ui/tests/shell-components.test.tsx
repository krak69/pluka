import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EmptyState, NavItem, NavList, NavTabs, SectionHeader } from '../src/index.js';

/**
 * Primitives du shell — 06_DESIGN_SYSTEM.md §66 à §70, §83.
 *
 * Comme pour les autres primitives, ce qui est protégé n'est pas l'apparence
 * mais les règles que le composant doit porter lui-même : un libellé toujours
 * présent, un état actif annoncé autrement que par la couleur, une cible
 * atteignable.
 */

describe('EmptyState', () => {
  it('rend les trois temps de §83', () => {
    const html = renderToStaticMarkup(
      <EmptyState
        label="Assistance"
        title="Aucun point d’assistance."
        detail="Les tables existent, aucun service ne les lit."
        action={<button type="button">Choisir un point</button>}
      >
        Ton accompagnant saura où être et à quelle heure.
      </EmptyState>,
    );

    expect(html).toContain('Aucun point d’assistance.');
    expect(html).toContain('Ton accompagnant saura où être');
    expect(html).toContain('aucun service ne les lit');
    expect(html).toContain('Choisir un point');
  });

  it('n’impose ni action ni détail', () => {
    // §83 : une fonctionnalité non branchée n'offre aucune action, et en
    // inventer une mentirait sur ce qui est disponible.
    const html = renderToStaticMarkup(
      <EmptyState title="Rien pour l’instant.">Cet écran se remplira.</EmptyState>,
    );

    expect(html).not.toContain('pk-empty-action');
    expect(html).not.toContain('pk-empty-detail');
  });

  it('porte le titre dans un heading', () => {
    // Un état vide est le contenu principal de sa zone : il doit apparaître
    // dans le plan du document, pas comme un paragraphe gras.
    expect(
      renderToStaticMarkup(<EmptyState title="Aucune sortie.">Rien encore.</EmptyState>),
    ).toContain('<h2');
  });

  it('n’ajoute aucune illustration', () => {
    // §83 : « Pas d'illustration décorative obligatoire. » Le composant n'en
    // fabrique aucune.
    const html = renderToStaticMarkup(<EmptyState title="Vide.">Rien.</EmptyState>);

    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<img');
  });
});

describe('NavItem', () => {
  it('porte toujours son libellé', () => {
    // §1869 : « Pas d'icônes seules pour les destinations principales. »
    const html = renderToStaticMarkup(
      <NavItem href="/plan" icon={<span>·</span>}>
        Plan
      </NavItem>,
    );

    expect(html).toContain('Plan');
    expect(html).toContain('pk-nav-item-label');
  });

  it('annonce l’état actif autrement que par la couleur', () => {
    // §103 : la couleur ne porte jamais seule le sens.
    const html = renderToStaticMarkup(
      <NavItem href="/" current>
        Accueil
      </NavItem>,
    );

    expect(html).toContain('aria-current="page"');
    expect(html).toContain('pk-nav-item-current');
  });

  it('marque explicitement l’inactif', () => {
    const html = renderToStaticMarkup(<NavItem href="/saison">Ma saison</NavItem>);

    expect(html).toContain('aria-current="false"');
    expect(html).not.toContain('pk-nav-item-current');
  });

  it('masque l’icône à la synthèse vocale', () => {
    const html = renderToStaticMarkup(
      <NavItem href="/" icon={<span>·</span>}>
        Accueil
      </NavItem>,
    );

    expect(html).toContain('aria-hidden="true"');
  });

  it('n’affiche pas un compteur vide', () => {
    // Un « 0 » à côté d'une destination est du bruit.
    expect(
      renderToStaticMarkup(
        <NavItem href="/" badge={0}>
          Accueil
        </NavItem>,
      ),
    ).not.toContain('pk-nav-item-badge');
    expect(
      renderToStaticMarkup(
        <NavItem href="/" badge={3}>
          Communauté
        </NavItem>,
      ),
    ).toContain('pk-nav-item-badge');
  });
});

describe('NavList', () => {
  it('nomme le groupe pour l’arbre d’accessibilité', () => {
    const html = renderToStaticMarkup(
      <NavList label="Ma course">
        <NavItem href="/plan">Plan</NavItem>
      </NavList>,
    );

    expect(html).toContain('aria-label="Ma course"');
    expect(html).toContain('<nav');
  });

  it('garde le nom accessible même masqué visuellement', () => {
    const html = renderToStaticMarkup(
      <NavList label="Ma saison" hideLabel>
        <NavItem href="/">Accueil</NavItem>
      </NavList>,
    );

    expect(html).toContain('aria-label="Ma saison"');
    expect(html).not.toContain('pk-nav-group-label');
  });
});

describe('NavTabs', () => {
  it('rend des liens, pas des boutons', () => {
    // `05_ROUTES_FLOWS.md` §1.2 : chaque onglet est une route.
    const html = renderToStaticMarkup(
      <NavTabs
        label="Sections"
        tabs={[
          { href: '/preparation/materiel', label: 'Matériel', current: true },
          { href: '/preparation/sacs', label: 'Sacs' },
        ]}
      />,
    );

    expect(html).toContain('href="/preparation/materiel"');
    expect(html).not.toContain('<button');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('pk-tab-current');
  });

  it('n’impose pas de capitales', () => {
    // §15 : la hiérarchie se fait par la taille et l'espace. Le libellé sort
    // tel qu'il est écrit.
    expect(
      renderToStaticMarkup(<NavTabs label="Sections" tabs={[{ href: '/a', label: 'Sacs' }]} />),
    ).toContain('>Sacs<');
  });
});

describe('SectionHeader', () => {
  it('rend un h1 par défaut', () => {
    const html = renderToStaticMarkup(<SectionHeader eyebrow="Ma course" title="Plan" />);

    expect(html).toContain('<h1');
    expect(html).toContain('pk-h1');
    expect(html).toContain('Ma course');
  });

  it('descend en h2 pour une section interne', () => {
    const html = renderToStaticMarkup(<SectionHeader title="Points de passage" level={2} />);

    expect(html).toContain('<h2');
    expect(html).toContain('pk-h2');
  });

  it('n’émet pas de micro-label vide', () => {
    expect(renderToStaticMarkup(<SectionHeader title="Plan" />)).not.toContain('pk-label');
  });
});
