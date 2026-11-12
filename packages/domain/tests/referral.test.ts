import type { ReferralCodeRepository } from '@pluka/db';
import { describe, expect, it } from 'vitest';

import {
  normalizeReferralCode,
  resolveReferralCode,
  type ReferralCodeContext,
} from '../src/index.js';

/** Canal A — 00_PRODUCT_SPEC §6.5.4, 04_ENTITLEMENTS §73.1, migration 0087. */

function contextWith(resolved: Awaited<ReturnType<ReferralCodeRepository['resolve']>>) {
  const asked: string[] = [];
  const context: ReferralCodeContext = {
    repositories: {
      referralCodes: {
        resolve: (code) => {
          asked.push(code);
          return Promise.resolve(resolved);
        },
        forEdition: () => Promise.resolve(null),
        setActive: () => Promise.resolve(),
      },
    },
  };
  return { context, asked };
}

describe('le code dans une adresse', () => {
  it('se lit sans la casse ni les espaces', () => {
    expect(normalizeReferralCode(' les9clochers27 ')).toBe('LES9CLOCHERS27');
  });

  it('écarte ce qui ne peut pas être un code, sans erreur', () => {
    for (const value of [
      '',
      'abc',
      'A'.repeat(25),
      'LES-9',
      '<script>',
      null,
      undefined,
      42,
      ['LES9CLOCHERS27'],
    ]) {
      expect(normalizeReferralCode(value), String(value)).toBeNull();
    }
  });
});

describe('la page du lien', () => {
  it('ne consulte pas la base pour un code mal formé', async () => {
    const { context, asked } = contextWith(null);

    await expect(resolveReferralCode(context, { code: 'pas un code' })).resolves.toBeNull();
    expect(asked).toEqual([]);
  });

  it('demande le code normalisé', async () => {
    const { context, asked } = contextWith(null);

    await resolveReferralCode(context, { code: 'les9clochers27' });
    expect(asked).toEqual(['LES9CLOCHERS27']);
  });
});
