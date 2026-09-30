'use client';

import { MinusIcon, PlusIcon } from '@phosphor-icons/react/ssr';
import { useId, useState } from 'react';

/**
 * Accordéon de questions fréquentes.
 *
 * Client Component : l'entrée ouverte est un état. Le prototype ouvre la
 * première au chargement et n'en laisse qu'une ouverte à la fois — les deux
 * comportements sont conservés, y compris la refermeture de l'entrée active.
 *
 * Le contenu n'est jamais rendu puis masqué en CSS : une réponse fermée est
 * absente du document, comme dans le prototype. `aria-controls` et
 * `aria-expanded` relient le bouton à sa réponse pour la synthèse vocale.
 */

export type FaqEntry = { readonly q: string; readonly a: string };

export function FaqList({
  entries,
  compact = false,
}: {
  readonly entries: readonly FaqEntry[];
  /** La page Organisateurs pose ses questions en 17 px, la homepage en 17,5 px. */
  readonly compact?: boolean;
}) {
  const [openIndex, setOpenIndex] = useState(0);
  const baseId = useId();

  return (
    <div className="lp-stack">
      {entries.map((entry, index) => {
        const open = openIndex === index;
        const panelId = `${baseId}-${String(index)}`;
        const Chevron = open ? MinusIcon : PlusIcon;

        return (
          <div key={entry.q} className="lp-faq-item">
            <button
              type="button"
              className="lp-faq-button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpenIndex(open ? -1 : index)}
            >
              <h3 className={compact ? 'lp-faq-q lp-faq-q-org' : 'lp-faq-q'}>{entry.q}</h3>
              <Chevron size={19} className="lp-faq-icon" />
            </button>

            {open ? (
              <p id={panelId} className="lp-faq-a">
                {entry.a}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
