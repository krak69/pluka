import { DbError, type NutritionCatalogueRepository, type NutritionProductInput } from '@pluka/db';
import { describe, expect, it } from 'vitest';

import {
  DomainError,
  importNutritionCatalogue,
  parseCsv,
  readNutritionCatalogueCsv,
  saveNutritionProduct,
  type NutritionCatalogueContext,
} from '../src/index.js';

/**
 * Catalogue Nutrition — migration 0039. Les contraintes et l'idempotence de
 * l'import sont prouvées en base (pgTAP 27) ; ici, la lecture du CSV et la
 * validation d'une fiche.
 */

const HEADER =
  'Type;Marque;Nom;Saveur;Poids (g);Image URL;Lien achat;Kcal;Glucides (g);Sodium (mg);Potassium (mg);Magnésium (mg);Caféine (mg);Protéines (g);Lipides (g);Fibres (g);Texture;Ratio glucose/fructose;Vegan;Bio;Sans gluten;Tags;Statut;Vérifié';

function csv(...lines: string[]): string {
  return `﻿${[HEADER, ...lines].join('\r\n')}\r\n`;
}

const GOMME =
  'Gummies;Ta Energy;Gomme énergétique;Tropical;30;https://exemple.test/g.png;https://exemple.test/acheter;101;25;114;55;;100;0,1;0.1;0.33;gomme;;Oui;Non;Oui;"Caféiné, Riche en glucides, Performance";verified;Oui';

describe('lecture du CSV', () => {
  it('gère le BOM, le point-virgule, les guillemets et les guillemets doublés', () => {
    expect(parseCsv('﻿a;b\r\n"x;y";"il ""dit"""\r\n')).toEqual([
      ['a', 'b'],
      ['x;y', 'il "dit"'],
    ]);
  });

  it('traduit une ligne nutra.run en fiche PLUKA', () => {
    const { rows } = readNutritionCatalogueCsv(csv(GOMME));
    const product = rows[0]?.product;

    expect(product).toMatchObject({
      category: 'chew',
      brand: 'Ta Energy',
      variant: 'Tropical',
      servingQuantity: 30,
      servingUnit: 'g',
      carbsG: 25,
      caffeineMg: 100,
      proteinG: 0.1,
      magnesiumMg: null,
      texture: 'chewy',
      isVegan: true,
      isOrganic: false,
      status: 'validated',
      purchaseIsAffiliate: false,
    });
  });

  it('ne garde que les tags de faits, et dit ce qu’il écarte', () => {
    const [row] = readNutritionCatalogueCsv(csv(GOMME)).rows;

    expect(row?.product?.tags).toEqual(['Caféiné', 'Riche en glucides']);
    expect(row?.warnings).toEqual(['tag « Performance » écarté : seuls des faits sont admis']);
  });

  it('reconnaît « Boisson d’effort » malgré l’apostrophe, et « Electrolyte » sans accent', () => {
    const { rows } = readNutritionCatalogueCsv(
      csv(
        "Boisson d'effort;Maurten;Drink Mix 160;Neutre;40;;;160;39;206;;;0;0;0;0;liquide;;Oui;Non;Oui;;verified;Oui",
        'Electrolyte;Precision;PH 1500;Neutre;10;;;0;0;750;;;0;0;0;0;liquide;;Oui;Non;Oui;;verified;Oui',
      ),
    );

    expect(rows.map((row) => row.product?.category)).toEqual(['drink', 'electrolyte']);
  });

  it('rejette une valeur lue par le moteur quand elle manque — jamais un 0 inventé', () => {
    const [row] = readNutritionCatalogueCsv(
      csv(
        'Capsule;Decathlon;Capsule de Sel;Neutre;0.82;;;0;;118;;;0;0;0;0;solide;;Oui;Non;Oui;;verified;Oui',
      ),
    ).rows;

    expect(row?.product).toBeNull();
    expect(row?.reasons).toEqual(['glucides manquants']);
  });

  it('refuse un lien qui n’est pas en https', () => {
    const [row] = readNutritionCatalogueCsv(
      csv(
        'Gel;GU;Gel;Fraise;32;http://exemple.test/x.png;;100;22;60;;;0;0;0;0;gel;;Oui;Non;Oui;;verified;Oui',
      ),
    ).rows;

    expect(row?.product).toBeNull();
    expect(row?.reasons[0]).toContain('imageUrl');
  });
});

function contextWith(overrides: Partial<NutritionCatalogueRepository> = {}) {
  const imported: NutritionProductInput[][] = [];
  const nutritionCatalogue: NutritionCatalogueRepository = {
    list: () => Promise.resolve([]),
    counts: () => Promise.resolve({ draft: 0, validated: 0, archived: 0 }),
    get: () => Promise.resolve(null),
    save: () => Promise.resolve('p-1'),
    importMany: (products) => {
      imported.push([...products]);
      return Promise.resolve({ created: products.length, updated: 0 });
    },
    remove: () => Promise.resolve(),
    ...overrides,
  };
  const context: NutritionCatalogueContext = {
    repositories: { nutritionCatalogue },
    actor: { userId: 'u-1' },
  };
  return { context, imported };
}

describe('import', () => {
  it('envoie les lignes valides, rend les rejets avec leur ligne', async () => {
    const { context, imported } = contextWith();

    const report = await importNutritionCatalogue(context, {
      csv: csv(GOMME, 'Gel;GU;Gel;;32;;;100;;60;;;0;0;0;0;gel;;Oui;Non;Oui;;verified;Oui'),
    });

    expect(imported[0]).toHaveLength(1);
    expect(report.created).toBe(1);
    expect(report.rejected).toEqual([{ line: 3, name: 'Gel', reasons: ['glucides manquants'] }]);
  });

  it('rejette la seconde ligne d’une même fiche dans le fichier', async () => {
    const { context, imported } = contextWith();

    const report = await importNutritionCatalogue(context, { csv: csv(GOMME, GOMME) });

    expect(imported[0]).toHaveLength(1);
    expect(report.rejected[0]?.reasons).toEqual(['doublon d’une ligne précédente du fichier']);
  });

  it('refuse un fichier sans les colonnes du moteur', async () => {
    const error = await importNutritionCatalogue(contextWith().context, {
      csv: 'Nom;Marque\nGel;GU\n',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).details['csv']).toContain('type');
  });
});

describe('enregistrer une fiche', () => {
  it('un doublon de marque, nom et saveur revient contre le nom', async () => {
    const { context } = contextWith({
      save: () =>
        Promise.reject(new DbError({ code: 'conflict', operation: 'x', message: 'doublon' })),
    });

    const [row] = readNutritionCatalogueCsv(csv(GOMME)).rows;
    const error = await saveNutritionProduct(context, {
      productId: null,
      product: row?.product,
    }).catch((caught: unknown) => caught);

    expect((error as DomainError).details['name']).toContain('existe déjà');
  });
});
