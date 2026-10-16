/**
 * L'adresse d'un site d'événement — EVENT_SITE §7.1.
 *
 * Un site vit sur `{eventSlug}.{domaine racine}`. Ces règles sont pures : le
 * proxy de l'app les applique à chaque requête, avant toute lecture en base.
 */

/**
 * Adresses techniques de PLUKA. Même liste que
 * `private.is_reserved_subdomain` (migration 0049) : un test la confronte au
 * SQL, pour qu'elles ne divergent pas en silence.
 */
export const RESERVED_SUBDOMAINS: readonly string[] = [
  'app', 'www', 'admin', 'api', 'auth', 'mail', 'email', 'smtp', 'imap', 'pop', 'ftp',
  'status', 'static', 'cdn', 'assets', 'media', 'img', 'storage', 'files', 'docs', 'help',
  'support', 'blog', 'news', 'm', 'mobile', 'dev', 'staging', 'preview', 'beta', 'demo',
  'sandbox', 'pluka', 'site', 'sites', 'org', 'orga', 'organisateurs', 'organizers',
  'studio', 'dashboard', 'console', 'account', 'login', 'connexion', 'billing', 'pay',
  'ns1', 'ns2', 'mx', 'autodiscover', 'webmail', 'supabase', 'vercel', 'brief',
];

const RESERVED = new Set(RESERVED_SUBDOMAINS);

/** Une étiquette DNS valide, sans préfixe `xn--` : ce que doit être un slug pour servir d'adresse. */
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export function isReservedSubdomain(label: string): boolean {
  return RESERVED.has(label.toLowerCase());
}

export function isSiteSubdomain(label: string): boolean {
  return DNS_LABEL.test(label) && label.slice(2, 4) !== '--' && !isReservedSubdomain(label);
}

/**
 * Le domaine racine des sites, déduit de l'adresse de l'app : `app.pluka.run`
 * donne `pluka.run`, `localhost:3001` donne `localhost`. Une seule variable
 * d'environnement dit donc où vivent l'app et les sites.
 */
export function siteRootDomain(appUrl: string): string {
  const hostname = new URL(appUrl).hostname.toLowerCase();
  return hostname.startsWith('app.') ? hostname.slice(4) : hostname;
}

/**
 * Le slug d'événement que désigne un en-tête `Host`, ou `null` si l'hôte
 * n'est pas celui d'un site : l'app elle-même, une adresse réservée, un
 * domaine étranger, ou plus d'un niveau sous la racine.
 */
export function siteSlugFromHost(host: string | null, rootDomain: string): string | null {
  if (host === null) return null;

  const hostname = host.toLowerCase().replace(/:\d+$/u, '').replace(/\.$/u, '');
  const suffix = `.${rootDomain.toLowerCase()}`;
  if (!hostname.endsWith(suffix)) return null;

  const label = hostname.slice(0, -suffix.length);
  if (label.includes('.')) return null;

  return isSiteSubdomain(label) ? label : null;
}

/** L'adresse publique d'un site, sur le même protocole et le même port que l'app. */
export function siteUrl(slug: string, appUrl: string): string {
  const app = new URL(appUrl);
  const port = app.port === '' ? '' : `:${app.port}`;
  return `${app.protocol}//${slug}.${siteRootDomain(appUrl)}${port}`;
}
