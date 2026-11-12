import { describe, expect, it } from 'vitest';

import {
  earlyBirdWindow,
  isEarlyBirdEligible,
  registrationReference,
  type RegistrationReference,
} from '../src/index.js';

/**
 * Tarif early bird — 00_PRODUCT_SPEC §6.5.2-6.5.3, 04_ENTITLEMENTS §72.1,
 * tests E40 et suivants (§119.1).
 *
 * Les jours se comptent dans le fuseau de la course ; Paris est en heure
 * d'hiver en mars avant le 29, en heure d'été ensuite.
 */

const PARIS = 'Europe/Paris';
const FAR_RACE = '2026-10-10T05:00:00Z';

const verified = (day: string): RegistrationReference => ({ day, origin: 'verified' });

describe('date d’inscription de référence', () => {
  it('une date vérifiée prévaut toujours sur la création de la participation', () => {
    expect(
      registrationReference({
        verifiedOn: '2026-01-05',
        participationCreatedAt: '2026-03-01T10:00:00Z',
        timeZone: PARIS,
      }),
    ).toEqual({ day: '2026-01-05', origin: 'verified' });
  });

  it('à défaut, le jour de création lu dans le fuseau de la course', () => {
    // 23:30 UTC le 1er mars = 00:30 le 2 mars à Paris.
    expect(
      registrationReference({
        verifiedOn: null,
        participationCreatedAt: '2026-03-01T23:30:00Z',
        timeZone: PARIS,
      }),
    ).toEqual({ day: '2026-03-02', origin: 'declared' });
  });
});

describe('fenêtre du tarif', () => {
  it('inscrit le 1er mars : le tarif tient jusqu’au 16 mars 23:59, heure de la course', () => {
    const window = earlyBirdWindow(verified('2026-03-01'), FAR_RACE, PARIS);

    // Minuit à Paris le 17 mars = 23:00 UTC le 16 (heure d'hiver).
    expect(window).toEqual({ endsBefore: '2026-03-16T23:00:00.000Z', lastDay: '2026-03-16' });
  });

  it('suit le changement d’heure : la fin reste minuit, heure locale', () => {
    // Inscrit le 20 mars : fin au 4 avril 23:59, en heure d'été (UTC+2).
    expect(earlyBirdWindow(verified('2026-03-20'), FAR_RACE, PARIS)?.endsBefore).toBe(
      '2026-04-04T22:00:00.000Z',
    );
  });

  it('se ferme 60 jours avant le départ quand cette borne vient en premier', () => {
    // Départ le 10 mai 07:00 Paris ; 60 jours avant = 11 mars 05:00 UTC.
    const window = earlyBirdWindow(verified('2026-03-01'), '2026-05-10T05:00:00Z', PARIS);

    expect(window?.lastDay).toBe('2026-03-11');
    expect(window?.endsBefore).toBe('2026-03-11T05:00:00.001Z');
  });

  it('sans heure de départ, aucune fenêtre n’est supposée', () => {
    expect(earlyBirdWindow(verified('2026-03-01'), null, PARIS)).toBeNull();
  });
});

describe('éligibilité', () => {
  const registration = verified('2026-03-01');

  it('E40 — dans les 15 jours et à plus de 60 jours du départ : éligible', () => {
    expect(isEarlyBirdEligible(registration, FAR_RACE, PARIS, '2026-03-16T22:59:59Z')).toBe(true);
  });

  it('le lendemain du dernier jour, minuit passé : tarif standard', () => {
    expect(isEarlyBirdEligible(registration, FAR_RACE, PARIS, '2026-03-16T23:00:00Z')).toBe(false);
  });

  it('exactement 60 jours avant le départ : encore éligible ; une milliseconde après : non', () => {
    const start = '2026-05-10T05:00:00Z';
    expect(isEarlyBirdEligible(registration, start, PARIS, '2026-03-11T05:00:00.000Z')).toBe(true);
    expect(isEarlyBirdEligible(registration, start, PARIS, '2026-03-11T05:00:00.001Z')).toBe(false);
  });

  it('une date vérifiée ancienne rend l’achat inéligible, même si la participation est récente', () => {
    const reference = registrationReference({
      verifiedOn: '2026-01-05',
      participationCreatedAt: '2026-03-01T10:00:00Z',
      timeZone: PARIS,
    });

    expect(isEarlyBirdEligible(reference, FAR_RACE, PARIS, '2026-03-02T10:00:00Z')).toBe(false);
  });

  it('même entrée, même réponse : aucune horloge cachée', () => {
    const now = '2026-03-10T12:00:00Z';
    expect(isEarlyBirdEligible(registration, FAR_RACE, PARIS, now)).toBe(
      isEarlyBirdEligible(registration, FAR_RACE, PARIS, now),
    );
  });
});
