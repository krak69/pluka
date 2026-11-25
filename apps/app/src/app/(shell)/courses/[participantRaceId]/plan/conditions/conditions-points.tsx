'use client';

import { useState } from 'react';

import { Icon } from '@/components/icon';
import type { ConditionsPointLine } from '@/lib/conditions-format';

/**
 * « Point par point · selon ton plan » — prototype `wxPoints` et
 * `wxSelected`. La liste des points de passage, et la fiche du point choisi :
 * ciel, température, ressenti, précipitations, vent et rafales. Tout arrive
 * mis en forme du serveur ; rien ne se calcule ici.
 */
export function ConditionsPoints({ points }: { readonly points: readonly ConditionsPointLine[] }) {
  const [selectedKey, setSelectedKey] = useState(points[0]?.key ?? null);
  const selected = points.find((point) => point.key === selectedKey) ?? points[0];

  return (
    <div className="cd-grid">
      <section className="cd-list" aria-labelledby="cd-list-title">
        <h2 id="cd-list-title" className="pk-label cd-list-title">
          Point par point · selon ton plan
        </h2>
        <ul className="cd-rows">
          {points.map((point) => (
            <li key={point.key}>
              <button
                type="button"
                className="cd-row"
                aria-pressed={point.key === selected?.key}
                onClick={() => setSelectedKey(point.key)}
              >
                <span className="pk-data cd-row-eta">{point.eta}</span>
                <span className="cd-row-mark" aria-hidden="true" />
                <span className="cd-row-place">
                  <span className="cd-row-name">{point.name}</span>
                  <span className="pk-data cd-row-meta">{point.meta}</span>
                </span>
                <span className="cd-row-weather">
                  <span className="cd-row-temp">
                    {point.icon === null ? null : (
                      <span className="cd-row-icon" aria-hidden="true">
                        <Icon name={point.icon} size={17} />
                      </span>
                    )}
                    <span className="pk-data">{point.temperature}</span>
                  </span>
                  <span className="pk-data cd-row-meta">{point.feelsLike}</span>
                  <span className="pk-data cd-row-meta">{point.gust}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {selected === undefined ? null : (
        <section className="cd-selected" aria-live="polite">
          <p className="pk-label cd-on-dark-muted">Point de passage</p>
          <h2 className="cd-selected-name">{selected.name}</h2>
          <p className="pk-data cd-on-dark-muted">{selected.meta}</p>
          <p className="pk-data cd-selected-eta">passage prévu {selected.passage}</p>
          <div className="cd-selected-temp">
            {selected.icon === null ? null : (
              <span className="cd-selected-icon" aria-hidden="true">
                <Icon name={selected.icon} size={26} />
              </span>
            )}
            <span className="pk-data">{selected.temperature}</span>
          </div>
          <p className="cd-selected-sky">
            {selected.sky === '—' ? selected.feelsLike : `${selected.sky} · ${selected.feelsLike}`}
          </p>
          <div className="cd-selected-facts">
            <div>
              <p className="pk-label cd-on-dark-muted">Précipitations</p>
              <p className="pk-data cd-selected-value">{selected.rain}</p>
              {selected.rainAmount === null ? null : (
                <p className="pk-data cd-on-dark-muted">{selected.rainAmount}</p>
              )}
            </div>
            <div>
              <p className="pk-label cd-on-dark-muted">
                Vent{selected.windFrom === null ? '' : ` ${selected.windFrom}`}
              </p>
              <p className="pk-data cd-selected-value">{selected.wind}</p>
              <p className="pk-data cd-on-dark-muted">{selected.gust}</p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
