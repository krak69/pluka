'use client';

import { useState } from 'react';

import type { MilestoneLine, SectionLine } from '@/lib/nutrition-format';

/**
 * Les vues de la Nutrition sur le Plan — prototype `nutViews` : « Ma
 * stratégie » (les prises, dans l'ordre) et « Par section » (d'un ravito au
 * suivant, ce qui se consomme et ce qu'il faut emporter). Les libellés
 * arrivent prêts du serveur : rien ne se calcule ici.
 */

type View = 'strategie' | 'section';

export function NutritionViews({
  milestones,
  sections,
}: {
  readonly milestones: readonly MilestoneLine[];
  readonly sections: readonly SectionLine[];
}) {
  const [view, setView] = useState<View>('strategie');

  return (
    <div className="nu-views">
      <div className="nu-tabs" role="tablist" aria-label="Vues de la nutrition">
        {(
          [
            ['strategie', 'Ma stratégie'],
            ['section', 'Par section'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={view === value}
            className="nu-tab"
            onClick={() => setView(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'strategie' ? (
        <ol className="nu-milestones">
          {milestones.map((line) => (
            <li
              key={line.key}
              className={line.official ? 'nu-milestone nu-milestone-aid' : 'nu-milestone'}
            >
              <span className="nu-milestone-when">
                <span className="nu-milestone-clock">{line.clock}</span>
                <span className="nu-meta">{line.km}</span>
              </span>
              <span className="nu-milestone-what">
                <span className="nu-milestone-name">{line.name}</span>
                <span className="nu-reason">{line.reason}</span>
                {line.items.length === 0 ? null : (
                  <span className="nu-items">{line.items.join(' + ')}</span>
                )}
              </span>
              <span className="nu-milestone-need">{line.need}</span>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="nu-sections">
          {sections.map((line) => (
            <li key={line.key} className="nu-section">
              <details>
                <summary className="nu-section-summary">
                  <span className="nu-section-name">{line.name}</span>
                  <span className="nu-meta">{line.meta}</span>
                  {line.status === 'low' || line.status === 'high' ? (
                    <span
                      className={line.status === 'low' ? 'nu-status nu-status-low' : 'nu-status'}
                    >
                      {line.status === 'low' ? 'À compléter' : 'Au-dessus de la cible'}
                    </span>
                  ) : null}
                </summary>
                <div className="nu-section-body">
                  <div>
                    <span className="pk-label">Besoins</span>
                    <p className="nu-section-line">{line.needs}</p>
                  </div>
                  {line.coverage === null ? null : (
                    <div>
                      <span className="pk-label">Couverture</span>
                      <p className="nu-section-line">{line.coverage}</p>
                    </div>
                  )}
                  <div>
                    <span className="pk-label">À emporter</span>
                    <p className="nu-section-line">{line.carry}</p>
                  </div>
                  {line.prises.length === 0 ? null : (
                    <div>
                      <span className="pk-label">Prises</span>
                      <ul className="nu-section-prises">
                        {line.prises.map((prise) => (
                          <li key={prise}>{prise}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
