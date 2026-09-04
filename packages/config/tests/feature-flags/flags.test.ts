import { describe, expect, it } from 'vitest';

import {
  assertFeatureEnabled,
  DEFAULT_FEATURE_FLAGS,
  EnvValidationError,
  FEATURE_FLAGS,
  FeatureDisabledError,
  featureFlagEnvKey,
  isFeatureEnabled,
  loadFeatureFlags,
  type FeatureFlag,
} from '../../src/index.js';

describe('liste des flags', () => {
  it('correspond à 01_ARCHITECTURE §41', () => {
    expect([...FEATURE_FLAGS]).toEqual([
      'repere_pluka',
      'race_intelligence',
      'community',
      'advanced_offline',
    ]);
  });

  it('nomme la variable d’environnement de chaque flag', () => {
    expect(featureFlagEnvKey('repere_pluka')).toBe('FLAG_REPERE_PLUKA');
    expect(featureFlagEnvKey('advanced_offline')).toBe('FLAG_ADVANCED_OFFLINE');
  });

  it('éteint tous les flags par défaut', () => {
    for (const flag of FEATURE_FLAGS) {
      expect(DEFAULT_FEATURE_FLAGS[flag]).toBe(false);
    }
  });
});

describe('loadFeatureFlags', () => {
  it('retourne les défauts quand aucune variable n’est définie', () => {
    expect(loadFeatureFlags({})).toEqual(DEFAULT_FEATURE_FLAGS);
  });

  it.each(FEATURE_FLAGS)('active %s par sa seule variable', (flag) => {
    const flags = loadFeatureFlags({ [featureFlagEnvKey(flag)]: 'true' });

    expect(flags[flag]).toBe(true);
    for (const other of FEATURE_FLAGS.filter((candidate) => candidate !== flag)) {
      expect(flags[other]).toBe(false);
    }
  });

  it.each([
    ['true', true],
    ['TRUE', true],
    ['  true  ', true],
    ['1', true],
    ['false', false],
    ['0', false],
    ['', false],
  ])('interprète %j comme %s', (raw, expected) => {
    expect(loadFeatureFlags({ FLAG_COMMUNITY: raw }).community).toBe(expected);
  });

  it('refuse une valeur non booléenne plutôt que de l’éteindre silencieusement', () => {
    try {
      loadFeatureFlags({ FLAG_RACE_INTELLIGENCE: 'beta' });
      expect.unreachable('la validation aurait dû échouer');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues).toEqual([
        {
          key: 'FLAG_RACE_INTELLIGENCE',
          message: 'FLAG_RACE_INTELLIGENCE : valeur booléenne attendue (true, false, 1 ou 0)',
        },
      ]);
    }
  });

  it('ignore une variable FLAG_ inconnue', () => {
    expect(loadFeatureFlags({ FLAG_INEXISTANT: 'true' })).toEqual(DEFAULT_FEATURE_FLAGS);
  });
});

describe('résolution', () => {
  const flags = loadFeatureFlags({ FLAG_COMMUNITY: 'true' });

  it('répond sur un flag activé', () => {
    expect(isFeatureEnabled(flags, 'community')).toBe(true);
    expect(() => assertFeatureEnabled(flags, 'community')).not.toThrow();
  });

  it('refuse un flag éteint avec une erreur typée distincte d’un refus d’entitlement', () => {
    expect(isFeatureEnabled(flags, 'race_intelligence')).toBe(false);

    try {
      assertFeatureEnabled(flags, 'race_intelligence');
      expect.unreachable('le flag éteint aurait dû lever');
    } catch (error) {
      expect(error).toBeInstanceOf(FeatureDisabledError);
      const failure = error as FeatureDisabledError;
      expect(failure.code).toBe('FEATURE_DISABLED');
      expect(failure.flag).toBe('race_intelligence');
    }
  });

  it('reste pur : le même jeu de flags donne la même réponse', () => {
    const flag: FeatureFlag = 'advanced_offline';

    expect(isFeatureEnabled(flags, flag)).toBe(isFeatureEnabled(flags, flag));
  });
});
