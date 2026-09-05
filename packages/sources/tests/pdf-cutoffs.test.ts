import { readFileSync } from 'node:fs';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  chunkBlocks,
  extractDeterministic,
  parsePdfBlocks,
  parseSnapshot,
  type ExtractedCandidate,
  type ParsedBlock,
  type PdfEngine,
} from '../src/index.js';

/**
 * Barrières horaires lues depuis un PDF — §84, §13, §29.
 *
 * §84 : « une barrière doit conserver : waypoint ; horaire ; basis si
 * disponible ». L'extracteur déterministe sait le faire depuis un tableau
 * HTML. Ce fichier vérifie qu'il le fait aussi bien depuis un PDF, **sans le
 * savoir** : il lit des cellules indexées par tableau et par ligne, et c'est
 * au parseur de les lui fournir quel que soit le format.
 *
 * C'est là que se joue §13, « détection tableaux / blocs lorsque possible » :
 * un PDF ne déclare aucun tableau, il pose du texte à des coordonnées. Sans
 * détection des colonnes, la ligne arriverait en paragraphe — « Iffigenalp
 * 32 km 16h20 » — et §84 ne trouverait rien là où il trouve tout en HTML.
 *
 * Le document HTML de comparaison porte exactement le même texte que le PDF :
 * ce qu'on veut mesurer est l'écart dû au format, pas au contenu.
 */

const BARRIERES_PDF = new Uint8Array(
  readFileSync(new URL('./fixtures/barrieres.pdf', import.meta.url)),
);

/** Le même règlement, en HTML : mêmes mots, mêmes valeurs, autre format. */
const BARRIERES_HTML = `<html><body>
  <main>
    <h1>Reglement 2026</h1>
    <h2>Assistance</h2>
    <p>L'assistance personnelle est autorisee uniquement a Lenk.</p>
    <h2>Barrieres horaires</h2>
    <table>
      <tr><th>Point</th><th>Distance</th><th>Barriere (arrivee)</th></tr>
      <tr><td>Iffigenalp</td><td>32 km</td><td>16h20</td></tr>
      <tr><td>Adelboden</td><td>58 km</td><td>21h45</td></tr>
    </table>
    <p>Tout coureur hors barriere est mis hors course.</p>
  </main>
</body></html>`;

function cutoffsOf(blocks: readonly ParsedBlock[]): readonly ExtractedCandidate[] {
  const { candidates } = extractDeterministic({ blocks, chunks: chunkBlocks(blocks) });

  return candidates.filter((candidate) => candidate.factType === 'cutoff');
}

/** Ce qu'une barrière est, indépendamment du format dont elle vient. */
function essence(candidate: ExtractedCandidate): Record<string, unknown> {
  return {
    factKey: candidate.factKey,
    valueText: candidate.valueText,
    context: candidate.context,
    waypoint: candidate.valueJson?.waypoint,
    basis: candidate.valueJson?.basis,
    reviewState: candidate.reviewState,
    origin: candidate.origin,
    confidence: candidate.confidence,
  };
}

let pdfBlocks: readonly ParsedBlock[];
let htmlBlocks: readonly ParsedBlock[];

beforeAll(async () => {
  pdfBlocks = (await parsePdfBlocks(BARRIERES_PDF)).blocks;
  htmlBlocks = parseSnapshot({ content: BARRIERES_HTML, contentType: 'text/html' }).blocks;
});

// ============================================================
// §13 — le tableau existe, alors qu'aucune balise ne le dit
// ============================================================

describe('détection du tableau', () => {
  it('produit une cellule par colonne, indexée comme en HTML', () => {
    const cells = pdfBlocks.filter((block) => block.blockType === 'table');

    // Trois colonnes sur trois lignes : en-tête plus deux barrières.
    expect(cells).toHaveLength(9);
    expect(cells.map((cell) => cell.text)).toEqual([
      'Point',
      'Distance',
      'Barriere (arrivee)',
      'Iffigenalp',
      '32 km',
      '16h20',
      'Adelboden',
      '58 km',
      '21h45',
    ]);
  });

  it('ne transforme pas la prose en tableau', () => {
    // La prudence est le point : une phrase justifiée ne doit pas devenir un
    // tableau, sans quoi §84 lirait des barrières partout.
    const phrase = pdfBlocks.find((block) => block.text.startsWith('Tout coureur'));

    expect(phrase?.blockType).toBe('paragraph');

    const assistance = pdfBlocks.find((block) => block.text.includes('uniquement a Lenk'));

    expect(assistance?.blockType).toBe('paragraph');
  });

  it('ne prend pas de la prose fragmentée pour un tableau', async () => {
    // Un vrai générateur découpe une phrase en fragments — un par changement
    // de style, parfois un par mot. Sans exigence de gouttière, chacun
    // deviendrait une cellule et la prose entière un tableau.
    //
    // La fixture committée ne le montre pas : elle pose une ligne par `Tj`,
    // donc un fragment par ligne. Ce moteur simulé reproduit le cas réel.
    const words = "L'assistance personnelle est autorisee uniquement a Lenk".split(' ');

    const engine: PdfEngine = {
      getDocumentProxy: () =>
        Promise.resolve({
          numPages: 1,
          getPage: () =>
            Promise.resolve({
              getTextContent: () =>
                Promise.resolve({
                  items: [0, 1].flatMap((row) => {
                    // Avances cumulées, comme un générateur les calcule : un
                    // mot commence là où le précédent finit, plus une espace.
                    let x = 72;

                    return words.map((word) => {
                      const width = word.length * 5;
                      const item = {
                        str: word,
                        height: 12,
                        width,
                        transform: [1, 0, 0, 1, x, 700 - row * 14],
                      };

                      x += width + 2.5;

                      return item;
                    });
                  }),
                }),
            }),
        }),
    };

    const { blocks } = await parsePdfBlocks(BARRIERES_PDF, engine);

    expect(blocks.every((block) => block.blockType !== 'table')).toBe(true);
    expect(blocks[0]?.text).toContain('assistance personnelle');
  });

  it('ne relie pas deux lignes dont les colonnes ne s’alignent pas', async () => {
    // Deux lignes à colonnes décalées ne forment pas un tableau : ce sont deux
    // lignes de mise en page qui se ressemblent par hasard.
    const engine: PdfEngine = {
      getDocumentProxy: () =>
        Promise.resolve({
          numPages: 1,
          getPage: () =>
            Promise.resolve({
              getTextContent: () =>
                Promise.resolve({
                  items: [
                    { str: 'Depart', height: 12, width: 40, transform: [1, 0, 0, 1, 72, 700] },
                    { str: '07h10', height: 12, width: 30, transform: [1, 0, 0, 1, 300, 700] },
                    { str: 'Arrivee', height: 12, width: 40, transform: [1, 0, 0, 1, 72, 686] },
                    // Décalée de 140 points : bien au-delà de la tolérance.
                    { str: '18h00', height: 12, width: 30, transform: [1, 0, 0, 1, 440, 686] },
                  ],
                }),
            }),
        }),
    };

    const { blocks } = await parsePdfBlocks(BARRIERES_PDF, engine);

    expect(blocks.every((block) => block.blockType !== 'table')).toBe(true);
  });

  it('ne prend pas une ligne de tableau pour un titre', () => {
    const cells = pdfBlocks.filter((block) => block.blockType === 'table');

    expect(cells.every((cell) => cell.heading === 'Barrieres horaires')).toBe(true);
  });
});

// ============================================================
// §84 — les mêmes barrières, quel que soit le format
// ============================================================

describe('extraction des barrières', () => {
  it('lit depuis le PDF exactement ce qu’elle lit depuis le HTML', () => {
    const fromPdf = cutoffsOf(pdfBlocks).map(essence);
    const fromHtml = cutoffsOf(htmlBlocks).map(essence);

    expect(fromPdf).toEqual(fromHtml);
  });

  it('conserve waypoint, horaire et basis — §84', () => {
    const cutoffs = cutoffsOf(pdfBlocks);

    expect(cutoffs.map((candidate) => candidate.factKey)).toEqual([
      'cutoff/iffigenalp/arrival',
      'cutoff/adelboden/arrival',
    ]);

    const iffigenalp = cutoffs[0];

    expect(iffigenalp?.valueText).toBe('16:20');
    expect(iffigenalp?.valueJson?.waypoint).toBe('Iffigenalp');
    // La base vient de l'en-tête de colonne « Barriere (arrivee) », lue dans
    // le PDF comme elle l'est dans le HTML.
    expect(iffigenalp?.valueJson?.basis).toBe('arrival');
    expect(iffigenalp?.context).toBe('arrival');
    expect(iffigenalp?.reviewState).toBe('detected');
  });

  it('normalise l’horaire sans perdre la valeur écrite — §80', () => {
    const cutoffs = cutoffsOf(pdfBlocks);

    expect(cutoffs[1]?.valueText).toBe('21:45');
    expect(cutoffs[1]?.valueJson?.raw).toBe('21h45');
    expect(cutoffs[1]?.evidence[0]?.excerpt).toBe('21h45');
  });

  it('n’invente pas la base quand l’en-tête ne la donne pas — §84', async () => {
    // Même document, en-tête neutre : la barrière sort incomplète et marquée à
    // revoir, exactement comme dans le HTML équivalent.
    const neutralHtml = BARRIERES_HTML.replace('Barriere (arrivee)', 'Barriere');
    const neutral = parseSnapshot({ content: neutralHtml, contentType: 'text/html' }).blocks;
    const cutoff = cutoffsOf(neutral)[0];

    expect(cutoff?.context).toBeNull();
    expect(cutoff?.reviewState).toBe('needs_review');
    expect(cutoff?.notes).toContain('§84');
  });
});

// ============================================================
// §20 — la provenance, dans la forme que chaque format permet
// ============================================================

describe('provenance des barrières', () => {
  it('porte la page où le tableau se trouve', () => {
    // Le tableau est en page 2 de la fixture : une page unique ne prouverait
    // rien. Le HTML, lui, n'a pas de pages — et n'en invente pas.
    const fromPdf = cutoffsOf(pdfBlocks)[0]?.evidence[0];
    const fromHtml = cutoffsOf(htmlBlocks)[0]?.evidence[0];

    expect(fromPdf?.pageNumber).toBe(2);
    expect(fromHtml?.pageNumber).toBeNull();
  });

  it('situe la cellule dans son tableau, comme le HTML', () => {
    // §84 a besoin de ces deux index pour reconstituer une ligne. Ils portent
    // le même sens dans les deux formats — c'est ce qui rend l'extracteur
    // indifférent au format.
    const fromPdf = cutoffsOf(pdfBlocks)[0]?.evidence[0]?.locator;
    const fromHtml = cutoffsOf(htmlBlocks)[0]?.evidence[0]?.locator;

    expect(fromPdf?.tableIndex).toBe(0);
    expect(fromPdf?.rowIndex).toBe(1);
    expect(fromHtml?.tableIndex).toBe(0);
    expect(fromHtml?.rowIndex).toBe(1);
  });

  it('ajoute les coordonnées que seul un PDF possède', () => {
    // Elles permettent de surligner la cellule dans le document d'origine ;
    // un sélecteur CSS joue ce rôle en HTML, et l'un n'a pas à imiter l'autre.
    const fromPdf = cutoffsOf(pdfBlocks)[0]?.evidence[0]?.locator;
    const fromHtml = cutoffsOf(htmlBlocks)[0]?.evidence[0]?.locator;

    expect(fromPdf?.page).toBe(2);
    expect(typeof fromPdf?.x).toBe('number');
    expect(typeof fromPdf?.y).toBe('number');
    expect(fromPdf?.cssSelector).toBeUndefined();

    expect(fromHtml?.cssSelector).toBe('td');
    expect(fromHtml?.x).toBeUndefined();
  });

  it('rattache la barrière à sa section', () => {
    const fromPdf = cutoffsOf(pdfBlocks)[0]?.evidence[0];
    const fromHtml = cutoffsOf(htmlBlocks)[0]?.evidence[0];

    expect(fromPdf?.sectionPath).toEqual(['Reglement 2026', 'Barrieres horaires']);
    expect(fromHtml?.sectionPath).toEqual(['Reglement 2026', 'Barrieres horaires']);
  });

  it('cite le nom du point en preuve secondaire', () => {
    // §84 veut le waypoint : la cellule qui le porte est une preuve, distincte
    // de celle qui porte l'horaire.
    const evidence = cutoffsOf(pdfBlocks)[0]?.evidence ?? [];

    expect(evidence).toHaveLength(2);
    expect(evidence[0]?.isPrimary).toBe(true);
    expect(evidence[1]?.excerpt).toBe('Iffigenalp');
    expect(evidence[1]?.isPrimary).toBe(false);
  });
});

// ============================================================
// Déterminisme
// ============================================================

describe('déterminisme', () => {
  it('rend deux fois les mêmes barrières', async () => {
    const again = (await parsePdfBlocks(BARRIERES_PDF)).blocks;

    expect(JSON.stringify(cutoffsOf(again))).toBe(JSON.stringify(cutoffsOf(pdfBlocks)));
  });
});
