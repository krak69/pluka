import type { BlockType, ParsedBlock } from './blocks.js';

/**
 * Parsing HTML — docs/engines/SOURCES_EXTRACTION.md §15.
 *
 * « Le parser HTML doit éliminer autant que possible : navigation, footer,
 * menus, scripts, styles, contenus dupliqués, bannières cookies, éléments non
 * éditoriaux. Il conserve : titres, paragraphes, listes, tableaux, liens
 * utiles, structure de section. »
 *
 * Scanner au niveau des balises plutôt qu'arbre DOM complet : `packages/sources`
 * n'a aucune dépendance, et aucune bibliothèque HTML n'est disponible. Le
 * compromis est réel et se lit ici — un HTML très malformé sera moins bien
 * découpé qu'avec un parseur conforme. En contrepartie, aucun script n'est
 * évalué et aucune ressource externe n'est chargée : le contenu de source
 * reste une donnée inerte, ce qu'exige AC-SRC-14.
 *
 * Le résultat est **déterministe** : mêmes octets, mêmes blocks, dans le même
 * ordre. C'est ce qui permet de rejouer un parsing sans produire une seconde
 * vérité.
 */

/** Éléments dont le contenu entier est écarté — §15. */
const DROPPED_ELEMENTS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'nav',
  'footer',
  'header',
  'aside',
  'form',
  'iframe',
  'button',
  'select',
]);

/** Éléments qui produisent un block, et leur type. */
const BLOCK_ELEMENTS: Readonly<Record<string, BlockType>> = {
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  p: 'paragraph',
  li: 'list',
  td: 'table',
  th: 'table',
  caption: 'caption',
  figcaption: 'caption',
  blockquote: 'paragraph',
  dd: 'paragraph',
  dt: 'heading',
  pre: 'other',
};

const HEADING_LEVELS: Readonly<Record<string, number>> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};

const PREDEFINED_ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(value: string): string {
  return (
    value
      .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (entity) => PREDEFINED_ENTITIES[entity] ?? entity)
      // Références numériques : décodées, mais jamais interprétées comme balise —
      // le texte reste du texte.
      .replace(/&#(\d{1,7});/g, (_, code: string) => safeCodePoint(Number(code)))
      .replace(/&#x([0-9a-fA-F]{1,6});/g, (_, code: string) =>
        safeCodePoint(Number.parseInt(code, 16)),
      )
  );
}

function safeCodePoint(code: number): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return '';
  return String.fromCodePoint(code);
}

/** Espaces normalisés : le HTML en produit beaucoup qui ne portent aucun sens. */
function normalizeText(value: string): string {
  return decodeEntities(value).replace(/\s+/g, ' ').trim();
}

interface Token {
  readonly kind: 'open' | 'close' | 'text';
  readonly name: string;
  readonly text: string;
  readonly selfClosing: boolean;
  readonly offset: number;
}

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Découpe le document en balises et textes, sans construire d'arbre. */
function tokenize(html: string): readonly Token[] {
  const tokens: Token[] = [];
  const pattern =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<\/?([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    if (match.index > cursor) {
      tokens.push({
        kind: 'text',
        name: '',
        text: html.slice(cursor, match.index),
        selfClosing: false,
        offset: cursor,
      });
    }

    cursor = match.index + match[0].length;

    // Commentaires, CDATA et doctype : ignorés, jamais interprétés.
    const name = match[1];
    if (name === undefined) continue;

    const lower = name.toLowerCase();

    tokens.push({
      kind: match[0].startsWith('</') ? 'close' : 'open',
      name: lower,
      text: '',
      selfClosing: match[3] === '/' || VOID_ELEMENTS.has(lower),
      offset: match.index,
    });
  }

  if (cursor < html.length) {
    tokens.push({
      kind: 'text',
      name: '',
      text: html.slice(cursor),
      selfClosing: false,
      offset: cursor,
    });
  }

  return tokens;
}

export function parseHtmlBlocks(html: string): readonly ParsedBlock[] {
  const tokens = tokenize(html);
  const blocks: ParsedBlock[] = [];

  /** Profondeur d'imbrication dans un élément écarté. */
  let dropDepth = 0;
  const dropStack: string[] = [];

  /** Élément de block courant, s'il y en a un. */
  let current: { name: string; type: BlockType; text: string; offset: number } | null = null;

  /** Chemin de sections, tenu par les titres rencontrés — §18 `sectionPath`. */
  const sectionByLevel = new Map<number, string>();

  let tableIndex = -1;
  let rowIndex = -1;

  function currentSectionPath(): readonly string[] {
    return [...sectionByLevel.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, heading]) => heading);
  }

  function flush(): void {
    if (current === null) return;

    const text = normalizeText(current.text);
    const element = current;
    current = null;

    // Un block vide n'est pas une information : une cellule de mise en page,
    // un paragraphe de séparation.
    if (text === '') return;

    const level = HEADING_LEVELS[element.name];

    if (level !== undefined) {
      // Un titre ouvre une section et referme les sections plus profondes.
      for (const known of [...sectionByLevel.keys()]) {
        if (known >= level) sectionByLevel.delete(known);
      }
      sectionByLevel.set(level, text);
    }

    const locator: Record<string, number | string> = {
      cssSelector: element.name,
      charOffset: element.offset,
    };

    if (element.type === 'table') {
      if (tableIndex >= 0) locator.tableIndex = tableIndex;
      if (rowIndex >= 0) locator.rowIndex = rowIndex;
    }

    blocks.push({
      blockIndex: blocks.length,
      pageNumber: null,
      // Le titre courant est le contexte du block, mais un titre n'est pas
      // dans sa propre section : il l'ouvre.
      sectionPath: level === undefined ? currentSectionPath() : currentSectionPath().slice(0, -1),
      heading: level === undefined ? (lastHeading() ?? null) : null,
      blockType: element.type,
      text,
      locator,
    });
  }

  function lastHeading(): string | undefined {
    const path = currentSectionPath();
    return path[path.length - 1];
  }

  for (const token of tokens) {
    if (token.kind === 'text') {
      if (dropDepth === 0 && current !== null) current.text += token.text;
      continue;
    }

    if (token.kind === 'open') {
      if (DROPPED_ELEMENTS.has(token.name)) {
        if (!token.selfClosing) {
          dropDepth += 1;
          dropStack.push(token.name);
        }
        continue;
      }

      if (dropDepth > 0) continue;

      if (token.name === 'table') {
        tableIndex += 1;
        rowIndex = -1;
      }
      if (token.name === 'tr') rowIndex += 1;

      const type = BLOCK_ELEMENTS[token.name];
      if (type !== undefined) {
        // Un block ouvert alors qu'un autre l'est déjà — un `<p>` dans un
        // `<li>` — ferme le précédent : on préfère deux blocks à un mélange.
        flush();
        current = { name: token.name, type, text: '', offset: token.offset };
      }

      continue;
    }

    // Fermeture.
    if (dropDepth > 0) {
      const top = dropStack[dropStack.length - 1];
      if (top === token.name) {
        dropStack.pop();
        dropDepth -= 1;
      }
      continue;
    }

    if (current !== null && current.name === token.name) flush();
  }

  flush();

  return blocks;
}
