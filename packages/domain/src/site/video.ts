/**
 * La vidéo d'un site — EVENT_SITE §3.10.
 *
 * On garde un fournisseur et un identifiant, jamais une adresse ni un code
 * d'intégration collé par l'organisateur : le lecteur est construit ici, sur
 * deux hôtes connus, déclarés dans la politique de sécurité du site.
 */

export interface SiteVideo {
  readonly provider: 'youtube' | 'vimeo';
  readonly id: string;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/u;
const VIMEO_ID = /^\d{1,20}$/u;
const YOUTUBE_PATH = /^\/(?:embed|shorts|live)\/([^/]+)\/?$/u;
const VIMEO_PATH = /^\/(?:video\/)?(\d+)\/?$/u;

function youtubeId(url: URL): string | null {
  if (url.hostname === 'youtu.be') return url.pathname.slice(1);
  if (url.pathname === '/watch') return url.searchParams.get('v');
  return YOUTUBE_PATH.exec(url.pathname)?.[1] ?? null;
}

/** Nul : ce n'est pas l'adresse d'une vidéo YouTube ou Vimeo. */
export function parseSiteVideoUrl(value: string): SiteVideo | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  const host = url.hostname.replace(/^www\.|^m\./u, '');

  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'youtu.be') {
    const id = youtubeId(url);
    return id !== null && YOUTUBE_ID.test(id) ? { provider: 'youtube', id } : null;
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = VIMEO_PATH.exec(url.pathname)?.[1] ?? null;
    return id !== null && VIMEO_ID.test(id) ? { provider: 'vimeo', id } : null;
  }

  return null;
}

/** L'adresse à montrer dans l'éditeur. */
export function siteVideoUrl(video: SiteVideo): string {
  return video.provider === 'youtube'
    ? `https://www.youtube.com/watch?v=${video.id}`
    : `https://vimeo.com/${video.id}`;
}

/** Le lecteur, sans cookie de suivi quand le fournisseur le permet. */
export function siteVideoPlayerUrl(video: SiteVideo): string {
  return video.provider === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1`
    : `https://player.vimeo.com/video/${video.id}?autoplay=1&dnt=1`;
}
