import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DomainError,
  RESERVED_SUBDOMAINS,
  accentContrastIssue,
  accentInk,
  contrastRatio,
  findPublicEventSite,
  registrationUrlOf,
  siteRootDomain,
  siteSlugFromHost,
  siteUrl,
  type EventSiteContext,
} from '../src/index.js';

/**
 * Le site de l'événement — EVENT_SITE §4, §5, §7.
 *
 * L'adresse se lit dans l'hôte avant toute requête en base ; l'identité ne
 * passe que si elle reste lisible ; la charge publique est validée à
 * l'entrée, et rien d'autre ne sort qu'elle.
 */

describe('l’adresse d’un site', () => {
  it('déduit le domaine racine de l’adresse de l’app', () => {
    expect(siteRootDomain('https://app.pluka.run')).toBe('pluka.run');
    expect(siteRootDomain('http://localhost:3001')).toBe('localhost');
  });

  it('lit le slug d’un sous-domaine, port et casse compris', () => {
    expect(siteSlugFromHost('trail-de-test.pluka.run', 'pluka.run')).toBe('trail-de-test');
    expect(siteSlugFromHost('Trail-De-Test.localhost:3001', 'localhost')).toBe('trail-de-test');
  });

  it('ne prend ni l’app, ni une adresse réservée, ni un domaine étranger', () => {
    expect(siteSlugFromHost('app.pluka.run', 'pluka.run')).toBeNull();
    expect(siteSlugFromHost('admin.pluka.run', 'pluka.run')).toBeNull();
    expect(siteSlugFromHost('pluka.run', 'pluka.run')).toBeNull();
    expect(siteSlugFromHost('localhost:3001', 'localhost')).toBeNull();
    expect(siteSlugFromHost('trail.evil.test', 'pluka.run')).toBeNull();
    expect(siteSlugFromHost('trail.pluka.run.evil.test', 'pluka.run')).toBeNull();
    expect(siteSlugFromHost(null, 'pluka.run')).toBeNull();
  });

  it('ne descend pas de deux niveaux, et refuse ce qui n’est pas une étiquette DNS', () => {
    expect(siteSlugFromHost('a.b.pluka.run', 'pluka.run')).toBeNull();
    expect(siteSlugFromHost('-trail.pluka.run', 'pluka.run')).toBeNull();
    expect(siteSlugFromHost('xn--trail.pluka.run', 'pluka.run')).toBeNull();
    expect(siteSlugFromHost('trail_test.pluka.run', 'pluka.run')).toBeNull();
  });

  it('compose l’adresse sur le protocole et le port de l’app', () => {
    expect(siteUrl('trail-de-test', 'https://app.pluka.run')).toBe(
      'https://trail-de-test.pluka.run',
    );
    expect(siteUrl('trail-de-test', 'http://localhost:3001')).toBe(
      'http://trail-de-test.localhost:3001',
    );
  });

  it('réserve les mêmes adresses que la base', () => {
    const migration = readFileSync(
      fileURLToPath(new URL('../../../supabase/migrations/0049_event_site.sql', import.meta.url)),
      'utf8',
    );
    const block = /is_reserved_subdomain\(p_slug text\)[\s\S]*?array\[([\s\S]*?)\]/u.exec(
      migration,
    );
    const sql = [...(block?.[1] ?? '').matchAll(/'([a-z0-9-]+)'/gu)].map((match) => match[1]);

    expect(sql.length).toBeGreaterThan(0);
    expect([...sql].sort()).toEqual([...RESERVED_SUBDOMAINS].sort());
  });
});

describe('l’accent', () => {
  it('mesure le contraste comme WCAG', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it('pose le texte le plus lisible sur l’accent', () => {
    expect(accentInk('#b8322a')).toBe('#ffffff');
    expect(accentInk('#c6f24e')).toBe('#0e1a17');
  });

  it('accepte un accent lisible, refuse celui qui disparaît sur le fond', () => {
    expect(accentContrastIssue('#b8322a')).toBeNull();
    expect(accentContrastIssue('#0f6e6e')).toBeNull();
    // Un jaune pâle porte bien un texte Ardoise, mais ne se détache pas du Calcaire.
    expect(accentContrastIssue('#f5e663')).toMatchObject({ kind: 'accent_on_background' });
  });
});

const EVENT_ID = 'aaaaaaaa-0000-4000-8000-000000000011';
const EDITION_ID = 'aaaaaaaa-0000-4000-8000-000000000012';
const RACE_ID = 'aaaaaaaa-0000-4000-8000-000000000013';

function payload(overrides: Record<string, unknown> = {}) {
  return {
    event: {
      id: EVENT_ID,
      name: 'Trail de Test',
      slug: 'trail-de-test',
      description: null,
      city: null,
      countryCode: 'FR',
    },
    appearance: { accentColor: '#b8322a', headingFont: 'oswald', logoPath: null, coverPath: null },
    hasContact: true,
    sections: [{ title: 'Hébergement', body: 'Gîte du col.' }],
    edition: {
      id: EDITION_ID,
      year: 2026,
      slug: 'trail-de-test-2026',
      startDate: '2026-06-20',
      endDate: null,
      status: 'published',
      registrationUrl: 'https://inscriptions.example/edition',
    },
    races: [
      {
        id: RACE_ID,
        slug: '80k',
        name: '80K',
        distanceKm: 80,
        elevationGainM: null,
        startDatetime: '2026-06-20T04:00:00+00:00',
        timezone: 'Europe/Paris',
        startLocationName: null,
        registrationUrl: null,
      },
    ],
    notices: [],
    partners: [],
    documents: [],
    ...overrides,
  };
}

function contextReturning(value: unknown, seen: string[] = []): EventSiteContext {
  return {
    repositories: {
      eventSites: {
        findPublicBySlug: (slug: string) => {
          seen.push(slug);
          return Promise.resolve(value);
        },
      },
    },
  };
}

describe('le site en ligne', () => {
  it('rend la charge validée, et lit l’hôte en minuscules', async () => {
    const seen: string[] = [];
    const found = await findPublicEventSite(contextReturning(payload(), seen), {
      slug: 'Trail-De-Test',
    });

    expect(seen).toEqual(['trail-de-test']);
    expect(found.kind).toBe('site');
    if (found.kind === 'site') expect(found.site.races.map((race) => race.name)).toEqual(['80K']);
  });

  it('ne dit pas pourquoi rien n’est en ligne', async () => {
    await expect(
      findPublicEventSite(contextReturning(null), { slug: 'trail-de-test' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('suit un ancien slug', async () => {
    await expect(
      findPublicEventSite(contextReturning({ redirectTo: 'trail-de-test-v2' }), {
        slug: 'trail-de-test',
      }),
    ).resolves.toEqual({ kind: 'redirect', slug: 'trail-de-test-v2' });
  });

  it('refuse une adresse qui n’est pas un slug avant toute lecture', async () => {
    const seen: string[] = [];
    await expect(
      findPublicEventSite(contextReturning(payload(), seen), { slug: 'a b' }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(seen).toEqual([]);
  });

  it('ne laisse pas passer une charge d’une autre forme', async () => {
    await expect(
      findPublicEventSite(contextReturning(payload({ appearance: { accentColor: 'red' } })), {
        slug: 'trail-de-test',
      }),
    ).rejects.toThrow('charge du site illisible');
  });
});

describe('le lien d’inscription', () => {
  const edition = payload().edition;

  it('prend celui de l’épreuve, sinon celui de l’édition, sinon aucun', () => {
    expect(
      registrationUrlOf({ registrationUrl: 'https://inscriptions.example/80k' }, edition),
    ).toBe('https://inscriptions.example/80k');
    expect(registrationUrlOf({ registrationUrl: null }, edition)).toBe(
      'https://inscriptions.example/edition',
    );
    expect(
      registrationUrlOf({ registrationUrl: null }, { ...edition, registrationUrl: null }),
    ).toBeNull();
    expect(registrationUrlOf({ registrationUrl: null }, null)).toBeNull();
  });
});
