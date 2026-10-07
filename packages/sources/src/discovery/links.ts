/**
 * Liens d'une page — SOURCES_EXTRACTION §11.1.
 *
 * Le parseur de §15 écarte la navigation, l'en-tête et le pied de page : c'est
 * juste pour extraire des faits, et c'est exactement là que vivent les liens
 * qui mènent aux épreuves et au règlement. La découverte lit donc les liens à
 * part, sur le HTML brut, sans rien interpréter d'autre que `href`.
 *
 * Aucun lien n'est suivi ici : ce module dit ce qui est lié, `pages.ts` choisit
 * ce qui sera lu, et chaque lecture repasse par la garde SSRF du fetcher.
 */

export type DocumentKind = 'pdf' | 'gpx';

export interface PageLink {
  /** URL absolue, sans fragment. */
  readonly url: string;
  /** Texte du lien, espaces normalisés ; vide si le lien n'en a pas. */
  readonly text: string;
}

export interface PageOutline {
  readonly title: string | null;
  readonly links: readonly PageLink[];
}

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
};

function decode(value: string): string {
  return (
    value
      .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (entity) => ENTITIES[entity] ?? entity)
      // Références numériques : décodées en texte, jamais en balise.
      .replace(/&#(\d{1,7});/g, (_, code: string) => codePoint(Number(code)))
      .replace(/&#x([0-9a-fA-F]{1,6});/g, (_, code: string) => codePoint(Number.parseInt(code, 16)))
  );
}

function codePoint(code: number): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

function clean(value: string): string {
  return decode(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Résout un `href` contre la page ; rend `null` pour tout ce qui n'est pas http(s). */
export function resolveLink(href: string, baseUrl: string): string | null {
  const trimmed = decode(href.trim());
  if (trimmed === '' || trimmed.startsWith('#')) return null;

  let url: URL;
  try {
    url = new URL(trimmed, baseUrl);
  } catch {
    return null;
  }

  // `mailto:`, `tel:`, `javascript:` : jamais des pages, jamais suivis.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url.hash = '';
  return url.toString();
}

export function extractPageOutline(html: string, baseUrl: string): PageOutline {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch?.[1] === undefined ? null : clean(titleMatch[1]) || null;

  const links: PageLink[] = [];
  const seen = new Set<string>();
  const pattern = /<a\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const attributes = match[1] ?? '';
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes);
    const raw = href?.[1] ?? href?.[2] ?? href?.[3];
    if (raw === undefined) continue;

    const url = resolveLink(raw, baseUrl);
    if (url === null || seen.has(url)) continue;

    seen.add(url);
    links.push({ url, text: clean(match[2] ?? '').slice(0, 200) });
  }

  return { title, links };
}

/**
 * Mots qui désignent un document de préparation : règlement, roadbook, guide
 * coureur, programme, parcours, matériel. Ils ne décident de rien — un
 * communiqué de presse reste listé — mais seuls ces documents sont proposés
 * cochés : chacun est une analyse de plus.
 */
const COURSE_DOCUMENT_WORDS =
  /\b(?:reglement|rules|roadbook|road book|guide|programme|program|parcours|courses?|materiel|equipement|equipment|barrieres?|horaires|ravitaillements?|briefing|infos?|informations?)\b/;

export function isCourseDocument(url: string, title: string): boolean {
  const haystack = `${url} ${title}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[_./-]+/g, ' ');
  return COURSE_DOCUMENT_WORDS.test(haystack);
}

/** Un document de course se reconnaît à son extension, et à rien d'autre. */
export function documentKindOf(url: string): DocumentKind | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return null;
  }

  if (pathname.endsWith('.pdf')) return 'pdf';
  if (pathname.endsWith('.gpx')) return 'gpx';
  return null;
}

/** Hôte comparable : `www.` n'est pas un autre site. */
export function siteHostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function isSameSite(url: string, siteUrl: string): boolean {
  const host = siteHostOf(url);
  return host !== null && host === siteHostOf(siteUrl);
}
