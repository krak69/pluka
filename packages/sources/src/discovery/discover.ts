import type { Capture } from '../snapshot.js';
import { documentKindOf, extractPageOutline, isCourseDocument, type PageLink } from './links.js';
import { DISCOVERY_LIMITS, selectPagesToRead } from './pages.js';
import { parseRobots } from './robots.js';

/**
 * Inventaire d'un site officiel — SOURCES_EXTRACTION §11.1.
 *
 * Lit le site, borné, et dit ce qu'il contient : les pages lues et les
 * documents qu'elles lient. Rien n'est interprété et aucune IA n'intervient :
 * l'inventaire sert à proposer à l'administrateur les pages et documents à
 * analyser. C'est leur analyse, ensuite, qui passe par la chaîne d'extraction.
 *
 * Le réseau est injecté (`read`) : c'est le fetcher du worker, avec sa garde
 * SSRF à chaque saut, qui le porte. Ce module ne fait aucune requête lui-même.
 */

export const DISCOVERY_VERSION = 'discovery-2.0.0';

export type DiscoveryErrorCode = 'ROBOTS_DISALLOWED' | 'NOT_HTML';

export class DiscoveryError extends Error {
  constructor(readonly code: DiscoveryErrorCode) {
    super(code);
    this.name = 'DiscoveryError';
  }
}

export function isDiscoveryError(error: unknown): error is DiscoveryError {
  return error instanceof DiscoveryError;
}

export interface DiscoveryIO {
  /** Lecture d'une URL, garde SSRF comprise — le fetcher du worker. */
  readonly read: (url: string) => Promise<Capture>;
}

export interface InventoryPage {
  readonly url: string;
  readonly title: string | null;
  /** Page qui parle de course (épreuves, règlement, programme…) : proposée cochée. */
  readonly suggested: boolean;
}

export interface InventoryDocument {
  readonly url: string;
  readonly title: string;
  readonly kind: 'pdf' | 'gpx';
  readonly foundOn: string;
  /** Règlement, roadbook, guide… : proposé coché. Un indice de tri, jamais une décision. */
  readonly suggested: boolean;
}

export interface SiteInventory {
  readonly version: string;
  readonly siteUrl: string;
  readonly finalUrl: string;
  readonly siteTitle: string | null;
  readonly pages: readonly InventoryPage[];
  readonly documents: readonly InventoryDocument[];
}

export interface DiscoveryOutcome {
  readonly inventory: SiteInventory;
  readonly pagesRead: number;
  readonly pagesFailed: number;
}

const HTML_TYPES = /^(?:text\/html|application\/xhtml\+xml)\b/i;

function isHtml(capture: Capture): boolean {
  if (capture.contentType !== null) return HTML_TYPES.test(capture.contentType.trim());
  return /<(?:html|body)\b/i.test(new TextDecoder().decode(capture.bytes.slice(0, 2048)));
}

async function readRobots(io: DiscoveryIO, siteUrl: string): Promise<string | null> {
  try {
    const capture = await io.read(new URL('/robots.txt', siteUrl).toString());
    return new TextDecoder().decode(capture.bytes);
  } catch {
    // Absent, en erreur ou bloqué : la convention veut que rien ne soit interdit.
    return null;
  }
}

function documentsOf(
  pages: readonly { url: string; links: readonly PageLink[] }[],
): readonly InventoryDocument[] {
  const documents: InventoryDocument[] = [];
  const seen = new Set<string>();

  for (const page of pages) {
    for (const link of page.links) {
      const kind = documentKindOf(link.url);
      if (kind === null || seen.has(link.url)) continue;

      seen.add(link.url);
      const fileName = decodeURIComponent(new URL(link.url).pathname.split('/').pop() ?? '');
      const title = link.text || fileName;
      documents.push({
        url: link.url,
        title,
        kind,
        foundOn: page.url,
        suggested: isCourseDocument(link.url, title),
      });
    }
  }

  // Les documents de course d'abord, dans l'ordre du site : la borne coupe
  // les communiqués avant le règlement.
  return documents
    .map((document, index) => ({ document, index }))
    .sort(
      (left, right) =>
        Number(right.document.suggested) - Number(left.document.suggested) ||
        left.index - right.index,
    )
    .slice(0, DISCOVERY_LIMITS.maxDocuments)
    .map(({ document }) => document);
}

export async function discoverSite(io: DiscoveryIO, siteUrl: string): Promise<DiscoveryOutcome> {
  const robots = parseRobots(await readRobots(io, siteUrl));
  if (!robots.isAllowed(siteUrl)) throw new DiscoveryError('ROBOTS_DISALLOWED');

  // Les erreurs de la page saisie remontent telles quelles : sans elle, il
  // n'y a rien à inventorier, et le fetcher dit déjà pourquoi.
  const home = await io.read(siteUrl);
  if (!isHtml(home)) throw new DiscoveryError('NOT_HTML');
  const homeUrl = home.finalUrl ?? siteUrl;
  const homeOutline = extractPageOutline(new TextDecoder().decode(home.bytes), homeUrl);

  const read: { url: string; title: string | null; links: readonly PageLink[] }[] = [
    { url: homeUrl, title: homeOutline.title, links: homeOutline.links },
  ];
  let pagesFailed = 0;

  for (const url of selectPagesToRead(homeUrl, homeOutline.links, robots)) {
    try {
      const capture = await io.read(url);
      if (!isHtml(capture)) continue;
      const finalUrl = capture.finalUrl ?? url;
      // Deux liens peuvent mener à la même page après redirection : elle n'est lue qu'une fois.
      if (read.some((page) => page.url === finalUrl)) continue;

      const outline = extractPageOutline(new TextDecoder().decode(capture.bytes), finalUrl);
      read.push({ url: finalUrl, title: outline.title, links: outline.links });
    } catch {
      // Une page liée en erreur n'arrête pas l'inventaire : elle est comptée.
      pagesFailed += 1;
    }
  }

  return {
    inventory: {
      version: DISCOVERY_VERSION,
      siteUrl,
      finalUrl: homeUrl,
      siteTitle: homeOutline.title,
      pages: read.map((page, index) => ({
        url: page.url,
        title: page.title,
        // La page d'accueil d'office ; les autres si elles parlent de course.
        suggested: index === 0 || isCourseDocument(page.url, page.title ?? ''),
      })),
      documents: documentsOf(read),
    },
    pagesRead: read.length,
    pagesFailed,
  };
}
