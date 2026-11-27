'use client';

import { type ReactNode, useState } from 'react';

import { Icon } from '@/components/icon';

/**
 * Les calques du profil — prototype `profFilters` : « Parcours » toujours
 * affiché, « Nutrition » qui montre ou masque les prises posées sur la courbe.
 * Nutrition éteinte, la puce mène au bandeau qui l'active, juste dessous.
 * « Météo », sur le même modèle, n'existe qu'une fois les Conditions ouvertes.
 *
 * Seul l'affichage se décide ici : le profil et ses points arrivent tracés du
 * serveur, et masquer les prises ne change rien à la stratégie.
 */
export function ProfileLayers({
  title,
  nutrition,
  weather = false,
  children,
}: {
  readonly title: ReactNode;
  /** `toggle` : des prises sont posées ; `activate` : la Nutrition n'est pas activée. */
  readonly nutrition: 'toggle' | 'activate' | null;
  /** Des pictos météo sont posés sur le profil. */
  readonly weather?: boolean;
  readonly children: ReactNode;
}) {
  const [shown, setShown] = useState(true);
  const [weatherShown, setWeatherShown] = useState(true);

  return (
    <div
      className="pl-layers"
      data-nutrition={nutrition === 'toggle' && shown ? 'on' : 'off'}
      data-weather={weather && weatherShown ? 'on' : 'off'}
    >
      <div className="pl-profile-head">
        {title}
        {nutrition === null && !weather ? null : (
          <div className="pl-layer-chips" role="group" aria-label="Afficher sur le profil">
            <span className="pl-layer-chip pl-layer-fixed">
              <Icon name="Check" size={12} />
              Parcours
            </span>
            {nutrition === null ? null : nutrition === 'toggle' ? (
              <button
                type="button"
                className="pl-layer-chip"
                aria-pressed={shown}
                onClick={() => setShown((current) => !current)}
              >
                <Icon name={shown ? 'Check' : 'Minus'} size={12} />
                Nutrition
              </button>
            ) : (
              <a href="#nutrition" className="pl-layer-chip">
                <Icon name="Plus" size={12} />
                Nutrition
              </a>
            )}
            {weather ? (
              <button
                type="button"
                className="pl-layer-chip"
                aria-pressed={weatherShown}
                onClick={() => setWeatherShown((current) => !current)}
              >
                <Icon name={weatherShown ? 'Check' : 'Minus'} size={12} />
                Météo
              </button>
            ) : null}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
