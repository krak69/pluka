import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  isParseError,
  isPdfParseError,
  parsePdfBlocks,
  parseSnapshot,
  parseSnapshotBytes,
  PDF_LIMITS,
  type ParsedBlock,
  type PdfEngine,
  type PdfParseResult,
} from '../src/index.js';

/**
 * Parsing PDF — docs/engines/SOURCES_EXTRACTION.md §13, §14, §18, §20.
 *
 * Les fixtures sont produites par `tests/fixtures/make-pdf.mjs`, committé à
 * côté d'elles : un PDF binaire ne se relit pas en revue, et un fichier hostile
 * dont personne ne peut dire *ce qui* est cassé ne prouve rien.
 *
 * Ce qui est vérifié tient en quatre points : le texte natif sort avec sa
 * provenance, le résultat est reproductible, un document qu'on ne sait pas lire
 * est refusé avec sa raison, et un document hostile ne fait rien d'autre que
 * d'être refusé.
 */

const FIXTURES = new URL('./fixtures/', import.meta.url);

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(name, FIXTURES)));
}

const REGLEMENT = fixture('reglement.pdf');

async function blocksOf(bytes: Uint8Array): Promise<readonly ParsedBlock[]> {
  return (await parsePdfBlocks(bytes)).blocks;
}

// ============================================================
// §13 — extraction du texte natif
// ============================================================

describe('extraction du texte natif', () => {
  let blocks: readonly ParsedBlock[];

  beforeAll(async () => {
    blocks = await blocksOf(REGLEMENT);
  });

  it('lit un flux compressé', async () => {
    // Les deux pages de la fixture sont en `/FlateDecode` : sans
    // décompression, aucun de ces textes n'apparaîtrait.
    const texts = blocks.map((block) => block.text);

    expect(texts).toContain('Le depart sera donne le 20 juin 2026 a 7h10 depuis Adelboden.');
    expect(texts).toContain('Le parcours mesure 70 km pour 4600 m D+.');
  });

  it('segmente les pages — §13', () => {
    const pages = [...new Set(blocks.map((block) => block.pageNumber))];

    expect(pages).toEqual([1, 2]);

    const assistance = blocks.find((block) => block.text.includes('uniquement a Lenk'));

    expect(assistance?.pageNumber).toBe(2);
  });

  it('lit les lignes de haut en bas', () => {
    // L'origine d'un PDF est en bas à gauche : un tri naïf par ordonnée
    // croissante rendrait le document à l'envers.
    const first = blocks.filter((block) => block.pageNumber === 1).map((block) => block.text);

    expect(first[0]).toBe('Reglement 2026');
    expect(first[first.length - 1]).toBe('Le parcours mesure 70 km pour 4600 m D+.');
  });

  it('reconstruit une hiérarchie de sections à partir des tailles — §18', () => {
    // Un PDF ne déclare ni `<h1>` ni `<h2>` : la hiérarchie vient des corps
    // employés, le plus grand valant le niveau 1.
    const depart = blocks.find((block) => block.text.startsWith('Le depart sera'));

    expect(depart?.sectionPath).toEqual(['Reglement 2026', 'Depart']);
    expect(depart?.heading).toBe('Depart');
    expect(depart?.blockType).toBe('paragraph');

    const titre = blocks.find((block) => block.text === 'Depart');

    // Un titre ouvre sa section, il n'est pas dedans — même règle qu'en HTML,
    // sans quoi un candidat PDF ne se comparerait pas à un candidat web.
    expect(titre?.blockType).toBe('heading');
    expect(titre?.sectionPath).toEqual(['Reglement 2026']);
  });

  it('porte de quoi revenir à la position exacte — §20', () => {
    const assistance = blocks.find((block) => block.text.includes('uniquement a Lenk'));

    expect(assistance?.locator.page).toBe(2);
    expect(assistance?.locator.lineIndex).toBe(1);
    expect(typeof assistance?.locator.x).toBe('number');
    expect(typeof assistance?.locator.y).toBe('number');
  });

  it('compte les pages et les caractères lus', async () => {
    const { info } = await parsePdfBlocks(REGLEMENT);

    expect(info.pageCount).toBe(2);
    expect(info.characterCount).toBeGreaterThan(100);
  });
});

// ============================================================
// Déterminisme
// ============================================================

describe('déterminisme', () => {
  it('produit deux fois exactement le même résultat', async () => {
    const first = await blocksOf(REGLEMENT);
    const second = await blocksOf(REGLEMENT);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('rend une empreinte de sortie reproductible', async () => {
    const first = await parseSnapshotBytes({ bytes: REGLEMENT, contentType: 'application/pdf' });
    const second = await parseSnapshotBytes({ bytes: REGLEMENT, contentType: 'application/pdf' });

    expect(second.outputHash).toBe(first.outputHash);
    expect(first.outputHash).toHaveLength(64);
  });

  it('fait entrer la position dans l’empreinte', async () => {
    // §20 : la provenance fait partie du résultat. Une empreinte qui
    // l'ignorerait ne verrait pas un parseur qui déplace ses citations.
    const { hashBlocks } = await import('../src/index.js');

    const blocks = await blocksOf(REGLEMENT);
    const moved = blocks.map((block, index) =>
      index === 0 ? { ...block, locator: { ...block.locator, page: 9 } } : block,
    );

    expect(hashBlocks(moved)).not.toBe(hashBlocks(blocks));
  });
});

// ============================================================
// §14 — ce qu'on refuse, et pourquoi
// ============================================================

describe('documents refusés', () => {
  it('refuse un PDF scanné en nommant l’OCR — §14', async () => {
    // « L'OCR n'est utilisé que si le PDF ne contient pas de texte
    // exploitable. » C'est ce cas, et l'OCR appartient à un autre lot : le
    // refus doit le dire, pas se confondre avec un document vide.
    const error = await parsePdfBlocks(fixture('scanned.pdf')).catch((thrown: unknown) => thrown);

    expect(isPdfParseError(error) && error.reason).toBe('scanned_without_text');
    expect(String((error as Error).message)).toContain('OCR');
  });

  it('refuse un document chiffré', async () => {
    const error = await parsePdfBlocks(fixture('encrypted.pdf')).catch((thrown: unknown) => thrown);

    expect(isPdfParseError(error) && error.reason).toBe('encrypted');
  });

  it('refuse un document trop volumineux sans l’ouvrir', async () => {
    // La limite s'applique aux octets reçus : on refuse avant d'appeler le
    // moteur, donc avant qu'une bombe de décompression ait la parole.
    const huge = new Uint8Array(PDF_LIMITS.maxBytes + 1);
    huge.set([0x25, 0x50, 0x44, 0x46, 0x2d]);

    let opened = false;
    const engine: PdfEngine = {
      getDocumentProxy: () => {
        opened = true;
        throw new Error('le moteur ne devrait pas être appelé');
      },
    };

    const error = await parsePdfBlocks(huge, engine).catch((thrown: unknown) => thrown);

    expect(isPdfParseError(error) && error.reason).toBe('too_large');
    expect(opened).toBe(false);
  });

  it('refuse un document déclarant trop de pages', async () => {
    const engine: PdfEngine = {
      getDocumentProxy: () =>
        Promise.resolve({
          numPages: PDF_LIMITS.maxPages + 1,
          getPage: () => Promise.resolve({ getTextContent: () => Promise.resolve({ items: [] }) }),
        }),
    };

    const error = await parsePdfBlocks(REGLEMENT, engine).catch((thrown: unknown) => thrown);

    expect(isPdfParseError(error) && error.reason).toBe('too_many_pages');
  });

  it('refuse un texte extrait démesuré', async () => {
    // Peu de pages, énormément de texte : le fichier passe la limite d'octets,
    // le contenu décompressé non.
    const line = 'x'.repeat(100_000);
    const engine: PdfEngine = {
      getDocumentProxy: () =>
        Promise.resolve({
          numPages: 60,
          getPage: () =>
            Promise.resolve({
              getTextContent: () =>
                Promise.resolve({
                  items: Array.from({ length: 10 }, (_, index) => ({
                    str: line,
                    height: 12,
                    transform: [1, 0, 0, 1, 72, 700 - index * 14],
                  })),
                }),
            }),
        }),
    };

    const error = await parsePdfBlocks(REGLEMENT, engine).catch((thrown: unknown) => thrown);

    expect(isPdfParseError(error) && error.reason).toBe('too_large');
  });

  it('rend un document illisible plutôt que de lever une erreur brute', async () => {
    const error = await parsePdfBlocks(new Uint8Array([1, 2, 3, 4])).catch(
      (thrown: unknown) => thrown,
    );

    expect(isPdfParseError(error) && error.reason).toBe('unreadable');
  });
});

// ============================================================
// Sécurité : un PDF est un format hostile
// ============================================================

describe('documents hostiles', () => {
  const dlopened: string[] = [];
  const original = process.dlopen;

  beforeAll(() => {
    process.dlopen = ((module: unknown, filename: string, flags?: number) => {
      dlopened.push(filename);
      return (original as (...args: unknown[]) => unknown).call(process, module, filename, flags);
    }) as typeof process.dlopen;
  });

  afterAll(() => {
    process.dlopen = original;
  });

  it('n’exécute jamais le JavaScript embarqué', async () => {
    // La fixture porte `/OpenAction` et une entrée `/JavaScript` qui poserait
    // `globalThis.PWNED`. Extraire du texte n'interprète rien de tout cela.
    const before = (globalThis as Record<string, unknown>).PWNED;
    const blocks = await blocksOf(fixture('javascript.pdf'));

    expect((globalThis as Record<string, unknown>).PWNED).toBe(before);
    // Et le texte du document est bien lu : on ne le refuse pas par principe.
    expect(blocks.map((block) => block.text).join(' ')).toContain('Iffigenalp');
  });

  it('survit à une table xref mensongère', async () => {
    // §13 ne dit rien des documents cassés, mais le web en est plein. PDF.js
    // reconstruit ce qu'il peut ; ce qui compte est qu'on n'invente rien.
    const blocks = await blocksOf(fixture('broken-xref.pdf'));

    expect(blocks.map((block) => block.text)).toContain('Ravitaillement a Lenk');
  });

  it('refuse un flux tronqué sans planter', async () => {
    const truncated = REGLEMENT.slice(0, Math.floor(REGLEMENT.length / 2));
    const outcome = await parsePdfBlocks(truncated).catch((thrown: unknown) => thrown);

    // Lisible partiellement ou refusé proprement : les deux conviennent. Ce
    // qui ne conviendrait pas est une exception non typée.
    if (outcome instanceof Error) expect(isPdfParseError(outcome)).toBe(true);
    else expect(Array.isArray((outcome as PdfParseResult).blocks)).toBe(true);
  });

  it('ne charge aucun binaire natif', () => {
    // Le critère « absence de dépendance native » se vérifie à l'exécution :
    // `pdfjs-dist` chargeait `@napi-rs/canvas` dès l'import, `unpdf` non.
    expect(dlopened).toEqual([]);
  });
});

// ============================================================
// Frontière avec le reste du parsing
// ============================================================

describe('aiguillage', () => {
  it('reconnaît un PDF à sa signature, sans type déclaré', async () => {
    const parsed = await parseSnapshotBytes({ bytes: REGLEMENT, contentType: null });

    expect(parsed.blocks.length).toBeGreaterThan(0);
    expect(parsed.parserVersion).toBe('parser-1.1.0');
  });

  it('refuse un PDF par le chemin texte', () => {
    // Décoder un PDF en UTF-8 produirait du bruit présenté comme un document.
    const error = (() => {
      try {
        parseSnapshot({ content: '%PDF-1.7 ...', contentType: 'application/pdf' });
        return null;
      } catch (thrown) {
        return thrown;
      }
    })();

    expect(isParseError(error) && error.reason).toBe('unsupported_content_type');
  });

  it('traduit les refus PDF dans le vocabulaire du parsing', async () => {
    const scanned = await parseSnapshotBytes({
      bytes: fixture('scanned.pdf'),
      contentType: 'application/pdf',
    }).catch((thrown: unknown) => thrown);

    expect(isParseError(scanned) && scanned.reason).toBe('scanned_without_text');

    const encrypted = await parseSnapshotBytes({
      bytes: fixture('encrypted.pdf'),
      contentType: 'application/pdf',
    }).catch((thrown: unknown) => thrown);

    expect(isParseError(encrypted) && encrypted.reason).toBe('encrypted_document');
  });

  it('laisse passer le HTML et le texte par le même point d’entrée', async () => {
    const html = await parseSnapshotBytes({
      bytes: new TextEncoder().encode('<html><body><p>Départ à 7h10</p></body></html>'),
      contentType: 'text/html',
    });

    expect(html.blocks[0]?.text).toBe('Départ à 7h10');
  });

  it('refuse un document vide', async () => {
    const error = await parseSnapshotBytes({ bytes: new Uint8Array(), contentType: null }).catch(
      (thrown: unknown) => thrown,
    );

    expect(isParseError(error) && error.reason).toBe('empty_document');
  });
});

// ============================================================
// Recollage des fragments
// ============================================================

describe('recollage des fragments', () => {
  /** PDF.js rend un fragment par changement de style : il faut les recoller. */
  function fragmentEngine(fragments: readonly string[]): PdfEngine {
    return {
      getDocumentProxy: () =>
        Promise.resolve({
          numPages: 1,
          getPage: () =>
            Promise.resolve({
              getTextContent: () =>
                Promise.resolve({
                  items: fragments.map((str, index) => ({
                    str,
                    height: 12,
                    transform: [1, 0, 0, 1, 72 + index * 40, 700],
                  })),
                }),
            }),
        }),
    };
  }

  it('n’ajoute pas d’espace là où il y en a déjà un', async () => {
    const { blocks } = await parsePdfBlocks(
      REGLEMENT,
      fragmentEngine(['Assistance ', 'autorisée ', 'à Lenk']),
    );

    expect(blocks[0]?.text).toBe('Assistance autorisée à Lenk');
  });

  it('en ajoute un entre deux fragments qui se toucheraient', async () => {
    const { blocks } = await parsePdfBlocks(
      REGLEMENT,
      fragmentEngine(['Barrière', 'horaire', '16h20']),
    );

    expect(blocks[0]?.text).toBe('Barrière horaire 16h20');
  });

  it('groupe par ligne malgré un décalage de ligne de base', async () => {
    // Un exposant décale la ligne de base d'une fraction de point : le séparer
    // couperait la phrase en deux blocks.
    const engine: PdfEngine = {
      getDocumentProxy: () =>
        Promise.resolve({
          numPages: 1,
          getPage: () =>
            Promise.resolve({
              getTextContent: () =>
                Promise.resolve({
                  items: [
                    { str: 'Altitude', height: 12, transform: [1, 0, 0, 1, 72, 700] },
                    { str: '2500 m', height: 12, transform: [1, 0, 0, 1, 130, 700.4] },
                    { str: 'Ligne suivante', height: 12, transform: [1, 0, 0, 1, 72, 686] },
                  ],
                }),
            }),
        }),
    };

    const { blocks } = await parsePdfBlocks(REGLEMENT, engine);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.text).toBe('Altitude 2500 m');
  });

  it('reconnaît une puce comme une liste — §18', async () => {
    const { blocks } = await parsePdfBlocks(
      REGLEMENT,
      fragmentEngine(['- Veste imperméable obligatoire']),
    );

    expect(blocks[0]?.blockType).toBe('list');
  });
});

// ============================================================
// Provenance de la fixture
// ============================================================

describe('fixtures', () => {
  it('sont bien les documents que le générateur décrit', () => {
    // Un PDF committé ne se relit pas : ce test vérifie au moins qu'il s'agit
    // d'un PDF, et que les variantes hostiles portent ce qui les rend hostiles.
    const header = (bytes: Uint8Array): string => new TextDecoder().decode(bytes.slice(0, 5));

    for (const name of [
      'reglement.pdf',
      'scanned.pdf',
      'encrypted.pdf',
      'javascript.pdf',
      'broken-xref.pdf',
    ]) {
      expect(header(fixture(name)), name).toBe('%PDF-');
    }

    const text = (name: string): string => new TextDecoder('latin1').decode(fixture(name));

    expect(text('encrypted.pdf')).toContain('/Encrypt');
    expect(text('javascript.pdf')).toContain('/JavaScript');
    expect(text('reglement.pdf')).toContain('/FlateDecode');
    expect(deflateSync(Buffer.from('x')).length).toBeGreaterThan(0);
  });
});
