import { describe, expect, it } from 'vitest';

import {
  allowedRaceTransitions,
  canStillBeCancelled,
  findRaceTransition,
  isPubliclyReadableStatus,
  isUnarchiving,
  RACE_TRANSITIONS,
  type RaceStatus,
} from '../src/index.js';

/**
 * La table de transitions, confrontée au tableau de 00_PRODUCT_SPEC §4.1.
 *
 * Module pur : ces tests n'ont besoin d'aucune dépendance, et c'est le point.
 * La règle du cycle de vie se lit et se vérifie sans base ni acteur.
 */

const ALL_STATUSES: readonly RaceStatus[] = [
  'draft',
  'published',
  'cancelled',
  'completed',
  'archived',
];

describe('table de transitions', () => {
  it('reprend exactement le tableau de §4.1', () => {
    // Six lignes au tableau, sept transitions : la dernière ligne couvre
    // `archived → completed` et `archived → cancelled`.
    expect(
      RACE_TRANSITIONS.map((transition) => [transition.from, transition.to, transition.authority]),
    ).toEqual([
      ['draft', 'published', 'organization_editor'],
      ['published', 'cancelled', 'organization_admin'],
      ['published', 'completed', 'platform_admin'],
      ['completed', 'archived', 'platform_admin'],
      ['cancelled', 'archived', 'platform_admin'],
      ['archived', 'completed', 'platform_admin'],
      ['archived', 'cancelled', 'platform_admin'],
    ]);
  });

  it('refuse toute transition non listée', () => {
    // §4.1 : « Une transition non listée ci-dessus est refusée avec
    // `invalid_state`. » On énumère les 25 couples possibles et on vérifie
    // que seuls les 7 attendus existent.
    const allowed = new Set(
      RACE_TRANSITIONS.map((transition) => `${transition.from}→${transition.to}`),
    );

    const found: string[] = [];
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (findRaceTransition(from, to) !== null) found.push(`${from}→${to}`);
      }
    }

    expect(new Set(found)).toEqual(allowed);
    expect(found).toHaveLength(7);
  });

  it('ne permet jamais de revenir en brouillon', () => {
    // Le diagramme ne comporte aucune flèche entrante vers `draft` : une
    // course diffusée ne redevient pas un brouillon.
    for (const from of ALL_STATUSES) {
      expect(findRaceTransition(from, 'draft')).toBeNull();
    }
  });

  it('n’annule pas une course jamais diffusée', () => {
    // `draft → cancelled` n'est pas dans le tableau : une course jamais
    // diffusée n'a rien à annoncer.
    expect(findRaceTransition('draft', 'cancelled')).toBeNull();
  });

  it('n’archive pas directement une course publiée', () => {
    expect(findRaceTransition('published', 'archived')).toBeNull();
  });
});

describe('autorités', () => {
  it('réserve quatre transitions à pluka_admin', () => {
    const reserved = RACE_TRANSITIONS.filter(
      (transition) => transition.authority === 'platform_admin',
    ).map((transition) => `${transition.from}→${transition.to}`);

    expect(reserved).toEqual([
      'published→completed',
      'completed→archived',
      'cancelled→archived',
      'archived→completed',
      'archived→cancelled',
    ]);
  });

  it('confie la publication à l’éditeur et l’annulation à l’admin', () => {
    expect(findRaceTransition('draft', 'published')?.authority).toBe('organization_editor');
    expect(findRaceTransition('published', 'cancelled')?.authority).toBe('organization_admin');
  });
});

describe('annulation', () => {
  it('reste possible tant que la course n’est ni completed ni archived', () => {
    // §4.1 : « y compris après la date de départ ». Aucune horloge n'entre
    // dans cette décision.
    expect(canStillBeCancelled('published')).toBe(true);
    expect(canStillBeCancelled('archived')).toBe(true);
    expect(canStillBeCancelled('completed')).toBe(false);
  });
});

describe('désarchivage', () => {
  it('se reconnaît à son statut de départ', () => {
    expect(isUnarchiving({ from: 'archived', to: 'completed', authority: 'platform_admin' })).toBe(
      true,
    );
    expect(
      isUnarchiving({ from: 'draft', to: 'published', authority: 'organization_editor' }),
    ).toBe(false);
  });

  it('propose les deux retours prévus', () => {
    expect(allowedRaceTransitions('archived').map((transition) => transition.to)).toEqual([
      'completed',
      'cancelled',
    ]);
  });
});

describe('lisibilité publique', () => {
  it('exclut le brouillon et rien d’autre', () => {
    // §4.1, invariant 2 : « Une Race `draft` n'est jamais lisible
    // publiquement, quelle que soit la chaîne au-dessus. » Une course
    // annulée, elle, reste visible.
    expect(ALL_STATUSES.filter((status) => !isPubliclyReadableStatus(status))).toEqual(['draft']);
  });

  it('garde une course annulée visible', () => {
    expect(isPubliclyReadableStatus('cancelled')).toBe(true);
  });
});
