/**
 * Texte mis en forme de la Communauté — décision produit du 2026-11-27 :
 * gras, italique, listes, citations et liens https, rien d'autre.
 *
 * Le texte reste du texte en base (les colonnes `body` de 0114) : un Markdown
 * restreint, écrit par l'éditeur et relu ici. Jamais de HTML stocké, jamais de
 * HTML injecté à l'affichage : ce module rend un arbre que React échappe. Ce
 * que la lecture ne reconnaît pas reste du texte, si bien qu'un texte saisi
 * sans éditeur (JavaScript coupé) s'affiche tel qu'écrit.
 *
 * La syntaxe, volontairement plus étroite que CommonMark, est celle-ci :
 * - les blocs sont séparés par une ligne vide ; dans un paragraphe, un retour
 *   à la ligne est un saut de ligne ;
 * - `**gras**`, `_italique_` ; `[texte](https://…)` ;
 * - `- ` ouvre un élément de liste à puces, `1. ` de liste numérotée ; une
 *   ligne qui suit un élément et commence par deux espaces le prolonge ;
 * - `> ` ouvre une citation, sans citation dans la citation ;
 * - `\` devant un caractère de syntaxe le rend littéral.
 */

export type CommunityInline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'break' }
  | { readonly kind: 'bold'; readonly children: readonly CommunityInline[] }
  | { readonly kind: 'italic'; readonly children: readonly CommunityInline[] }
  | { readonly kind: 'link'; readonly href: string; readonly children: readonly CommunityInline[] };

export type CommunityBlock =
  | { readonly kind: 'paragraph'; readonly inlines: readonly CommunityInline[] }
  | {
      readonly kind: 'list';
      readonly ordered: boolean;
      readonly start: number;
      readonly items: readonly (readonly CommunityInline[])[];
    }
  | { readonly kind: 'quote'; readonly blocks: readonly CommunityBlock[] };

const ESCAPABLE = new Set(['\\', '*', '_', '[', ']', '(', ')', '-', '>', '.', '#']);

const BULLET = /^- (.*)$/u;
const ORDERED = /^(\d{1,3})\. (.*)$/u;
const QUOTE = /^>(?: (.*))?$/u;
const CONTINUATION = /^ {2}(.*)$/u;

/** Un lien n'est cliquable qu'en https, vers un hôte nommé. */
export function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'https:' ||
      url.hostname === '' ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

// ── Lecture ─────────────────────────────────────────────────────────────

function pushText(out: CommunityInline[], text: string): void {
  if (text === '') return;
  const last = out[out.length - 1];
  if (last !== undefined && last.kind === 'text') {
    out[out.length - 1] = { kind: 'text', text: last.text + text };
  } else {
    out.push({ kind: 'text', text });
  }
}

/** La position du délimiteur fermant, en sautant les caractères échappés. */
function closing(source: string, from: number, delimiter: string): number {
  for (let index = from; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
      continue;
    }
    if (source.startsWith(delimiter, index)) return index;
  }
  return -1;
}

function parseInline(source: string, inLink = false): CommunityInline[] {
  const out: CommunityInline[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index] as string;

    if (char === '\\' && index + 1 < source.length && ESCAPABLE.has(source[index + 1] as string)) {
      pushText(out, source[index + 1] as string);
      index += 2;
      continue;
    }

    if (source.startsWith('**', index)) {
      const end = closing(source, index + 2, '**');
      if (end > index + 2) {
        out.push({ kind: 'bold', children: parseInline(source.slice(index + 2, end), inLink) });
        index = end + 2;
        continue;
      }
    }

    if (char === '_') {
      const end = closing(source, index + 1, '_');
      if (end > index + 1) {
        out.push({ kind: 'italic', children: parseInline(source.slice(index + 1, end), inLink) });
        index = end + 1;
        continue;
      }
    }

    if (char === '[' && !inLink) {
      const end = closing(source, index + 1, ']');
      if (end > index + 1 && source[end + 1] === '(') {
        const close = source.indexOf(')', end + 2);
        const url = close === -1 ? '' : source.slice(end + 2, close);
        if (close !== -1 && url !== '' && !/\s/u.test(url)) {
          const children = parseInline(source.slice(index + 1, end), true);
          const href = safeHref(url);
          if (href === null) {
            // Un lien refusé reste lisible : son texte, puis l'adresse, inertes.
            for (const child of children) out.push(child);
            pushText(out, ` (${url})`);
          } else {
            out.push({ kind: 'link', href, children });
          }
          index = close + 1;
          continue;
        }
      }
    }

    pushText(out, char);
    index += 1;
  }

  return out;
}

function parseLines(lines: readonly string[]): CommunityInline[] {
  const out: CommunityInline[] = [];
  lines.forEach((line, position) => {
    if (position > 0) out.push({ kind: 'break' });
    for (const inline of parseInline(line)) out.push(inline);
  });
  return out;
}

function parseBlocks(lines: readonly string[], inQuote: boolean): CommunityBlock[] {
  const blocks: CommunityBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] as string;

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const quote = inQuote ? null : QUOTE.exec(line);
    if (quote !== null) {
      const inner: string[] = [];
      while (index < lines.length) {
        const match = QUOTE.exec(lines[index] as string);
        if (match === null) break;
        inner.push(match[1] ?? '');
        index += 1;
      }
      const quoted = parseBlocks(inner, true);
      if (quoted.length > 0) blocks.push({ kind: 'quote', blocks: quoted });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = bullet === null ? ORDERED.exec(line) : null;
    if (bullet !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const marker = isOrdered ? ORDERED : BULLET;
      const items: CommunityInline[][] = [];
      while (index < lines.length) {
        const match = marker.exec(lines[index] as string);
        if (match === null) break;
        const itemLines = [(isOrdered ? match[2] : match[1]) ?? ''];
        index += 1;
        while (index < lines.length) {
          const more = CONTINUATION.exec(lines[index] as string);
          if (more === null) break;
          itemLines.push(more[1] ?? '');
          index += 1;
        }
        items.push(parseLines(itemLines));
      }
      blocks.push({
        kind: 'list',
        ordered: isOrdered,
        start: isOrdered ? Number.parseInt(ordered[1] as string, 10) : 1,
        items,
      });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] as string;
      if (current.trim() === '') break;
      if (
        paragraph.length > 0 &&
        ((!inQuote && QUOTE.test(current)) || BULLET.test(current) || ORDERED.test(current))
      ) {
        break;
      }
      paragraph.push(current);
      index += 1;
    }
    blocks.push({ kind: 'paragraph', inlines: parseLines(paragraph) });
  }

  return blocks;
}

export function parseCommunityText(source: string): readonly CommunityBlock[] {
  return parseBlocks(source.replace(/\r\n?/gu, '\n').split('\n'), false);
}

// ── Écriture, depuis le document de l'éditeur ──────────────────────────

/** Le sous-ensemble du JSON de Tiptap (ProseMirror) que l'éditeur produit. */
export interface EditorNode {
  readonly type?: string | undefined;
  readonly text?: string | undefined;
  readonly attrs?: Readonly<Record<string, unknown>> | undefined;
  readonly marks?:
    | readonly {
        readonly type: string;
        readonly attrs?: Readonly<Record<string, unknown>> | undefined;
      }[]
    | undefined;
  readonly content?: readonly EditorNode[] | undefined;
}

function escapeText(text: string): string {
  return text.replace(/[\\*_[\]]/gu, (char) => `\\${char}`);
}

/** Une ligne qui commencerait comme un bloc reste du texte. */
function escapeLineStart(line: string): string {
  if (/^(- |>)/u.test(line)) return `\\${line}`;
  return line.replace(/^(\d{1,3})\. /u, '$1\\. ');
}

function encodeHref(href: string): string {
  return href.replace(/[()\s]/gu, (char) => encodeURIComponent(char));
}

function hrefOf(node: EditorNode): string | null {
  const link = node.marks?.find((mark) => mark.type === 'link');
  const href = link?.attrs?.href;
  return typeof href === 'string' ? safeHref(href) : null;
}

function inlineText(node: EditorNode): string {
  const marks = new Set((node.marks ?? []).map((mark) => mark.type));
  let text = escapeText(node.text ?? '');
  if (marks.has('italic')) text = `_${text}_`;
  if (marks.has('bold')) text = `**${text}**`;
  return text;
}

/** Les lignes d'un paragraphe : un saut de ligne en ouvre une nouvelle. */
function inlineLines(nodes: readonly EditorNode[]): string[] {
  const lines: string[] = [''];
  let index = 0;

  while (index < nodes.length) {
    const node = nodes[index] as EditorNode;
    if (node.type === 'hardBreak') {
      lines.push('');
      index += 1;
      continue;
    }
    if (node.type !== 'text' || (node.text ?? '') === '') {
      index += 1;
      continue;
    }

    const href = hrefOf(node);
    if (href === null) {
      lines[lines.length - 1] += inlineText(node);
      index += 1;
      continue;
    }

    // Les morceaux voisins d'un même lien forment un seul lien.
    let label = '';
    while (index < nodes.length) {
      const next = nodes[index] as EditorNode;
      if (next.type !== 'text' || hrefOf(next) !== href) break;
      label += inlineText(next);
      index += 1;
    }
    lines[lines.length - 1] += `[${label}](${encodeHref(href)})`;
  }

  return lines.map(escapeLineStart);
}

/** Un élément de liste : ses paragraphes bout à bout ; une liste imbriquée est aplatie. */
function listItems(list: EditorNode): string[][] {
  const items: string[][] = [];
  for (const item of list.content ?? []) {
    const lines: string[] = [];
    const nested: string[][] = [];
    for (const child of item.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        nested.push(...listItems(child));
      } else {
        const text = inlineLines(child.content ?? []);
        if (text.some((line) => line !== '')) lines.push(...text);
      }
    }
    if (lines.length > 0) items.push(lines);
    items.push(...nested);
  }
  return items;
}

function blockLines(node: EditorNode, inQuote: boolean): string[] | null {
  switch (node.type) {
    case 'paragraph': {
      const lines = inlineLines(node.content ?? []);
      return lines.every((line) => line === '') ? null : lines;
    }
    case 'bulletList':
    case 'orderedList': {
      const ordered = node.type === 'orderedList';
      const startAttr = Number(node.attrs?.start ?? 1);
      const start =
        Number.isInteger(startAttr) && startAttr > 0 && startAttr < 1000 ? startAttr : 1;
      const out: string[] = [];
      listItems(node).forEach((lines, position) => {
        const marker = ordered ? `${start + position}. ` : '- ';
        lines.forEach((line, row) => out.push(row === 0 ? `${marker}${line}` : `  ${line}`));
      });
      return out.length === 0 ? null : out;
    }
    case 'blockquote': {
      // Pas de citation dans la citation : son contenu y est déroulé à plat.
      const inner = blocksOf(node.content ?? [], true);
      if (inner.length === 0) return null;
      return inQuote ? inner : inner.map((line) => (line === '' ? '>' : `> ${line}`));
    }
    default:
      return null;
  }
}

function blocksOf(nodes: readonly EditorNode[], inQuote: boolean): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    const lines = blockLines(node, inQuote);
    if (lines === null) continue;
    if (out.length > 0) out.push('');
    out.push(...lines);
  }
  return out;
}

export function serializeCommunityDoc(doc: EditorNode): string {
  return blocksOf(doc.content ?? [], false).join('\n');
}
