import { siteVideoPlayerUrl } from '@pluka/domain';
import { notFound } from 'next/navigation';

import { SiteVideoPlayer } from '@/components/site-video-player';
import { loadEventSite, siteAssetUrl } from '@/lib/event-site';

/**
 * La galerie d'un site : une vidéo et douze photos au plus — EVENT_SITE §3.10.
 *
 * Une page sans contenu n'existe pas : le menu ne la propose pas non plus.
 */
export const metadata = { title: 'Galerie' };

const PROVIDER_NAMES = { youtube: 'YouTube', vimeo: 'Vimeo' } as const;

export default async function SiteGalleryPage({
  params,
}: {
  readonly params: Promise<{ readonly siteSlug: string }>;
}) {
  const site = await loadEventSite((await params).siteSlug);
  if (site.gallery.length === 0 && site.video === null) notFound();

  return (
    <div className="es-section-white">
      <header className="es-wrap es-page-head">
        <h1 className="es-page-title">Galerie</h1>
      </header>
      <div className="es-wrap es-gallery-page">
        {site.video === null ? null : (
          <SiteVideoPlayer
            playerUrl={siteVideoPlayerUrl(site.video)}
            providerName={PROVIDER_NAMES[site.video.provider]}
            title={`Vidéo — ${site.event.name}`}
          />
        )}
        {site.gallery.length === 0 ? null : (
          <ul className="es-gallery">
            {site.gallery.map((photo, index) => (
              <li key={photo.path}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={siteAssetUrl(photo.path) ?? ''}
                  alt={photo.alt ?? `${site.event.name}, photo ${String(index + 1)}`}
                  loading="lazy"
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
