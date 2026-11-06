import { describe, expect, it } from 'vitest';

import {
  MAX_ATTENTION_ITEMS,
  eventSiteChecklist,
  organizerAttention,
  type EventSiteEditor,
} from '../src/index.js';

/**
 * L'accueil organisateur — 00_PRODUCT_SPEC §26.
 *
 * Quatre sujets au plus, À faire d'abord, et aucune alerte par observation.
 */

const COMPLETE_SITE = {
  eventId: 'e',
  status: 'published',
  accentColor: null,
  headingFont: null,
  logoPath: 'e/logo.webp',
  coverPath: 'e/cover.webp',
  contactEmail: 'courses@trail.test',
  publishedAt: '2026-01-01T00:00:00Z',
  presentation: 'Une course de village.',
  venue: null,
  links: {
    results: null,
    live: null,
    volunteers: null,
    newsletter: null,
    facebook: null,
    instagram: null,
    strava: null,
  },
  video: null,
} satisfies NonNullable<EventSiteEditor['site']>;

function editor(overrides: Partial<EventSiteEditor> = {}): EventSiteEditor {
  return {
    organizationName: 'Org',
    permissions: { role: 'owner', canEdit: true, canPublish: true },
    events: [],
    event: { id: 'e', name: 'Trail', slug: 'trail', status: 'published' },
    site: COMPLETE_SITE,
    sections: [{ title: 'Douches', body: 'Au gymnase.', moment: 'after', topicKey: 'showers' }],
    figures: [],
    gallery: [{ id: 'p', path: 'e/p.webp', alt: null }],
    program: [],
    edition: {
      id: 'ed',
      year: 2026,
      slug: '2026',
      startDate: '2026-06-20',
      endDate: null,
      status: 'published',
      registrationUrl: 'https://inscriptions.example',
    },
    races: [],
    documents: [],
    blockers: [],
    ...overrides,
  };
}

const keys = (input: EventSiteEditor, today = '2026-06-01') =>
  organizerAttention(input, null, today).map((item) => item.key);

describe('l’accueil organisateur', () => {
  it('site complet et en ligne : rien à faire, seulement ce qu’il faut savoir', () => {
    const items = organizerAttention(editor(), null, '2026-06-01');

    expect(items.map((item) => item.kind)).toEqual(['know', 'know']);
    expect(items[1]?.text).toBe('Dans 19 jours.');
  });

  it('réunit les manques du site en un seul sujet, qui ouvre le premier', () => {
    const items = organizerAttention(
      editor({ site: { ...COMPLETE_SITE, presentation: null, contactEmail: null } }),
      null,
      '2026-06-01',
    );

    expect(items.filter((item) => item.key === 'complete')).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'todo',
      text: 'Il manque : présentation, adresse de contact.',
      action: { target: { screen: 'site', tab: 'presentation' } },
    });
  });

  it('classe À faire, À vérifier, À savoir, et s’arrête à quatre sujets', () => {
    const items = organizerAttention(
      editor({ site: { ...COMPLETE_SITE, status: 'draft', logoPath: null } }),
      { failed: 1, expired: 0 },
      '2026-06-01',
    );

    expect(items.map((item) => item.kind)).toEqual(['todo', 'todo', 'check', 'know']);
    expect(items.length).toBeLessThanOrEqual(MAX_ATTENTION_ITEMS);
  });

  it('ne propose pas à un lecteur ce qu’il ne peut pas faire', () => {
    const viewer = editor({
      permissions: { role: 'viewer', canEdit: false, canPublish: false },
      site: { ...COMPLETE_SITE, status: 'draft', logoPath: null },
    });

    expect(keys(viewer)).toEqual(['edition']);
  });

  it('un éditeur complète le site, mais ne le met pas en ligne', () => {
    const member = editor({
      permissions: { role: 'editor', canEdit: true, canPublish: false },
      site: { ...COMPLETE_SITE, status: 'draft', logoPath: null },
    });

    expect(keys(member)).toEqual(['complete', 'edition']);
  });

  it('dit ce qui bloque, et ne demande pas de mettre en ligne', () => {
    const blocked = editor({
      blockers: ['event_not_published'],
      site: { ...COMPLETE_SITE, status: 'draft' },
    });

    expect(keys(blocked)).toEqual(['blocker', 'edition']);
  });

  it('un site suspendu se dit, sans geste à proposer', () => {
    const suspended = editor({ site: { ...COMPLETE_SITE, status: 'suspended' } });
    const items = organizerAttention(suspended, null, '2026-06-01');

    expect(items[0]).toMatchObject({ key: 'suspended', action: null });
    expect(items.some((item) => item.key === 'publish')).toBe(false);
  });

  it('distingue le jour même, le lendemain et une édition passée', () => {
    const text = (today: string) =>
      organizerAttention(editor(), null, today).find((item) => item.key === 'edition');

    expect(text('2026-06-20')?.text).toBe('C’est aujourd’hui.');
    expect(text('2026-06-19')?.text).toBe('C’est demain.');
    expect(text('2026-06-21')?.title).toBe('L’édition 2026 est passée');
  });

  it('une course sur plusieurs jours reste en cours jusqu’à sa fin', () => {
    const edition = editor().edition;
    const multiDay = editor({
      edition: edition === null ? null : { ...edition, endDate: '2026-06-22' },
    });

    expect(
      organizerAttention(multiDay, null, '2026-06-21').find((item) => item.key === 'edition')?.text,
    ).toBe('C’est aujourd’hui.');
  });

  it('une contradiction passe avant les manques du site', () => {
    const items = organizerAttention(
      editor({ site: { ...COMPLETE_SITE, logoPath: null } }),
      null,
      '2026-06-01',
      { conflicts: 2, toCheck: 5, raceSlug: '42-km' },
    );

    expect(items[0]).toMatchObject({
      key: 'information-conflicts',
      kind: 'todo',
      title: '2 contradictions dans vos informations',
      action: { target: { screen: 'informations', raceSlug: '42-km' } },
    });
    expect(items[1]?.key).toBe('complete');
  });

  it('des informations à vérifier forment un seul sujet, à vérifier', () => {
    const items = organizerAttention(editor(), null, '2026-06-01', {
      conflicts: 0,
      toCheck: 1,
      raceSlug: '42-km',
    });

    expect(items[0]).toMatchObject({
      key: 'information-review',
      kind: 'check',
      title: 'Une information à vérifier',
    });
    expect(items.filter((item) => item.key.startsWith('information'))).toHaveLength(1);
  });

  it('rien à décider : aucun sujet sur les informations', () => {
    const items = organizerAttention(editor(), null, '2026-06-01', {
      conflicts: 0,
      toCheck: 0,
      raceSlug: '42-km',
    });

    expect(items.some((item) => item.key.startsWith('information'))).toBe(false);
  });

  it('ne demande pas à un lecteur de vérifier ce qu’il ne peut pas trancher', () => {
    const items = organizerAttention(
      editor({ permissions: { role: 'viewer', canEdit: false, canPublish: false } }),
      null,
      '2026-06-01',
      { conflicts: 1, toCheck: 3, raceSlug: '42-km' },
    );

    expect(items.some((item) => item.key.startsWith('information'))).toBe(false);
  });

  it('sans événement, il n’y a rien à dire', () => {
    expect(organizerAttention(editor({ event: null }), null, '2026-06-01')).toEqual([]);
  });

  it('un site jamais enregistré a tout à compléter', () => {
    const checklist = eventSiteChecklist(editor({ site: null, sections: [], gallery: [] }));

    expect(checklist.filter((item) => item.done).map((item) => item.label)).toEqual([
      'Lien d’inscription',
    ]);
  });
});
