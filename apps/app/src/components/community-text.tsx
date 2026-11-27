import type { ReactNode } from 'react';

import {
  parseCommunityText,
  type CommunityBlock,
  type CommunityInline,
} from '@/lib/community-text';

/**
 * Un message de la Communauté, mis en forme. Aucun HTML venu du message n'est
 * injecté : l'arbre de `parseCommunityText` devient des éléments React, qui
 * échappent leur texte.
 *
 * Un lien sort du produit : il s'ouvre dans un nouvel onglet, sans transmettre
 * l'adresse de la page (`noreferrer`), marqué contenu d'utilisateur pour les
 * moteurs (`ugc nofollow`), et son domaine est écrit à côté quand le texte ne
 * le dit pas déjà — on sait où l'on va avant de cliquer.
 */

function textOf(inlines: readonly CommunityInline[]): string {
  return inlines
    .map((inline) =>
      inline.kind === 'text'
        ? inline.text
        : inline.kind === 'break'
          ? ' '
          : 'children' in inline
            ? textOf(inline.children)
            : '',
    )
    .join('');
}

function renderInlines(inlines: readonly CommunityInline[], keyPrefix: string): ReactNode[] {
  return inlines.map((inline, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (inline.kind) {
      case 'text':
        return inline.text;
      case 'break':
        return <br key={key} />;
      case 'bold':
        return <strong key={key}>{renderInlines(inline.children, key)}</strong>;
      case 'italic':
        return <em key={key}>{renderInlines(inline.children, key)}</em>;
      case 'link': {
        const host = new URL(inline.href).hostname.replace(/^www\./u, '');
        const label = textOf(inline.children);
        return (
          <span key={key} className="cm-link">
            <a href={inline.href} target="_blank" rel="nofollow ugc noopener noreferrer">
              {renderInlines(inline.children, key)}
              <span className="pk-visually-hidden"> (nouvel onglet)</span>
            </a>
            {label.includes(host) ? null : <span className="cm-link-host">{` · ${host}`}</span>}
          </span>
        );
      }
    }
  });
}

function renderBlocks(blocks: readonly CommunityBlock[], keyPrefix: string): ReactNode[] {
  return blocks.map((block, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (block.kind) {
      case 'paragraph':
        return <p key={key}>{renderInlines(block.inlines, key)}</p>;
      case 'list': {
        const items = block.items.map((item, position) => (
          <li key={`${key}-${position}`}>{renderInlines(item, `${key}-${position}`)}</li>
        ));
        return block.ordered ? (
          <ol key={key} start={block.start === 1 ? undefined : block.start}>
            {items}
          </ol>
        ) : (
          <ul key={key}>{items}</ul>
        );
      }
      case 'quote':
        return <blockquote key={key}>{renderBlocks(block.blocks, key)}</blockquote>;
    }
  });
}

export function CommunityText({ text }: { readonly text: string }) {
  return <div className="cm-body">{renderBlocks(parseCommunityText(text), 'b')}</div>;
}
