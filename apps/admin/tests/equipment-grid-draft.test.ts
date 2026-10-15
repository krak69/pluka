import { describe, expect, it } from 'vitest';

import {
  changedCellCount,
  importPrevious,
  linesOf,
  matchRaces,
  next,
  pastedLabels,
  payloadOf,
  type GridRow,
  type Line,
} from '@/app/evenements/[eventId]/equipment-grid-draft';

/**
 * Le brouillon du tableau du matériel — migration 0048. Ce qu'un clic fait
 * d'une case, et surtout ce qui part en base : seulement ce qui a changé,
 * jamais une exigence inventée.
 */

const RACES = [
  { id: 'race-a', name: '80K', detail: '80 km' },
  { id: 'race-b', name: '20K', detail: '20 km' },
];

const ROW: GridRow = {
  factKey: 'equipment.frontale',
  label: 'Frontale',
  condition: null,
  detail: 'piles',
  cells: ['mandatory', 'recommended'],
  sources: ['Règlement 2026'],
};

function draft(row: GridRow = ROW): { readonly line: Line; readonly original: Line } {
  const [original] = linesOf([row], RACES);
  if (original === undefined) throw new Error('ligne attendue');
  return { line: original, original };
}

describe('un clic', () => {
  it('suit le cycle : non concernée → recommandé → conditionnel → obligatoire → non concernée', () => {
    expect(next(null)).toBe('recommended');
    expect(next('recommended')).toBe('conditional');
    expect(next('conditional')).toBe('mandatory');
    expect(next('mandatory')).toBeNull();
  });

  it('une exigence inconnue se règle, elle ne se garde pas', () => {
    expect(next('unknown')).toBe('recommended');
  });
});

describe('ce que le brouillon envoie', () => {
  it('rien quand rien n’a changé', () => {
    const { line, original } = draft();
    expect(payloadOf(line, original, RACES)).toBeNull();
  });

  it('seulement la case touchée : une case intacte ne crée pas de version', () => {
    const { line, original } = draft();
    const changed = { ...line, cells: { ...line.cells, 'race-b': null } };

    expect(payloadOf(changed, original, RACES)).toEqual({
      factKey: 'equipment.frontale',
      label: 'Frontale',
      condition: null,
      detail: 'piles',
      requirements: { 'race-b': null },
    });
    expect(changedCellCount([changed], new Map([[line.id, original]]), RACES)).toBe(1);
  });

  it('un nom corrigé part sur chaque case affichée', () => {
    const { line, original } = draft();
    const renamed = { ...line, label: '  Frontale + piles ' };

    expect(payloadOf(renamed, original, RACES)?.requirements).toEqual({
      'race-a': 'mandatory',
      'race-b': 'recommended',
    });
    expect(payloadOf(renamed, original, RACES)?.label).toBe('Frontale + piles');
  });

  it('une ligne nouvelle part sans clé, avec toutes ses cases réglées', () => {
    const { line } = draft();
    const added = { ...line, id: 'new-1', factKey: null, label: 'Gants' };

    expect(payloadOf(added, undefined, RACES)).toMatchObject({
      factKey: null,
      label: 'Gants',
      requirements: { 'race-a': 'mandatory', 'race-b': 'recommended' },
    });
  });

  it('une condition écrite puis abandonnée (plus de case conditionnelle) ne compte pas', () => {
    const { line, original } = draft();
    const abandoned = { ...line, condition: 'si pluie' };

    expect(payloadOf(abandoned, original, RACES)).toBeNull();
  });

  it('n’envoie jamais une exigence inconnue, même quand le nom change (§82)', () => {
    const { line, original } = draft({ ...ROW, cells: ['unknown', 'mandatory'] });
    const renamed = { ...line, label: 'Lampe frontale' };

    expect(payloadOf(renamed, original, RACES)?.requirements).toEqual({ 'race-b': 'mandatory' });
  });
});

describe('reprendre l’édition précédente', () => {
  const PREVIOUS = [
    { id: 'old-80', name: '80 K', detail: '78 km' },
    { id: 'old-20', name: 'Le 20K', detail: '20 km' },
    { id: 'old-10', name: 'Marche', detail: '10 km' },
  ];

  it('associe par nom, sinon par distance, et dit ce qui reste sans correspondance', () => {
    const { matches, unmatched } = matchRaces(PREVIOUS, RACES);

    expect(matches.map((match) => `${match.from.id}>${match.to.id}`)).toEqual([
      'old-80>race-a',
      'old-20>race-b',
    ]);
    expect(unmatched.map((race) => race.id)).toEqual(['old-10']);
  });

  it('ajoute ce qui manque, règle ce qui existe, sans reprendre une exigence inconnue', () => {
    let counter = 0;
    const result = importPrevious(
      linesOf([ROW], RACES),
      {
        races: PREVIOUS,
        rows: [
          { ...ROW, cells: ['mandatory', 'mandatory', null] },
          {
            factKey: 'equipment.gants',
            label: 'Gants',
            condition: 'si < 5 °C',
            detail: null,
            cells: ['conditional', 'unknown', 'recommended'],
            sources: [],
          },
          { ...ROW, factKey: 'equipment.sifflet', label: 'Sifflet', cells: ['unknown', null, 'mandatory'] },
        ],
      },
      RACES,
      () => `new-${++counter}`,
    );

    expect(result.updated).toBe(1);
    expect(result.added).toBe(1);
    expect(result.lines[0]?.cells).toEqual({ 'race-a': 'mandatory', 'race-b': 'mandatory' });
    expect(result.lines[1]).toMatchObject({
      factKey: null,
      label: 'Gants',
      condition: 'si < 5 °C',
      cells: { 'race-a': 'conditional', 'race-b': null },
    });
    // Le sifflet n'avait d'exigence connue que sur la marche, sans correspondance.
    expect(result.lines).toHaveLength(2);
  });
});

describe('coller une liste', () => {
  it('un matériel par ligne, puces et numéros retirés, doublons écartés', () => {
    expect(
      pastedLabels(
        [
          '- Veste imperméable avec capuche,',
          '• Frontale + piles de rechange',
          '1. Couverture de survie',
          '2) Sifflet;',
          '',
          '   ',
          '* frontale + piles de rechange',
          'Réserve d’eau 1 L.',
        ].join('\r\n'),
      ),
    ).toEqual([
      'Veste imperméable avec capuche',
      'Frontale + piles de rechange',
      'Couverture de survie',
      'Sifflet',
      'Réserve d’eau 1 L',
    ]);
  });

  it('ne lit aucune exigence dans le texte', () => {
    expect(pastedLabels('Gants obligatoires si froid')).toEqual(['Gants obligatoires si froid']);
  });
});
