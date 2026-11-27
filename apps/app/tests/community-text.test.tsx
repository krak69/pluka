import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CommunityText } from '@/components/community-text';
import {
  parseCommunityText,
  safeHref,
  serializeCommunityDoc,
  type CommunityBlock,
  type EditorNode,
} from '@/lib/community-text';

/**
 * Mise en forme de la Communauté — décision produit du 2026-11-27 : gras,
 * italique, listes, citations, liens https. Du texte en base, jamais du HTML ;
 * ce que la lecture ne reconnaît pas reste du texte.
 */

const text = (value: string) => ({ kind: 'text', text: value }) as const;
const paragraph = (...inlines: unknown[]) => ({ kind: 'paragraph', inlines }) as const;

function doc(...content: EditorNode[]): EditorNode {
  return { type: 'doc', content };
}
function p(...content: EditorNode[]): EditorNode {
  return { type: 'paragraph', content };
}
function t(
  value: string,
  ...marks: { readonly type: string; readonly attrs?: Readonly<Record<string, unknown>> }[]
): EditorNode {
  return marks.length === 0 ? { type: 'text', text: value } : { type: 'text', text: value, marks };
}
const bold = { type: 'bold' };
const italic = { type: 'italic' };
const link = (href: string) => ({ type: 'link', attrs: { href } });
function list(type: 'bulletList' | 'orderedList', ...items: EditorNode[][]): EditorNode {
  return { type, content: items.map((content) => ({ type: 'listItem', content })) };
}

describe('lecture', () => {
  it('un texte sans mise en forme garde ses paragraphes et ses retours à la ligne', () => {
    expect(parseCommunityText('Je finis vers 15 h.\nUne navette ?\n\nMerci')).toEqual([
      paragraph(text('Je finis vers 15 h.'), { kind: 'break' }, text('Une navette ?')),
      paragraph(text('Merci')),
    ]);
  });

  it('gras, italique, et un caractère échappé reste littéral', () => {
    expect(parseCommunityText('**Bâtons** _dès_ le départ \\*pas gras\\*')).toEqual([
      paragraph(
        { kind: 'bold', children: [text('Bâtons')] },
        text(' '),
        { kind: 'italic', children: [text('dès')] },
        text(' le départ *pas gras*'),
      ),
    ]);
  });

  it('un délimiteur sans fermeture reste du texte', () => {
    expect(parseCommunityText('3 ** 2 et snake_case')).toEqual([
      paragraph(text('3 ** 2 et snake_case')),
    ]);
  });

  it('listes à puces et numérotées, avec leur numéro de départ et un prolongement', () => {
    expect(
      parseCommunityText('- frontale\n- veste\n  imperméable\n\n3. Lenk\n4. Adelboden'),
    ).toEqual([
      {
        kind: 'list',
        ordered: false,
        start: 1,
        items: [[text('frontale')], [text('veste'), { kind: 'break' }, text('imperméable')]],
      },
      { kind: 'list', ordered: true, start: 3, items: [[text('Lenk')], [text('Adelboden')]] },
    ]);
  });

  it('une citation contient des blocs, mais pas d’autre citation', () => {
    const blocks = parseCommunityText('> Règlement, art. 12\n>\n> > pas imbriquée');
    expect(blocks).toEqual([
      {
        kind: 'quote',
        blocks: [paragraph(text('Règlement, art. 12')), paragraph(text('> pas imbriquée'))],
      },
    ]);
  });

  it('un lien https devient un lien ; tout autre protocole reste du texte inerte', () => {
    expect(parseCommunityText('[Règlement](https://www.clochers.fr/reglement.pdf)')).toEqual([
      paragraph({
        kind: 'link',
        href: 'https://www.clochers.fr/reglement.pdf',
        children: [text('Règlement')],
      }),
    ]);
    for (const url of [
      'javascript:alert(1)',
      'http://clochers.fr',
      'data:text/html;base64,PHNjcmlwdD4=',
      'https://user:pass@clochers.fr',
    ]) {
      const [block] = parseCommunityText(`[ici](${url})`) as CommunityBlock[];
      expect(JSON.stringify(block)).not.toContain('"link"');
      expect(block).toEqual(paragraph(text(`ici (${url})`)));
    }
  });

  it('safeHref n’accepte que https vers un hôte nommé', () => {
    expect(safeHref('https://clochers.fr/a b')).toBe('https://clochers.fr/a%20b');
    expect(safeHref('HTTPS://Clochers.fr')).toBe('https://clochers.fr/');
    expect(safeHref('//clochers.fr')).toBeNull();
    expect(safeHref('mailto:x@y.fr')).toBeNull();
  });
});

describe('affichage', () => {
  it('n’injecte jamais de HTML venu du message', () => {
    const markup = renderToStaticMarkup(
      <CommunityText text={'<script>alert(1)</script> **<img src=x onerror=alert(1)>**'} />,
    );
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('<img');
    expect(markup).toContain('&lt;script&gt;');
  });

  it('un lien s’ouvre à part, sans référent, marqué contenu d’utilisateur, avec son domaine', () => {
    const markup = renderToStaticMarkup(
      <CommunityText text={'[Le règlement](https://www.clochers.fr/reglement.pdf)'} />,
    );
    expect(markup).toContain('href="https://www.clochers.fr/reglement.pdf"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="nofollow ugc noopener noreferrer"');
    expect(markup).toContain('(nouvel onglet)');
    expect(markup).toContain('· clochers.fr');
  });

  it('ne répète pas le domaine quand le texte du lien le dit déjà', () => {
    const markup = renderToStaticMarkup(
      <CommunityText text={'[https://clochers.fr/navette](https://clochers.fr/navette)'} />,
    );
    expect(markup).not.toContain('cm-link-host');
  });

  it('listes, liste numérotée à partir de 3, citation', () => {
    const markup = renderToStaticMarkup(<CommunityText text={'- a\n- b\n\n3. c\n\n> cité'} />);
    expect(markup).toContain('<ul><li>a</li><li>b</li></ul>');
    expect(markup).toContain('<ol start="3"><li>c</li></ol>');
    expect(markup).toContain('<blockquote><p>cité</p></blockquote>');
  });
});

describe('écriture depuis l’éditeur', () => {
  it('paragraphes, saut de ligne, gras, italique, lien', () => {
    const markdown = serializeCommunityDoc(
      doc(
        p(t('Je finis vers '), t('15 h', bold), { type: 'hardBreak' }, t('vraiment', italic)),
        p(
          t('Voir '),
          t('le ', link('https://clochers.fr/navette')),
          t('plan', bold, link('https://clochers.fr/navette')),
        ),
      ),
    );
    expect(markdown).toBe(
      'Je finis vers **15 h**\n_vraiment_\n\nVoir [le **plan**](https://clochers.fr/navette)',
    );
  });

  it('un lien non https perd son lien et garde son texte', () => {
    expect(serializeCommunityDoc(doc(p(t('clic', link('javascript:alert(1)')))))).toBe('clic');
  });

  it('listes aplaties, paragraphes vides omis, citation', () => {
    const markdown = serializeCommunityDoc(
      doc(
        list(
          'bulletList',
          [p(t('frontale'))],
          [p(t('veste')), list('bulletList', [p(t('imbriquée'))])],
        ),
        p(),
        {
          type: 'orderedList',
          attrs: { start: 2 },
          content: [{ type: 'listItem', content: [p(t('Lenk'))] }],
        },
        { type: 'blockquote', content: [p(t('art. 12')), p(t('suite'))] },
      ),
    );
    expect(markdown).toBe('- frontale\n- veste\n- imbriquée\n\n2. Lenk\n\n> art. 12\n>\n> suite');
  });

  it('ce que le coureur tape comme du texte se relit comme du texte', () => {
    const tricky = [
      '- pas une liste',
      '> pas une citation',
      '12. pas numéroté',
      '**pas gras** et _pas italique_',
      '[pas](https://un.lien) \\ ni échappé',
      'snake_case_name et 3 * 4',
    ];
    for (const line of tricky) {
      const blocks = parseCommunityText(serializeCommunityDoc(doc(p(t(line)))));
      expect(blocks).toEqual([paragraph(text(line))]);
    }
  });

  it('écrire puis relire rend le même document', () => {
    const source = doc(
      p(t('Navette', bold), t(' toutes les '), t('30 min', italic)),
      list('orderedList', [p(t('Départ'))], [p(t('Arrivée'), { type: 'hardBreak' }, t('parking'))]),
      {
        type: 'blockquote',
        content: [p(t('Source : '), t('guide', link('https://clochers.fr/guide')))],
      },
    );
    expect(parseCommunityText(serializeCommunityDoc(source))).toEqual([
      paragraph({ kind: 'bold', children: [text('Navette')] }, text(' toutes les '), {
        kind: 'italic',
        children: [text('30 min')],
      }),
      {
        kind: 'list',
        ordered: true,
        start: 1,
        items: [[text('Départ')], [text('Arrivée'), { kind: 'break' }, text('parking')]],
      },
      {
        kind: 'quote',
        blocks: [
          paragraph(text('Source : '), {
            kind: 'link',
            href: 'https://clochers.fr/guide',
            children: [text('guide')],
          }),
        ],
      },
    ]);
  });
});
