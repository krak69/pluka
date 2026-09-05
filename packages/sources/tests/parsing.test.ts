import { describe, expect, it } from 'vitest';

import {
  CHUNKER_VERSION,
  chunkBlocks,
  hashBlocks,
  isParsableContentType,
  PARSER_VERSION,
  ParseError,
  parseHtmlBlocks,
  parseSnapshot,
  parseTextBlocks,
} from '../src/index.js';

/**
 * Étape 2 : parsing et chunking.
 *
 * Deux propriétés dominent : le **déterminisme** — re-parser un snapshot
 * inchangé rend exactement le même résultat — et la **provenance** — chaque
 * block sait où il était dans le document d'origine.
 */

const REGLEMENT_HTML = `<!DOCTYPE html>
<html>
  <head><style>.nav { color: red }</style><script>track()</script></head>
  <body>
    <nav><ul><li><a href="/">Accueil</a></li><li><a href="/inscription">Inscription</a></li></ul></nav>
    <main>
      <h1>Règlement 2026</h1>
      <p>Le présent règlement s'applique à toutes les épreuves.</p>
      <h2>Matériel obligatoire</h2>
      <p>Veste imperméable à coutures étanchées.</p>
      <ul><li>Couverture de survie</li><li>Sifflet</li></ul>
      <h2>Assistance</h2>
      <p>Assistance autorisée uniquement à Lenk.</p>
      <table>
        <caption>Barrières horaires</caption>
        <tr><th>Point</th><th>Heure</th></tr>
        <tr><td>Col du Test</td><td>14:00</td></tr>
      </table>
    </main>
    <footer><p>Mentions légales</p></footer>
  </body>
</html>`;

describe('parsing HTML — §15', () => {
  const blocks = parseHtmlBlocks(REGLEMENT_HTML);
  const texts = blocks.map((block) => block.text);

  it('écarte la navigation, le pied de page, les scripts et les styles', () => {
    expect(texts).not.toContain('Accueil');
    expect(texts).not.toContain('Inscription');
    expect(texts).not.toContain('Mentions légales');
    expect(texts.join(' ')).not.toContain('track()');
    expect(texts.join(' ')).not.toContain('color: red');
  });

  it('conserve titres, paragraphes, listes et tableaux', () => {
    expect(texts).toContain('Règlement 2026');
    expect(texts).toContain('Veste imperméable à coutures étanchées.');
    expect(texts).toContain('Couverture de survie');
    expect(texts).toContain('Col du Test');
    expect(texts).toContain('Barrières horaires');
  });

  it('type chaque block', () => {
    const byText = new Map(blocks.map((block) => [block.text, block.blockType]));

    expect(byText.get('Règlement 2026')).toBe('heading');
    expect(byText.get('Assistance autorisée uniquement à Lenk.')).toBe('paragraph');
    expect(byText.get('Sifflet')).toBe('list');
    expect(byText.get('14:00')).toBe('table');
    expect(byText.get('Barrières horaires')).toBe('caption');
  });

  it('reconstitue le chemin de sections — §18', () => {
    // C'est ce qui permet à une citation de dire « §Assistance », et pas
    // seulement « quelque part dans le document ».
    const assistance = blocks.find(
      (block) => block.text === 'Assistance autorisée uniquement à Lenk.',
    );

    expect(assistance?.sectionPath).toEqual(['Règlement 2026', 'Assistance']);
    expect(assistance?.heading).toBe('Assistance');
  });

  it('n’enferme pas un titre dans sa propre section', () => {
    const heading = blocks.find((block) => block.text === 'Matériel obligatoire');

    expect(heading?.sectionPath).toEqual(['Règlement 2026']);
  });

  it('situe une cellule par son tableau et sa ligne', () => {
    // §18 `sourceLocator` : `tableIndex`, `rowIndex`.
    const cell = blocks.find((block) => block.text === '14:00');

    expect(cell?.locator.tableIndex).toBe(0);
    expect(cell?.locator.rowIndex).toBe(1);
  });

  it('numérote les blocks dans l’ordre du document', () => {
    expect(blocks.map((block) => block.blockIndex)).toEqual(blocks.map((_, index) => index));
  });

  it('n’évalue aucun script et ne charge aucune ressource', () => {
    // Le contenu de source est une donnée inerte (AC-SRC-14).
    const hostile =
      '<html><body><p>avant</p><script>globalThis.PWNED = true</script><p>après</p></body></html>';

    const parsed = parseHtmlBlocks(hostile);

    expect(parsed.map((block) => block.text)).toEqual(['avant', 'après']);
    expect((globalThis as Record<string, unknown>).PWNED).toBeUndefined();
  });

  it('ignore commentaires et doctype', () => {
    const html = '<!DOCTYPE html><!-- <p>caché</p> --><body><p>visible</p></body>';

    expect(parseHtmlBlocks(html).map((block) => block.text)).toEqual(['visible']);
  });

  it('décode les entités sans réinterpréter le résultat', () => {
    // `&lt;p&gt;` doit rester du texte, pas redevenir une balise.
    const html = '<body><p>Col d&apos;Aubisque &amp; retour &lt;p&gt;</p></body>';

    expect(parseHtmlBlocks(html)[0]?.text).toBe("Col d'Aubisque & retour <p>");
  });
});

describe('parsing texte — §17, §18', () => {
  const markdown = `# Règlement

Le présent règlement s'applique.

## Matériel

- Veste imperméable
- Sifflet

Texte final.`;

  const blocks = parseTextBlocks(markdown);

  it('reconnaît les titres et bâtit la structure', () => {
    const final = blocks.find((block) => block.text === 'Texte final.');

    expect(final?.sectionPath).toEqual(['Règlement', 'Matériel']);
  });

  it('fait un block par item de liste', () => {
    // Pour qu'une citation vise une ligne précise, pas un paragraphe entier.
    const items = blocks.filter((block) => block.blockType === 'list');

    expect(items.map((block) => block.text)).toEqual(['Veste imperméable', 'Sifflet']);
  });

  it('normalise les fins de ligne', () => {
    // Un même document servi par deux serveurs ne doit pas produire deux
    // découpages différents.
    const unix = parseTextBlocks('Ligne un.\n\nLigne deux.');
    const windows = parseTextBlocks('Ligne un.\r\n\r\nLigne deux.');

    expect(hashBlocks(unix)).toBe(hashBlocks(windows));
  });

  it('situe chaque block par son décalage', () => {
    expect(blocks.every((block) => typeof block.locator.charOffset === 'number')).toBe(true);
  });
});

describe('déterminisme et versionnement', () => {
  it('rend exactement le même résultat à chaque parsing', () => {
    // « Un re-parsing d'un snapshot inchangé doit produire le même résultat. »
    const first = parseSnapshot({ content: REGLEMENT_HTML, contentType: 'text/html' });
    const second = parseSnapshot({ content: REGLEMENT_HTML, contentType: 'text/html' });

    expect(second.outputHash).toBe(first.outputHash);
    expect(JSON.stringify(second.blocks)).toBe(JSON.stringify(first.blocks));
  });

  it('estampille la version de parseur', () => {
    expect(parseSnapshot({ content: 'Texte.', contentType: 'text/plain' }).parserVersion).toBe(
      PARSER_VERSION,
    );
  });

  it('change d’empreinte dès que le contenu change', () => {
    // C'est ce qui rend un re-parsing comparable : même empreinte, même
    // résultat ; empreinte différente, quelque chose a bougé.
    const a = parseSnapshot({ content: 'Départ 04:00.', contentType: 'text/plain' });
    const b = parseSnapshot({ content: 'Départ 05:00.', contentType: 'text/plain' });

    expect(a.outputHash).not.toBe(b.outputHash);
  });
});

describe('types de contenu', () => {
  it('accepte HTML, texte et markdown', () => {
    for (const type of ['text/html', 'text/plain', 'text/markdown', 'text/csv']) {
      expect(isParsableContentType(type), type).toBe(true);
    }
  });

  it('accepte le PDF, mais pas par le chemin texte', () => {
    // §13 est désormais couvert par `pdf.ts` : le type est accepté. Il reste
    // binaire, donc il n'entre pas par `parseSnapshot`, qui reçoit du texte —
    // décoder un PDF en UTF-8 produirait du bruit présenté comme un document.
    // Le pipeline PDF a ses propres tests, dans `pdf.test.ts`.
    expect(isParsableContentType('application/pdf')).toBe(true);

    try {
      parseSnapshot({ content: '%PDF-1.7 ...', contentType: 'application/pdf' });
      expect.unreachable('une ParseError était attendue');
    } catch (error) {
      expect((error as ParseError).reason).toBe('unsupported_content_type');
    }
  });

  it('refuse un GPX : il suit le pipeline géospatial — §16', () => {
    expect(isParsableContentType('application/gpx+xml')).toBe(false);
  });

  it('devine le HTML quand le type manque', () => {
    // Beaucoup de serveurs servent du HTML en `application/octet-stream`.
    const parsed = parseSnapshot({
      content: '<body><p>Départ 04:00</p></body>',
      contentType: null,
    });

    expect(parsed.blocks[0]?.text).toBe('Départ 04:00');
  });

  it('signale un document vide', () => {
    try {
      parseSnapshot({ content: '   ', contentType: 'text/plain' });
      expect.unreachable('une ParseError était attendue');
    } catch (error) {
      expect((error as ParseError).reason).toBe('empty_document');
    }
  });

  it('signale un document sans texte exploitable', () => {
    // Un constat traçable, pas zéro block en silence.
    try {
      parseSnapshot({ content: '<html><nav>menu</nav></html>', contentType: 'text/html' });
      expect.unreachable('une ParseError était attendue');
    } catch (error) {
      expect((error as ParseError).reason).toBe('no_extractable_text');
    }
  });
});

describe('chunking — §19', () => {
  const blocks = parseHtmlBlocks(REGLEMENT_HTML);

  it('conserve la relation aux blocks', () => {
    // §19 : « conserver sa relation aux blocks ». C'est ce qui permet à une
    // citation de remonter jusqu'à une section et une page.
    const chunks = chunkBlocks(blocks, { targetChars: 120, overlapBlocks: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.blockIndexes.length).toBeGreaterThan(0);
    }
  });

  it('couvre tous les blocks', () => {
    const chunks = chunkBlocks(blocks, { targetChars: 120, overlapBlocks: 0 });
    const covered = new Set(chunks.flatMap((chunk) => chunk.blockIndexes));

    expect(covered.size).toBe(blocks.length);
  });

  it('ne coupe jamais à l’intérieur d’un block', () => {
    // « Ne pas couper arbitrairement une ligne métier importante » : découper
    // « Assistance autorisée uniquement à Lenk » donnerait deux morceaux dont
    // aucun ne porte l'information.
    const chunks = chunkBlocks(blocks, { targetChars: 10, overlapBlocks: 0 });
    const phrase = 'Assistance autorisée uniquement à Lenk.';

    expect(chunks.some((chunk) => chunk.text.includes(phrase))).toBe(true);
  });

  it('reprend un peu de contexte d’un chunk à l’autre', () => {
    const chunks = chunkBlocks(blocks, { targetChars: 120, overlapBlocks: 1 });

    const first = chunks[0]?.blockIndexes ?? [];
    const second = chunks[1]?.blockIndexes ?? [];

    expect(second[0]).toBe(first[first.length - 1]);
  });

  it('situe le chunk par sa section la plus précise — §20', () => {
    const chunks = chunkBlocks(blocks, { targetChars: 120, overlapBlocks: 0 });
    const withAssistance = chunks.find((chunk) => chunk.text.includes('Lenk'));

    expect(withAssistance?.sectionLabel).toBe('Assistance');
  });

  it('rend une empreinte par chunk', () => {
    const chunks = chunkBlocks(blocks);

    for (const chunk of chunks) expect(chunk.contentHash).toHaveLength(64);
  });

  it('est déterministe', () => {
    expect(JSON.stringify(chunkBlocks(blocks))).toBe(JSON.stringify(chunkBlocks(blocks)));
  });

  it('ne répète pas le dernier chunk à cause du recouvrement', () => {
    const chunks = chunkBlocks(blocks, { targetChars: 200, overlapBlocks: 1 });
    const last = chunks[chunks.length - 1];
    const previous = chunks[chunks.length - 2];

    if (previous !== undefined && last !== undefined) {
      expect(last.blockIndexes).not.toEqual(previous.blockIndexes);
    }
  });

  it('déclare sa version', () => {
    expect(CHUNKER_VERSION).toMatch(/^chunker-/);
  });
});
