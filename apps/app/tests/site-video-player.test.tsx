import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SiteVideoPlayer } from '@/components/site-video-player';

/** EVENT_SITE §14 : aucun tiers n'est appelé avant le clic sur la vidéo. */
describe('le lecteur vidéo du site', () => {
  it('ne charge rien du fournisseur avant le clic', () => {
    const html = renderToStaticMarkup(
      <SiteVideoPlayer
        playerUrl="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1"
        providerName="YouTube"
        title="Vidéo"
      />,
    );

    expect(html).toContain('Lire la vidéo');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('youtube-nocookie');
  });
});
