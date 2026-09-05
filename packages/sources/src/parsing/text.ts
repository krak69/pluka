import type { ParsedBlock } from './blocks.js';

/**
 * Parsing de texte brut — docs/engines/SOURCES_EXTRACTION.md §18.
 *
 * Utilisé pour `text/plain`, `text/markdown` et les saisies manuelles de §17,
 * qui doivent elles aussi porter une provenance plutôt que d'être « stockées
 * comme texte sans audit ».
 *
 * Le découpage suit les lignes vides, séparateur de paragraphe le plus
 * universel. Les titres Markdown sont reconnus parce qu'ils portent la
 * structure de section que §18 demande de conserver — sans quoi un document
 * entier deviendrait une suite de paragraphes sans hiérarchie.
 */

const MARKDOWN_HEADING = /^(#{1,6})\s+(.*)$/;
const MARKDOWN_LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

export function parseTextBlocks(content: string): readonly ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const sectionByLevel = new Map<number, string>();

  let offset = 0;

  // `\r\n` normalisé : un même document servi par deux serveurs ne doit pas
  // produire deux découpages différents.
  for (const rawParagraph of content.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const paragraphOffset = offset;
    offset += rawParagraph.length + 2;

    const paragraph = rawParagraph.trim();
    if (paragraph === '') continue;

    const lines = paragraph.split('\n');
    const heading = MARKDOWN_HEADING.exec(lines[0] ?? '');

    if (heading !== null && lines.length === 1) {
      const level = (heading[1] ?? '#').length;
      const text = (heading[2] ?? '').trim();
      if (text === '') continue;

      for (const known of [...sectionByLevel.keys()]) {
        if (known >= level) sectionByLevel.delete(known);
      }
      sectionByLevel.set(level, text);

      blocks.push({
        blockIndex: blocks.length,
        pageNumber: null,
        sectionPath: sectionPath(sectionByLevel).slice(0, -1),
        heading: null,
        blockType: 'heading',
        text,
        locator: { charOffset: paragraphOffset },
      });

      continue;
    }

    // Un paragraphe fait uniquement de puces devient une liste : chaque item
    // est un block, pour qu'une citation puisse viser une ligne précise.
    const items = lines.map((line) => MARKDOWN_LIST_ITEM.exec(line));
    if (items.length > 0 && items.every((item) => item !== null)) {
      for (const item of items) {
        const text = (item?.[1] ?? '').trim();
        if (text === '') continue;

        blocks.push({
          blockIndex: blocks.length,
          pageNumber: null,
          sectionPath: sectionPath(sectionByLevel),
          heading: currentHeading(sectionByLevel),
          blockType: 'list',
          text,
          locator: { charOffset: paragraphOffset },
        });
      }

      continue;
    }

    blocks.push({
      blockIndex: blocks.length,
      pageNumber: null,
      sectionPath: sectionPath(sectionByLevel),
      heading: currentHeading(sectionByLevel),
      blockType: 'paragraph',
      text: paragraph.replace(/\s*\n\s*/g, ' '),
      locator: { charOffset: paragraphOffset },
    });
  }

  return blocks;
}

function sectionPath(sections: ReadonlyMap<number, string>): readonly string[] {
  return [...sections.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, heading]) => heading);
}

function currentHeading(sections: ReadonlyMap<number, string>): string | null {
  const path = sectionPath(sections);
  return path[path.length - 1] ?? null;
}
