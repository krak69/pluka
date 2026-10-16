import {
  DbError,
  type EventSiteEditingRepository,
  type EventSiteEditionRecord,
  type EventSiteRaceRecord,
  type EventSiteRecord,
  type SaveEventSiteInput,
} from '@pluka/db';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  EventSiteImageRejected,
  currentSiteEdition,
  getEventSiteEditor,
  removeEventSiteImage,
  saveEventSite,
  setEventSiteDocumentPublic,
  setEventSiteStatus,
  uploadEventSiteImage,
  type EventSiteImageContext,
} from '../src/index.js';

/**
 * L'éditeur du site — EVENT_SITE §4, §5, §8.
 *
 * Owner, admin et editor éditent ; owner et admin publient ; un viewer voit.
 * Un non-membre ne sait pas que l'organisation existe. Rien n'est écrit sous
 * clé de service avant que le rôle soit vérifié.
 */

const ORG = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER_ORG = 'aaaaaaaa-0000-4000-8000-000000000002';
const EVENT = 'aaaaaaaa-0000-4000-8000-000000000011';
const EDITION = 'aaaaaaaa-0000-4000-8000-000000000012';
const RACE = 'aaaaaaaa-0000-4000-8000-000000000013';
const FOREIGN_RACE = 'bbbbbbbb-0000-4000-8000-000000000013';
const DOCUMENT = 'aaaaaaaa-0000-4000-8000-000000000091';
const FOREIGN_DOCUMENT = 'bbbbbbbb-0000-4000-8000-000000000091';

type Role = 'owner' | 'admin' | 'editor' | 'viewer';

interface World {
  role: Role | null;
  eventSlug: string;
  eventStatus: 'draft' | 'published' | 'archived';
  site: EventSiteRecord | null;
  saved: SaveEventSiteInput[];
  statuses: string[];
  images: { kind: string; path: string | null }[];
  failSetImage: boolean;
  uploads: string[];
  removed: string[];
  processed: number;
  rejectImage: boolean;
  documentToggles: { sourceId: string; isPublic: boolean }[];
}

let world: World;

const edition: EventSiteEditionRecord = {
  id: EDITION,
  year: 2026,
  slug: 'trail-de-test-2026',
  startDate: '2026-06-20',
  endDate: null,
  status: 'published',
  registrationUrl: null,
};

const race: EventSiteRaceRecord = {
  id: RACE,
  name: '80K',
  slug: '80k',
  startDatetime: '2026-06-20T04:00:00Z',
  registrationUrl: null,
  publicVisibility: 'public',
  status: 'published',
};

function repository(): EventSiteEditingRepository {
  return {
    listOrganizationEvents: (organizationId) =>
      Promise.resolve(
        organizationId === ORG
          ? [{ id: EVENT, name: 'Trail de Test', slug: world.eventSlug, status: world.eventStatus }]
          : [],
      ),
    findSite: () => Promise.resolve(world.site),
    listSections: () => Promise.resolve([]),
    listEditions: () => Promise.resolve([edition]),
    listRaces: () => Promise.resolve([race]),
    save: (input) => {
      world.saved.push(input);
      return Promise.resolve();
    },
    setStatus: (_eventId, status) => {
      world.statuses.push(status);
      return Promise.resolve();
    },
    setImage: (_eventId, kind, path) => {
      if (world.failSetImage) {
        return Promise.reject(
          new DbError({ code: 'permission_denied', operation: 'set_event_site_image', message: 'non' }),
        );
      }
      world.images.push({ kind, path });
      return Promise.resolve();
    },
    listDocuments: () =>
      Promise.resolve([
        {
          id: DOCUMENT,
          title: 'Règlement 2026',
          sourceType: 'pdf',
          hasFile: true,
          url: null,
          publicDownloadAt: null,
        },
      ]),
    setDocumentPublic: (sourceId, isPublic) => {
      world.documentToggles.push({ sourceId, isPublic });
      return Promise.resolve();
    },
  };
}

function context(): EventSiteImageContext {
  return {
    repositories: {
      eventSiteEditing: repository(),
      organizationTeam: {
        listOwnMemberships: () =>
          Promise.resolve(
            world.role === null
              ? []
              : [{ organizationId: ORG, organizationName: 'Org A', role: world.role }],
          ),
      },
    },
    actor: { userId: '55555555-5555-4555-8555-555555555555' },
    assets: {
      upload: (path) => {
        world.uploads.push(path);
        return Promise.resolve();
      },
      remove: (paths) => {
        world.removed.push(...paths);
        return Promise.resolve();
      },
    },
    images: {
      process: () => {
        world.processed += 1;
        if (world.rejectImage) return Promise.reject(new EventSiteImageRejected());
        return Promise.resolve({
          bytes: new Uint8Array([1, 2, 3]),
          contentType: 'image/webp',
          extension: 'webp',
        });
      },
    },
  };
}

function site(overrides: Partial<EventSiteRecord> = {}): EventSiteRecord {
  return {
    eventId: EVENT,
    status: 'draft',
    accentColor: null,
    headingFont: null,
    logoPath: null,
    coverPath: null,
    contactEmail: null,
    publishedAt: null,
    ...overrides,
  };
}

const SAVE = {
  organizationId: ORG,
  eventId: EVENT,
  accentColor: '#B8322A',
  headingFont: 'oswald',
  contactEmail: 'courses@trail.test',
  sections: [{ title: ' Hébergement ', body: 'Gîte du col.' }],
  registration: {
    editionId: EDITION,
    editionUrl: 'https://inscriptions.example/2026',
    races: [{ raceId: RACE, url: '' }],
  },
};

const IMAGE = {
  organizationId: ORG,
  eventId: EVENT,
  kind: 'logo',
  contentType: 'image/png',
  bytes: new Uint8Array([137, 80, 78, 71]),
};

beforeEach(() => {
  world = {
    role: 'editor',
    eventSlug: 'trail-de-test',
    eventStatus: 'published',
    site: null,
    saved: [],
    statuses: [],
    images: [],
    failSetImage: false,
    uploads: [],
    removed: [],
    processed: 0,
    rejectImage: false,
    documentToggles: [],
  };
});

describe('lire l’éditeur', () => {
  it('dit au lecteur ce qu’il peut faire, sans rien lui ouvrir de plus', async () => {
    world.role = 'viewer';
    const editor = await getEventSiteEditor(context(), { organizationId: ORG, today: '2026-10-16' });

    expect(editor.permissions).toMatchObject({ canEdit: false, canPublish: false });
    expect(editor.event?.slug).toBe('trail-de-test');
    expect(editor.edition?.id).toBe(EDITION);
  });

  it('ne confirme pas l’existence d’une organisation à un non-membre', async () => {
    world.role = null;
    await expect(
      getEventSiteEditor(context(), { organizationId: ORG, today: '2026-10-16' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('nomme ce qui garderait le site hors ligne', async () => {
    world.eventStatus = 'draft';
    world.eventSlug = 'app';
    const editor = await getEventSiteEditor(context(), { organizationId: ORG, today: '2026-10-16' });

    expect(editor.blockers).toEqual(['event_not_published', 'slug_not_subdomain']);
  });
});

describe('enregistrer', () => {
  it('éditeur : enregistre l’identité, les blocs et l’inscription, nettoyés', async () => {
    await saveEventSite(context(), SAVE);

    expect(world.saved).toEqual([
      {
        eventId: EVENT,
        accentColor: '#b8322a',
        headingFont: 'oswald',
        contactEmail: 'courses@trail.test',
        sections: [{ title: 'Hébergement', body: 'Gîte du col.' }],
        registration: {
          editionId: EDITION,
          editionUrl: 'https://inscriptions.example/2026',
          // Un champ vidé retire le lien propre de l'épreuve.
          races: [{ raceId: RACE, url: null }],
        },
      },
    ]);
  });

  it('lecteur : refusé, rien n’est écrit', async () => {
    world.role = 'viewer';
    await expect(saveEventSite(context(), SAVE)).rejects.toMatchObject({ code: 'forbidden' });
    expect(world.saved).toEqual([]);
  });

  it('autre organisation : l’événement n’existe pas pour elle', async () => {
    await expect(
      saveEventSite(context(), { ...SAVE, organizationId: OTHER_ORG }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuse un accent qui ne se lit pas, en disant pourquoi', async () => {
    await expect(
      saveEventSite(context(), { ...SAVE, accentColor: '#f5e663' }),
    ).rejects.toMatchObject({
      code: 'validation',
      details: { accentColor: expect.stringContaining('ne se détache pas assez du fond') },
    });
  });

  it('refuse un lien d’inscription qui n’est pas https, et une épreuve d’ailleurs', async () => {
    await expect(
      saveEventSite(context(), {
        ...SAVE,
        registration: { ...SAVE.registration, editionUrl: 'http://inscriptions.example' },
      }),
    ).rejects.toMatchObject({ code: 'validation' });

    await expect(
      saveEventSite(context(), {
        ...SAVE,
        registration: { ...SAVE.registration, races: [{ raceId: FOREIGN_RACE, url: null }] },
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(world.saved).toEqual([]);
  });
});

describe('mettre en ligne', () => {
  it('éditeur : refusé ; admin : met en ligne', async () => {
    world.site = site();
    await expect(
      setEventSiteStatus(context(), { organizationId: ORG, eventId: EVENT, status: 'published' }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    world.role = 'admin';
    await setEventSiteStatus(context(), { organizationId: ORG, eventId: EVENT, status: 'published' });
    expect(world.statuses).toEqual(['published']);
  });

  it('demande un site enregistré, et ne lève pas une suspension', async () => {
    world.role = 'owner';
    await expect(
      setEventSiteStatus(context(), { organizationId: ORG, eventId: EVENT, status: 'published' }),
    ).rejects.toMatchObject({ code: 'invalid_state' });

    world.site = site({ status: 'suspended' });
    await expect(
      setEventSiteStatus(context(), { organizationId: ORG, eventId: EVENT, status: 'draft' }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('refuse une adresse qui ne peut pas être un sous-domaine', async () => {
    world.role = 'owner';
    world.site = site();
    world.eventSlug = 'app';
    await expect(
      setEventSiteStatus(context(), { organizationId: ORG, eventId: EVENT, status: 'published' }),
    ).rejects.toMatchObject({ code: 'validation' });
  });
});

describe('les images', () => {
  it('lecteur : refusé avant tout traitement et tout dépôt', async () => {
    world.role = 'viewer';
    await expect(uploadEventSiteImage(context(), IMAGE)).rejects.toMatchObject({ code: 'forbidden' });
    expect(world.processed).toBe(0);
    expect(world.uploads).toEqual([]);
  });

  it('éditeur : réencodée, déposée sous le dossier de l’événement, l’ancienne retirée', async () => {
    world.site = site({ logoPath: `${EVENT}/logo-ancien.webp` });
    await uploadEventSiteImage(context(), IMAGE);

    expect(world.uploads).toHaveLength(1);
    expect(world.uploads[0]).toMatch(new RegExp(`^${EVENT}/logo-[0-9a-f-]+\\.webp$`, 'u'));
    expect(world.images).toEqual([{ kind: 'logo', path: world.uploads[0] }]);
    expect(world.removed).toEqual([`${EVENT}/logo-ancien.webp`]);
  });

  it('refusée par la base : le fichier déposé est retiré', async () => {
    world.failSetImage = true;
    await expect(uploadEventSiteImage(context(), IMAGE)).rejects.toMatchObject({ code: 'forbidden' });
    expect(world.removed).toEqual(world.uploads);
  });

  it('un fichier qui n’est pas une image : refusé, rien n’est déposé', async () => {
    world.rejectImage = true;
    await expect(uploadEventSiteImage(context(), IMAGE)).rejects.toMatchObject({ code: 'validation' });
    expect(world.uploads).toEqual([]);

    await expect(
      uploadEventSiteImage(context(), { ...IMAGE, contentType: 'image/svg+xml' }),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('retirer : l’image disparaît du site, puis du stockage', async () => {
    world.site = site({ coverPath: `${EVENT}/cover-1.webp` });
    await removeEventSiteImage(context(), { organizationId: ORG, eventId: EVENT, kind: 'cover' });

    expect(world.images).toEqual([{ kind: 'cover', path: null }]);
    expect(world.removed).toEqual([`${EVENT}/cover-1.webp`]);
  });
});

describe('l’édition du site', () => {
  const at = (id: string, startDate: string, status: EventSiteEditionRecord['status'] = 'published') => ({
    ...edition,
    id,
    startDate,
    status,
  });

  it('prend la prochaine à venir, sinon la dernière ; jamais une annulée', () => {
    expect(currentSiteEdition([at('a', '2025-06-20'), at('b', '2026-06-20')], '2026-10-16')?.id).toBe('b');
    expect(
      currentSiteEdition([at('b', '2026-06-20'), at('c', '2027-06-19', 'draft')], '2026-10-16')?.id,
    ).toBe('c');
    expect(
      currentSiteEdition([at('b', '2026-06-20'), at('c', '2027-06-19', 'cancelled')], '2026-10-16')?.id,
    ).toBe('b');
    expect(currentSiteEdition([], '2026-10-16')).toBeNull();
  });
});

describe('diffuser un document', () => {
  const TOGGLE = { organizationId: ORG, eventId: EVENT, sourceId: DOCUMENT, public: true };

  it('éditeur : refusé ; admin : diffuse', async () => {
    await expect(setEventSiteDocumentPublic(context(), TOGGLE)).rejects.toMatchObject({
      code: 'forbidden',
    });

    world.role = 'admin';
    await setEventSiteDocumentPublic(context(), TOGGLE);
    expect(world.documentToggles).toEqual([{ sourceId: DOCUMENT, isPublic: true }]);
  });

  it('un document d’un autre événement n’existe pas ici', async () => {
    world.role = 'owner';
    await expect(
      setEventSiteDocumentPublic(context(), { ...TOGGLE, sourceId: FOREIGN_DOCUMENT }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(world.documentToggles).toEqual([]);
  });

  it('l’éditeur liste les documents de l’édition', async () => {
    const editor = await getEventSiteEditor(context(), { organizationId: ORG, today: '2026-10-16' });
    expect(editor.documents.map((document) => document.title)).toEqual(['Règlement 2026']);
  });
});
