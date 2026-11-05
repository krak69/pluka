import { describe, expect, it } from 'vitest';

import {
  decodeFile,
  judgeRows,
  parseParticipantFile,
  suggestColumns,
} from '../src/index.js';

/** L'import d'une liste — 00_PRODUCT_SPEC §29.1, AC-B2B-PART-01 à 03. */

const RACE = { id: 'aaaaaaaa-0000-4000-8000-000000000013', name: 'Les 5 clochers', slug: 'les-5-clochers' };
const OTHER = { id: 'aaaaaaaa-0000-4000-8000-000000000014', name: '10 km', slug: '10-km' };

const COLUMNS = { firstName: 'Prénom', lastName: 'Nom', email: 'Email', race: 'Course' };

const row = (data: Record<string, string>, rowNumber = 1) => ({
  rowNumber,
  data: { Prénom: 'Anna', Nom: 'Martin', Email: 'anna@test.pluka', Course: '10 km', ...data },
});

describe('lire le fichier', () => {
  it('lit le point-virgule d’Excel, et les accents de Windows-1252', () => {
    const bytes = Uint8Array.from([
      0x50, 0x72, 0xe9, 0x6e, 0x6f, 0x6d, 0x3b, 0x4e, 0x6f, 0x6d, 0x0d, 0x0a,
      0x4c, 0xe9, 0x61, 0x3b, 0x4d, 0x61, 0x72, 0x74, 0x69, 0x6e,
    ]);

    expect(parseParticipantFile(decodeFile(bytes))).toEqual({
      headers: ['Prénom', 'Nom'],
      rows: [{ Prénom: 'Léa', Nom: 'Martin' }],
    });
  });

  it('retire la marque UTF-8 du début', () => {
    expect(decodeFile(new TextEncoder().encode('﻿Nom'))).toBe('Nom');
  });

  it('garde les séparateurs et les retours à la ligne entre guillemets', () => {
    const parsed = parseParticipantFile('Nom,Ville\n"Martin, Anna","Saint\nÉtienne"\n');

    expect(parsed.rows).toEqual([{ Nom: 'Martin, Anna', Ville: 'Saint\nÉtienne' }]);
  });

  it('ignore les lignes vides, et ne laisse pas une colonne en écraser une autre', () => {
    const parsed = parseParticipantFile('Nom;Nom\nA;B\n;\n');

    expect(parsed.headers).toEqual(['Nom', 'Nom (2)']);
    expect(parsed.rows).toHaveLength(1);
  });
});

describe('proposer les colonnes', () => {
  it('reconnaît les intitulés français, accents et casse compris', () => {
    expect(
      suggestColumns(['PRÉNOM', 'Nom', 'Courriel', 'Date de naissance', 'Dossard', 'Index ITRA']),
    ).toMatchObject({
      firstName: 'PRÉNOM',
      lastName: 'Nom',
      email: 'Courriel',
      birthDate: 'Date de naissance',
      bib: 'Dossard',
      itraIndex: 'Index ITRA',
    });
  });

  it('ne range pas une colonne deux fois', () => {
    const columns = suggestColumns(['Nom']);

    expect(Object.values(columns)).toEqual(['Nom']);
  });
});

describe('juger les lignes', () => {
  it('une ligne complète est valide, et l’adresse en minuscules', () => {
    const [judged] = judgeRows([row({ Email: 'ANNA@test.pluka' })], COLUMNS, [RACE, OTHER]);

    expect(judged).toMatchObject({
      status: 'valid',
      mapped: { raceId: OTHER.id, email: 'anna@test.pluka', firstName: 'Anna' },
    });
  });

  it('reconnaît l’épreuve sans les accents ni la casse', () => {
    const [judged] = judgeRows([row({ Course: 'LES 5 CLOCHERS' })], COLUMNS, [RACE, OTHER]);

    expect(judged?.mapped?.['raceId']).toBe(RACE.id);
  });

  it('une seule épreuve dans l’édition : la colonne n’est pas nécessaire', () => {
    const [judged] = judgeRows(
      [row({})],
      { firstName: 'Prénom', lastName: 'Nom', email: 'Email' },
      [RACE],
    );

    expect(judged?.mapped?.['raceId']).toBe(RACE.id);
  });

  it('dit pourquoi une ligne est refusée, sans arrêter les autres', () => {
    const judged = judgeRows(
      [
        row({ Email: 'pas-une-adresse' }, 1),
        row({ Nom: '' }, 2),
        row({ Course: 'Inconnue' }, 3),
        row({}, 4),
      ],
      COLUMNS,
      [RACE, OTHER],
    );

    expect(judged.map((item) => item.error)).toEqual([
      'Adresse e-mail invalide.',
      'Prénom ou nom manquant.',
      'Épreuve inconnue : Inconnue.',
      null,
    ]);
  });

  it('écarte un doublon du fichier, mais pas la même adresse sur une autre épreuve', () => {
    const judged = judgeRows(
      [row({}, 1), row({}, 2), row({ Course: 'Les 5 clochers' }, 3)],
      COLUMNS,
      [RACE, OTHER],
    );

    expect(judged.map((item) => item.status)).toEqual(['valid', 'skipped', 'valid']);
  });

  it('lit les champs facultatifs, ITRA et UTMB chacun de leur côté', () => {
    const columns = {
      ...COLUMNS,
      sex: 'Sexe',
      birthDate: 'Né le',
      itraIndex: 'ITRA',
      utmbIndex: 'UTMB',
    };
    const [judged] = judgeRows(
      [row({ Sexe: 'F', 'Né le': '01/05/1990', ITRA: '610', UTMB: '590,5' })],
      columns,
      [RACE, OTHER],
    );

    expect(judged?.mapped).toMatchObject({
      sex: 'female',
      birthDate: '1990-05-01',
      itraIndex: 610,
      utmbIndex: 590.5,
    });
  });

  it('refuse une date qui n’existe pas, sans en inventer une', () => {
    const [judged] = judgeRows(
      [row({ 'Né le': '31/02/1990' })],
      { ...COLUMNS, birthDate: 'Né le' },
      [RACE, OTHER],
    );

    expect(judged?.status).toBe('error');
  });
});
