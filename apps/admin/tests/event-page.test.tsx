import type { EditionRecord, RaceRecord } from '@pluka/db';
import { createRaceCommandSchema } from '@pluka/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  activityOf,
  editionDates,
  headlineOf,
  pointsLine,
  raceMeasures,
  raceStart,
} from '@/app/evenements/[eventId]/event-overview';
import { RaceVisibilityForm } from '@/app/courses/[raceId]/forms';
import { CreateEditionForm, CreateRaceForm } from '@/app/evenements/[eventId]/forms';
import { createRaceCommand } from '@/lib/form';
import { zonedInstant } from '@/lib/zoned';

/**
 * Fiche événement — ce qu'elle dit de l'état lu, et les formulaires qu'elle
 * porte. La page elle-même lit la base ; ses aides, elles, se testent seules.
 */

const EDITION_ID = 'aaaaaaaa-0000-4000-8000-000000000021';

function edition(overrides: Partial<EditionRecord> = {}): EditionRecord {
  return {
    id: EDITION_ID,
    eventId: 'aaaaaaaa-0000-4000-8000-000000000020',
    year: 2027,
    slug: '2027',
    startDate: '2027-06-12',
    endDate: null,
    status: 'draft',
    ...overrides,
  };
}

function race(overrides: Partial<RaceRecord> = {}): RaceRecord {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000022',
    editionId: EDITION_ID,
    name: 'Grand Tour',
    slug: 'grand-tour',
    distanceKm: 82.5,
    elevationGainM: 4500,
    elevationLossM: null,
    startDatetime: '2027-06-12T03:00:00Z',
    cutoffDatetime: null,
    timezone: 'Europe/Paris',
    startLocationName: null,
    finishLocationName: null,
    status: 'draft',
    publicVisibility: 'public',
    ...overrides,
  };
}

describe('heure locale de départ', () => {
  it('prend le décalage de la date, heure d’été comprise', () => {
    expect(zonedInstant('2027-06-12', '05:00', 'Europe/Paris')).toBe('2027-06-12T05:00:00+02:00');
    expect(zonedInstant('2027-01-12', '05:00', 'Europe/Paris')).toBe('2027-01-12T05:00:00+01:00');
    expect(zonedInstant('2027-03-20', '18:30', 'America/Martinique')).toBe(
      '2027-03-20T18:30:00-04:00',
    );
  });

  it('refuse une date, une heure ou un fuseau illisibles', () => {
    expect(zonedInstant('2027-02-30', '05:00', 'Europe/Paris')).toBeNull();
    expect(zonedInstant('2027-06-12', '25:00', 'Europe/Paris')).toBeNull();
    expect(zonedInstant('2027-06-12', '05:00', 'Europe/Nulle-Part')).toBeNull();
  });
});

describe('commande de création d’épreuve', () => {
  function form(values: Record<string, string>): FormData {
    const data = new FormData();
    for (const [name, value] of Object.entries(values)) data.set(name, value);
    return data;
  }

  const BASE = {
    editionId: EDITION_ID,
    name: 'Grand Tour',
    slug: 'grand-tour',
    distanceKm: '82.5',
    startDate: '2027-06-12',
    startTime: '05:00',
    timezone: 'Europe/Paris',
  };

  it('compose départ et barrière dans le fuseau, et le domaine l’accepte', () => {
    const command = createRaceCommand(
      form({ ...BASE, cutoffDate: '2027-06-13', cutoffTime: '17:00' }),
    );

    expect(command).toMatchObject({
      startDatetime: '2027-06-12T05:00:00+02:00',
      cutoffDatetime: '2027-06-13T17:00:00+02:00',
      elevationGainM: null,
    });
    const parsed = createRaceCommandSchema.safeParse(command);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('sans barrière, la barrière reste nulle', () => {
    expect(createRaceCommand(form(BASE))).toMatchObject({ cutoffDatetime: null });
  });

  it('une heure manquante part telle quelle, et le domaine la refuse sur son champ', () => {
    const command = createRaceCommand(form({ ...BASE, startTime: '' }));
    const parsed = createRaceCommandSchema.safeParse(command);

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path.join('.'))).toContain('startDatetime');
  });
});

describe('formulaires de la fiche', () => {
  it('l’épreuve se saisit en date et heure, slug et fuseau repliés', () => {
    const markup = renderToStaticMarkup(
      <CreateRaceForm editionId={EDITION_ID} eventId="e" defaultDate="2027-06-12" />,
    );

    for (const name of ['startDate', 'startTime', 'cutoffDate', 'cutoffTime', 'slug', 'timezone']) {
      expect(markup).toContain(`name="${name}"`);
    }
    expect(markup).not.toContain('ISO 8601');
    expect(markup).toContain('value="2027-06-12"');
    expect(markup).toContain('Réglages avancés — slug, fuseau horaire');
  });

  it('l’édition propose son année et son slug', () => {
    const markup = renderToStaticMarkup(<CreateEditionForm eventId="e" defaultYear={2028} />);

    expect(markup).toMatch(/name="year"[^>]*value="2028"|value="2028"[^>]*name="year"/);
    expect(markup).toMatch(/name="slug"[^>]*value="2028"|value="2028"[^>]*name="slug"/);
  });
});

describe('présentation de la fiche — les règles sont dans eventReadiness', () => {
  it('dit l’épreuve en mots lisibles, à l’heure de la ligne de départ', () => {
    // Espace fine insécable de fr-FR entre les milliers.
    expect(raceMeasures(race())).toBe('82,5 km · 4\u202f500 m D+');
    // 03:00 UTC = 05:00 à Paris en juin.
    expect(raceStart(race())).toContain('05:00');
    expect(editionDates(edition())).toBe('12 juin 2027');
    expect(editionDates(edition({ endDate: '2027-06-14' }))).toBe('12 juin 2027 → 14 juin 2027');
  });

  it('le bandeau dit l’état d’après le premier point', () => {
    const todo = { kind: 'publish-edition' as const, title: 'Diffuser', detail: '' };

    expect(headlineOf({ todos: [todo] })).toBe('L’édition attend sa diffusion.');
    expect(pointsLine({ todos: [todo, todo] })).toBe('2 points à reprendre');
    expect(headlineOf({ todos: [] })).toBe('Tout est publié : les coureurs voient l’événement.');
    expect(pointsLine({ todos: [] })).toBe('Rien à reprendre');
  });

  it('l’activité mêle statuts et publications, la plus récente d’abord', () => {
    const activity = activityOf({
      eventHistory: [
        { id: 'h1', fromStatus: 'draft', toStatus: 'published', createdAt: '2026-10-01T10:00:00Z' },
      ],
      editions: [
        {
          year: 2026,
          history: [
            {
              id: 'h2',
              fromStatus: 'draft',
              toStatus: 'published',
              createdAt: '2026-10-02T10:00:00Z',
            },
          ],
        },
      ],
      facts: [
        { raceName: 'Grand Tour', category: 'cutoff', publishedAt: '2026-10-03T08:00:00Z' },
        { raceName: 'Grand Tour', category: 'cutoff', publishedAt: '2026-10-03T09:00:00Z' },
        { raceName: 'Grand Tour', category: 'aid', publishedAt: null },
      ],
    });

    expect(activity.map((entry) => entry.text)).toEqual([
      'Information publiée : Barrières horaires — Grand Tour',
      'Édition 2026 : En préparation → Diffusée',
      'Événement : En préparation → Publié',
    ]);
    // Une ligne par épreuve et catégorie, à la dernière publication.
    expect(activity[0]?.at).toBe('2026-10-03T09:00:00Z');
  });
});

describe('publication d’une épreuve', () => {
  it('la visibilité se choisit parmi trois options décrites, l’actuelle cochée', () => {
    const markup = renderToStaticMarkup(
      <RaceVisibilityForm raceId={race().id} visibility="private" />,
    );

    expect(markup.match(/type="radio"[^>]*name="visibility"/g)).toHaveLength(3);
    expect(markup).toMatch(/checked=""[^>]*value="private"|value="private"[^>]*checked=""/);
    expect(markup).toContain('Publique');
    expect(markup).toContain('Non listée');
    expect(markup).toContain('name="raceId"');
  });
});
