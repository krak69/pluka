import type { RaceRecord } from '@pluka/db';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { UpdateRaceForm } from '@/app/courses/[raceId]/forms';
import { localInstant } from '@/lib/form';
import { localParts, zonedInstant } from '@/lib/zoned';

/**
 * Fiche épreuve — le départ et la barrière se relisent et se saisissent à
 * l'heure de la ligne de départ, et l'aller-retour ne déplace pas l'instant.
 */

const RACE: RaceRecord = {
  id: 'aaaaaaaa-0000-4000-8000-000000000022',
  editionId: 'aaaaaaaa-0000-4000-8000-000000000021',
  name: 'Grand Tour',
  slug: 'grand-tour',
  distanceKm: 82.5,
  elevationGainM: 4500,
  elevationLossM: null,
  startDatetime: '2027-06-12T03:00:00Z',
  cutoffDatetime: '2027-06-13T15:00:00Z',
  timezone: 'Europe/Paris',
  startLocationName: null,
  finishLocationName: null,
  status: 'draft',
  publicVisibility: 'private',
};

describe('relecture en heure locale', () => {
  it('un instant se relit à l’heure du fuseau, et y revient intact', () => {
    const parts = localParts('2027-06-12T03:00:00Z', 'Europe/Paris');

    expect(parts).toEqual({ date: '2027-06-12', time: '05:00' });
    const back = zonedInstant(parts!.date, parts!.time, 'Europe/Paris');
    expect(Date.parse(back!)).toBe(Date.parse('2027-06-12T03:00:00Z'));
  });

  it('rien à relire, ou fuseau inconnu : champ vide', () => {
    expect(localParts(null, 'Europe/Paris')).toBeNull();
    expect(localParts('2027-06-12T03:00:00Z', 'Europe/Nulle-Part')).toBeNull();
  });
});

describe('modifier la fiche', () => {
  const markup = renderToStaticMarkup(<UpdateRaceForm race={RACE} />);

  it('pré-remplit départ et barrière à l’heure de Paris, sans champ ISO', () => {
    expect(markup).toMatch(
      /name="startDate"[^>]*value="2027-06-12"|value="2027-06-12"[^>]*name="startDate"/,
    );
    expect(markup).toMatch(/name="startTime"[^>]*value="05:00"|value="05:00"[^>]*name="startTime"/);
    expect(markup).toMatch(
      /name="cutoffTime"[^>]*value="17:00"|value="17:00"[^>]*name="cutoffTime"/,
    );
    expect(markup).not.toContain('name="startDatetime"');
  });

  it('ce que le formulaire poste redevient le même instant', () => {
    const form = new FormData();
    form.set('startDate', '2027-06-12');
    form.set('startTime', '05:00');
    form.set('timezone', 'Europe/Paris');

    expect(localInstant(form, 'start')).toBe('2027-06-12T05:00:00+02:00');
    expect(localInstant(form, 'cutoff')).toBeUndefined();
  });
});
