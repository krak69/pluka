import { describe, expect, it } from 'vitest';

import {
  computationMetadataSchema,
  httpUrlSchema,
  ianaTimeZoneSchema,
  instantSchema,
  jsonObjectSchema,
  jsonValueSchema,
  latitudeSchema,
  longitudeSchema,
  nonEmptyStringSchema,
  sha256HexSchema,
  uuidSchema,
} from '../src/index.js';

const HASH = 'a'.repeat(64);

describe('JSON', () => {
  it('accepte une structure imbriquée sérialisable', () => {
    const value = { a: 1, b: ['x', null, { c: true }] };

    expect(jsonValueSchema.parse(value)).toEqual(value);
    expect(jsonObjectSchema.parse(value)).toEqual(value);
  });

  it.each([
    ['undefined imbriqué', { a: undefined }],
    ['fonction', { a: () => 1 }],
    ['date', { a: new Date() }],
  ])('refuse une valeur non sérialisable en jsonb : %s', (_label, value) => {
    expect(jsonValueSchema.safeParse(value).success).toBe(false);
  });

  it('refuse un tableau à la racine d’un objet de payload', () => {
    expect(jsonObjectSchema.safeParse([1, 2]).success).toBe(false);
  });
});

describe('identifiants', () => {
  it('accepte un UUID et refuse une chaîne libre', () => {
    expect(uuidSchema.parse('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    );
    expect(uuidSchema.safeParse('race-42').success).toBe(false);
  });

  it('exige une chaîne non vide, espaces exclus', () => {
    expect(nonEmptyStringSchema.parse('  plan  ')).toBe('plan');
    expect(nonEmptyStringSchema.safeParse('   ').success).toBe(false);
  });

  it('n’accepte qu’une empreinte SHA-256 hexadécimale minuscule', () => {
    expect(sha256HexSchema.parse(HASH)).toBe(HASH);
    expect(sha256HexSchema.safeParse(HASH.toUpperCase()).success).toBe(false);
    expect(sha256HexSchema.safeParse('a'.repeat(63)).success).toBe(false);
  });
});

describe('temps', () => {
  it.each(['2026-09-04T05:30:00Z', '2026-09-04T07:30:00+02:00'])(
    'accepte un instant avec fuseau : %s',
    (value) => {
      expect(instantSchema.parse(value)).toBe(value);
    },
  );

  it.each(['2026-09-04T07:30:00', '2026-09-04', '04/09/2026 07:30'])(
    'refuse une date-heure sans instant réel : %s',
    (value) => {
      expect(instantSchema.safeParse(value).success).toBe(false);
    },
  );

  it.each(['Europe/Paris', 'UTC', 'America/New_York'])('accepte le fuseau IANA %s', (value) => {
    expect(ianaTimeZoneSchema.parse(value)).toBe(value);
  });

  it.each(['Europe/Paris2', 'CET+2', ''])('refuse le fuseau inconnu %j', (value) => {
    expect(ianaTimeZoneSchema.safeParse(value).success).toBe(false);
  });
});

describe('géographie', () => {
  it('borne latitude et longitude', () => {
    expect(latitudeSchema.parse(45.832)).toBe(45.832);
    expect(latitudeSchema.safeParse(90.1).success).toBe(false);
    expect(longitudeSchema.parse(6.865).toFixed(3)).toBe('6.865');
    expect(longitudeSchema.safeParse(-180.5).success).toBe(false);
  });

  it('refuse NaN', () => {
    expect(latitudeSchema.safeParse(Number.NaN).success).toBe(false);
  });
});

describe('URL', () => {
  it.each(['https://pluka.run/retour', 'http://localhost:3000/retour'])('accepte %s', (value) => {
    expect(httpUrlSchema.parse(value)).toBe(value);
  });

  it.each(['javascript:alert(1)', 'file:///etc/passwd', '/retour', 'ftp://exemple.test'])(
    'refuse %s',
    (value) => {
      expect(httpUrlSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('métadonnées de calcul', () => {
  it('exige version de moteur et instant de calcul', () => {
    const metadata = computationMetadataSchema.parse({
      engineVersion: 'plan-1.0.0',
      computedAt: '2026-09-04T05:30:00Z',
    });

    expect(metadata.engineVersion).toBe('plan-1.0.0');
    expect(metadata.inputHash).toBeUndefined();
  });

  it('accepte les champs de reproductibilité optionnels', () => {
    const metadata = computationMetadataSchema.parse({
      engineVersion: 'weather-0.3.0',
      configVersion: 'wx-config-2',
      processorVersion: 'gpx-1.1.0',
      inputHash: HASH,
      computedAt: '2026-09-04T05:30:00Z',
      calculationReason: 'plan.updated',
    });

    expect(metadata.inputHash).toBe(HASH);
    expect(metadata.calculationReason).toBe('plan.updated');
  });

  it('refuse une empreinte d’entrée mal formée', () => {
    expect(
      computationMetadataSchema.safeParse({
        engineVersion: 'plan-1.0.0',
        computedAt: '2026-09-04T05:30:00Z',
        inputHash: 'pas-un-hash',
      }).success,
    ).toBe(false);
  });
});
