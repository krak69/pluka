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

  it('lit la date d’inscription, et ne garde que le jour quand l’heure est jointe', () => {
    const columns = { ...COLUMNS, registeredOn: 'Inscrit le' };
    const judged = judgeRows(
      [
        row({ 'Inscrit le': '01/03/2026' }, 1),
        row({ 'Inscrit le': '02/03/2026 14:35', Course: 'Les 5 clochers' }, 2),
        row({ 'Inscrit le': '2026-03-03T23:10:00+01:00', Email: 'autre@test.pluka' }, 3),
      ],
      columns,
      [RACE, OTHER],
    );

    expect(judged.map((item) => item.mapped?.['registeredOn'])).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
    ]);
  });

  it('refuse une date d’inscription illisible plutôt que de la deviner', () => {
    const [judged] = judgeRows(
      [row({ 'Inscrit le': 'mars 2026' })],
      { ...COLUMNS, registeredOn: 'Inscrit le' },
      [RACE, OTHER],
    );

    expect(judged).toMatchObject({
      status: 'error',
      error: 'Date d’inscription illisible : mars 2026.',
    });
  });
});

describe('option PLUKA vendue à l’inscription (canal B)', () => {
  const columns = { ...COLUMNS, partnerSale: 'Option', externalReference: 'Commande' };

  it('lit l’option et sa référence', () => {
    const judged = judgeRows(
      [
        row({ Option: 'Oui', Commande: 'CMD-001' }, 1),
        row({ Option: 'non', Commande: 'CMD-002', Email: 'b@test.pluka' }, 2),
      ],
      columns,
      [RACE, OTHER],
    );

    expect(judged[0]?.mapped).toMatchObject({ partnerSale: 'yes', externalReference: 'CMD-001' });
    expect(judged[1]?.mapped?.['partnerSale']).toBeUndefined();
    expect(judged[1]?.mapped?.['externalReference']).toBe('CMD-002');
  });

  it('refuse une option achetée sans référence : le rejeu ne pourrait pas se dédoublonner', () => {
    const [judged] = judgeRows([row({ Option: 'x', Commande: '' })], columns, [RACE, OTHER]);

    expect(judged).toMatchObject({
      status: 'error',
      error: 'Référence manquante pour l’option PLUKA.',
    });
  });

  it('refuse une valeur d’option qu’il faudrait deviner', () => {
    const [judged] = judgeRows([row({ Option: 'peut-être', Commande: 'C1' })], columns, [
      RACE,
      OTHER,
    ]);

    expect(judged?.error).toBe('Option PLUKA non reconnue : peut-être.');
  });

  it('propose les colonnes, sans prendre un numéro de commande pour un dossard', () => {
    expect(
      suggestColumns(['Prénom', 'Nom', 'Email', 'Numéro de commande', 'Option PLUKA', 'Dossard']),
    ).toMatchObject({
      externalReference: 'Numéro de commande',
      partnerSale: 'Option PLUKA',
      bib: 'Dossard',
    });
  });

  it('ne prend pas une date de commande pour une référence', () => {
    expect(suggestColumns(['Prénom', 'Nom', 'Email', 'Date de commande']).externalReference).toBeUndefined();
  });
});

describe('proposer la colonne de date d’inscription', () => {
  it('reconnaît la date d’inscription sans la confondre avec la naissance', () => {
    expect(
      suggestColumns(['Prénom', 'Nom', 'Email', 'Date de naissance', "Date d'inscription"]),
    ).toMatchObject({ birthDate: 'Date de naissance', registeredOn: "Date d'inscription" });
  });

  it('ne prend pas un numéro d’inscription pour une date', () => {
    expect(suggestColumns(['Prénom', 'Nom', 'Email', 'N° inscription']).registeredOn).toBeUndefined();
  });
});
