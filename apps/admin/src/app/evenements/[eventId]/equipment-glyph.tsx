import type { Cell } from '@/app/evenements/[eventId]/equipment-grid-draft';

/**
 * Les pictos d'exigence du matériel, partagés par le tableau de l'événement et
 * la fiche épreuve. Ils montent en remplissage avec l'exigence : point (non
 * concernée), cercle (recommandé), demi-carré (conditionnel), carré coché
 * (obligatoire), carré pointillé « ? » (à préciser). La forme porte le sens,
 * la couleur le renforce ; le mot les accompagne toujours.
 *
 * Sans `'use client'` : un composant serveur les rend tels quels.
 */

export function RequirementGlyph({ value }: { readonly value: Cell }) {
  switch (value) {
    case 'mandatory':
      return (
        <svg className="ad-grid-glyph" viewBox="0 0 24 24" aria-hidden="true" data-glyph="mandatory">
          <rect x="3" y="3" width="18" height="18" rx="2" className="ad-grid-glyph-fill" />
          <path d="M7.5 12.5l3 3 6-7" className="ad-grid-glyph-mark" />
        </svg>
      );
    case 'conditional':
      return (
        <svg className="ad-grid-glyph" viewBox="0 0 24 24" aria-hidden="true" data-glyph="conditional">
          <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="2" className="ad-grid-glyph-frame" />
          <path d="M3.75 12h16.5v6.25a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2z" className="ad-grid-glyph-half" />
        </svg>
      );
    case 'unknown':
      return (
        <svg className="ad-grid-glyph" viewBox="0 0 24 24" aria-hidden="true" data-glyph="unknown">
          <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="2" className="ad-grid-glyph-dashed" />
          <path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.4M12 16.6v.1" className="ad-grid-glyph-question" />
        </svg>
      );
    case 'recommended':
      return (
        <svg className="ad-grid-glyph" viewBox="0 0 24 24" aria-hidden="true" data-glyph="recommended">
          <circle cx="12" cy="12" r="7.5" className="ad-grid-glyph-ring" />
        </svg>
      );
    default:
      return (
        <svg className="ad-grid-glyph" viewBox="0 0 24 24" aria-hidden="true" data-glyph="none">
          <circle cx="12" cy="12" r="2" className="ad-grid-glyph-dot" />
        </svg>
      );
  }
}

