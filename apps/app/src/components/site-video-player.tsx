'use client';

import { useState } from 'react';

/**
 * La vidéo d'un site — EVENT_SITE §3.10.
 *
 * Le lecteur ne se charge qu'au clic : tant que le visiteur n'a pas demandé la
 * lecture, aucun tiers ne reçoit sa visite. Aucune vignette non plus, pour la
 * même raison : elle viendrait des serveurs du fournisseur.
 */
export function SiteVideoPlayer({
  playerUrl,
  providerName,
  title,
}: {
  readonly playerUrl: string;
  readonly providerName: string;
  readonly title: string;
}) {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <div className="es-video">
        <iframe
          src={playerUrl}
          title={title}
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );
  }

  return (
    <div className="es-video es-video-idle">
      <button type="button" className="es-cta" onClick={() => setPlaying(true)}>
        Lire la vidéo
      </button>
      <p>La lecture charge le lecteur de {providerName}.</p>
    </div>
  );
}
