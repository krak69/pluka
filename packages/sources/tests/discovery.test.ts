import { describe, expect, it } from 'vitest';

import {
  DISCOVERY_LIMITS,
  DiscoveryError,
  discoverSite,
  documentKindOf,
  isCourseDocument,
  extractPageOutline,
  isSameSite,
  parseRobots,
  selectPagesToRead,
  type Capture,
} from '../src/index.js';

/** Découverte d'un site officiel — SOURCES_EXTRACTION §11.1. */

const SITE = 'https://trail-des-cretes.example/';

function page(body: string, title = 'Trail des Crêtes 2027'): string {
  return `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
}

function capture(url: string, html: string, contentType = 'text/html; charset=utf-8'): Capture {
  return {
    bytes: new TextEncoder().encode(html),
    finalUrl: url,
    httpStatus: 200,
    contentType,
  };
}

/** Un site en mémoire : une URL absente répond comme un 404. */
function site(pages: Readonly<Record<string, string>>, calls: string[] = []) {
  return {
    calls,
    read(url: string): Promise<Capture> {
      calls.push(url);
      const html = pages[url];
      if (html === undefined) return Promise.reject(new Error('HTTP_ERROR 404'));
      if (url.endsWith('robots.txt')) return Promise.resolve(capture(url, html, 'text/plain'));
      return Promise.resolve(capture(url, html));
    },
  };
}

const HOME = page(`
  <nav>
    <a href="/courses">Les courses</a>
    <a href="/inscriptions">Inscriptions</a>
    <a href="https://www.trail-des-cretes.example/reglement">Règlement</a>
    <a href="https://facebook.example/tdc">Facebook</a>
    <a href="mailto:contact@trail-des-cretes.example">Contact</a>
    <a href="#haut">Haut</a>
  </nav>
  <h1>Trail des Crêtes</h1>
  <p>Rendez-vous à Gérardmer le 12 juin 2027.</p>
`);

const COURSES = page(`
  <h2>Le Grand Tour</h2><p>82 km et 4 200 m D+, départ 05:00 le 12 juin 2027.</p>
  <h2>La Crête</h2><p>45 km et 2 100 m D+.</p>
  <a href="/docs/reglement-2027.pdf">Règlement 2027 (PDF)</a>
  <a href="https://cdn.example/traces/grand-tour.gpx">Trace du Grand Tour</a>
`);

describe('liens et documents', () => {
  it('lit le titre et les liens http(s), absolus, sans doublon ni fragment', () => {
    const outline = extractPageOutline(HOME, SITE);

    expect(outline.title).toBe('Trail des Crêtes 2027');
    expect(outline.links.map((link) => link.url)).toEqual([
      'https://trail-des-cretes.example/courses',
      'https://trail-des-cretes.example/inscriptions',
      'https://www.trail-des-cretes.example/reglement',
      'https://facebook.example/tdc',
    ]);
  });

  it('reconnaît un document à son extension seulement', () => {
    expect(documentKindOf('https://a.example/x/Reglement.PDF')).toBe('pdf');
    expect(documentKindOf('https://a.example/trace.gpx?v=2')).toBe('gpx');
    expect(documentKindOf('https://a.example/reglement')).toBeNull();
  });

  it('décode les entités numériques des textes de lien', () => {
    const outline = extractPageOutline('<a href="/a">L&#x27;élite d&#39;abord &#233;</a>', SITE);
    expect(outline.links[0]?.text).toBe("L'élite d'abord é");
  });

  it('propose cochés les documents de course, pas les communiqués', () => {
    expect(isCourseDocument('https://a.example/docs/Roadbook-GT-2026.pdf', 'GRAND TRAIL')).toBe(
      true,
    );
    expect(isCourseDocument('https://a.example/reglement.pdf', 'Règlement')).toBe(true);
    expect(isCourseDocument('https://a.example/Guide_Integral_HD.pdf', 'Intégrale')).toBe(true);
    expect(isCourseDocument('https://a.example/CP-SAVE-THE-DATE.pdf', 'Save the date PDF')).toBe(
      false,
    );
  });

  it('tient www. pour le même site, un autre domaine non', () => {
    expect(isSameSite('https://www.trail-des-cretes.example/a', SITE)).toBe(true);
    expect(isSameSite('https://facebook.example/tdc', SITE)).toBe(false);
  });
});

describe('robots.txt', () => {
  it('applique la règle la plus longue, et les jokers', () => {
    const robots = parseRobots(
      ['User-agent: *', 'Disallow: /prive', 'Allow: /prive/public', 'Disallow: /*.pdf$'].join('\n'),
    );

    expect(robots.isAllowed('https://a.example/courses')).toBe(true);
    expect(robots.isAllowed('https://a.example/prive/x')).toBe(false);
    expect(robots.isAllowed('https://a.example/prive/public/x')).toBe(true);
    expect(robots.isAllowed('https://a.example/docs/r.pdf')).toBe(false);
  });

  it('préfère le groupe qui nous nomme au groupe générique', () => {
    const robots = parseRobots(
      ['User-agent: *', 'Disallow: /', '', 'User-agent: PLUKA', 'Allow: /'].join('\n'),
    );

    expect(robots.isAllowed('https://a.example/courses')).toBe(true);
  });

  it('n’interdit rien sans fichier', () => {
    expect(parseRobots(null).isAllowed('https://a.example/x')).toBe(true);
  });
});

describe('choix des pages', () => {
  it('reste sur le site, profondeur 1, et lit d’abord ce qui parle de course', () => {
    const links = [
      ...Array.from({ length: 20 }, (_, index) => ({
        url: `https://trail-des-cretes.example/actu-${index}`,
        text: `Actualité ${index}`,
      })),
      { url: 'https://trail-des-cretes.example/parcours', text: 'Le parcours' },
      { url: 'https://autre.example/courses', text: 'Courses' },
    ];

    const pages = selectPagesToRead(SITE, links, parseRobots(null));

    expect(pages).toHaveLength(DISCOVERY_LIMITS.maxPages - 1);
    expect(pages[0]).toBe('https://trail-des-cretes.example/parcours');
    expect(pages).not.toContain('https://autre.example/courses');
  });
});

describe('découverte', () => {
  const pages = {
    [SITE]: HOME,
    'https://trail-des-cretes.example/courses': COURSES,
    'https://www.trail-des-cretes.example/reglement': page('<p>Règlement complet.</p>'),
    'https://trail-des-cretes.example/robots.txt': 'User-agent: *\nDisallow: /inscriptions',
  };

  it('inventorie les pages lues et les documents liés, sans rien interpréter', async () => {
    const io = site(pages);
    const outcome = await discoverSite(io, SITE);

    expect(outcome.pagesRead).toBe(3);
    expect(outcome.inventory.siteTitle).toBe('Trail des Crêtes 2027');
    expect(outcome.inventory.pages).toEqual([
      { url: SITE, title: 'Trail des Crêtes 2027', suggested: true },
      {
        url: 'https://trail-des-cretes.example/courses',
        title: 'Trail des Crêtes 2027',
        suggested: true,
      },
      {
        url: 'https://www.trail-des-cretes.example/reglement',
        title: 'Trail des Crêtes 2027',
        suggested: true,
      },
    ]);
    expect(outcome.inventory.documents).toEqual([
      {
        url: 'https://trail-des-cretes.example/docs/reglement-2027.pdf',
        title: 'Règlement 2027 (PDF)',
        kind: 'pdf',
        foundOn: 'https://trail-des-cretes.example/courses',
        suggested: true,
      },
      {
        url: 'https://cdn.example/traces/grand-tour.gpx',
        title: 'Trace du Grand Tour',
        kind: 'gpx',
        foundOn: 'https://trail-des-cretes.example/courses',
        suggested: false,
      },
    ]);
    // robots.txt interdit /inscriptions, et un autre domaine n'est jamais lu.
    expect(io.calls).not.toContain('https://trail-des-cretes.example/inscriptions');
    expect(io.calls).not.toContain('https://facebook.example/tdc');
  });

  it('ne lit qu’une fois une page atteinte par deux liens', async () => {
    const io = {
      read(url: string): Promise<Capture> {
        if (url.endsWith('robots.txt')) return Promise.reject(new Error('404'));
        // `/` et `/fr/` mènent à la même page.
        const final = url === SITE || url.endsWith('/fr/') ? `${SITE}fr/` : url;
        return Promise.resolve(
          capture(final, page('<a href="/fr/">FR</a><a href="/courses">Courses</a>')),
        );
      },
    };

    const outcome = await discoverSite(io, SITE);
    expect(outcome.inventory.pages.map((entry) => entry.url)).toEqual([
      `${SITE}fr/`,
      'https://trail-des-cretes.example/courses',
    ]);
  });

  it('refuse un site dont robots.txt interdit la page saisie', async () => {
    const io = site({
      ...pages,
      'https://trail-des-cretes.example/robots.txt': 'User-agent: *\nDisallow: /',
    });

    await expect(discoverSite(io, SITE)).rejects.toEqual(new DiscoveryError('ROBOTS_DISALLOWED'));
  });
});
