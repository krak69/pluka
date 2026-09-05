import type { BlockType, ParsedBlock } from './blocks.js';

/**
 * Parsing PDF — docs/engines/SOURCES_EXTRACTION.md §13.
 *
 * Le pipeline de §13 est suivi dans son ordre : métadonnées, extraction du
 * texte natif, segmentation en pages, détection de blocs. « Priorité absolue :
 * extraire le texte natif avant toute OCR » — et l'OCR de §14 n'est pas ici :
 * un PDF sans couche texte est refusé avec sa raison, plutôt qu'approximé.
 *
 * BIBLIOTHÈQUE RETENUE : `unpdf`
 *
 * `unpdf` embarque une compilation de PDF.js (Mozilla) pour environnements
 * sans DOM. Le choix se justifie sur les quatre critères demandés :
 *
 * - **maturité** : le moteur est celui de PDF.js, lecteur PDF de Firefox,
 *   éprouvé depuis plus de dix ans sur le web ouvert — donc sur des documents
 *   quelconques, pas sur un corpus choisi ;
 * - **licence** : MIT pour `unpdf`, Apache-2.0 pour PDF.js. Toutes deux
 *   permissives, compatibles avec un produit fermé ;
 * - **aucune dépendance native** : `unpdf` déclare zéro dépendance, y compris
 *   optionnelle. C'est ce qui l'a fait préférer à `pdfjs-dist`, qui charge
 *   `@napi-rs/canvas` — un binaire natif — dès l'import sous Node, pour un
 *   polyfill dont l'extraction de texte n'a aucun usage. Un test le vérifie en
 *   interceptant `process.dlopen` : aucun binaire natif n'est chargé ;
 * - **PDF malformé** : PDF.js reconstruit un document dont la table xref est
 *   fausse plutôt que d'abandonner, et lève une erreur typée sur un document
 *   chiffré. Les deux comportements sont couverts par des fixtures.
 *
 * DÉTERMINISME
 *
 * L'extraction rend des fragments positionnés. Le regroupement en lignes puis
 * en blocks est fait ici, par des règles fixes : tri par position, tolérance
 * de ligne constante, coordonnées arrondies. Deux parsings des mêmes octets
 * produisent donc les mêmes blocks, dans le même ordre — ce que `outputHash`
 * rend vérifiable.
 *
 * SÉCURITÉ
 *
 * Un PDF est un format hostile : il porte du JavaScript, des actions
 * d'ouverture, des fichiers embarqués, et des structures dont la taille
 * décompressée n'a aucun rapport avec celle du fichier. Trois réponses ici :
 * des limites explicites avant toute lecture, un refus du chiffrement, et
 * aucune exécution du JavaScript porté par le document.
 *
 * Sur ce dernier point, la garantie ne vient pas d'une option qu'on aurait
 * pensé à passer : les versions récentes de PDF.js ont supprimé leur chemin
 * d'évaluation, et le moteur embarqué ici ne contient aucun `new Function`.
 * L'ancienne option `isEvalSupported` n'existe donc plus — il n'y a plus rien
 * à désactiver. Le `/OpenAction` et les entrées `/JavaScript` d'un document ne
 * concernent qu'un lecteur interactif ; une extraction de texte ne les
 * interprète pas. Une fixture le vérifie plutôt que de le supposer.
 */

/**
 * Limites, appliquées avant toute lecture du document.
 *
 * Elles ne sont pas des réglages de confort : un PDF de quelques kilo-octets
 * peut déclarer des milliers de pages ou un flux dont la décompression
 * saturerait la mémoire du worker. Les valeurs sont larges pour un règlement
 * de course — le plus gros observé tient en quelques mégaoctets — et étroites
 * pour une bombe de décompression.
 */
export const PDF_LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  maxPages: 400,
  /** Au-delà, le document n'est plus un règlement : c'est un corpus. */
  maxCharacters: 4 * 1024 * 1024,
} as const;

export const PDF_REJECTION_REASONS = [
  'too_large',
  'too_many_pages',
  'encrypted',
  'scanned_without_text',
  'unreadable',
] as const;

export type PdfRejectionReason = (typeof PDF_REJECTION_REASONS)[number];

export class PdfParseError extends Error {
  readonly reason: PdfRejectionReason;
  readonly detail: string | undefined;

  constructor(reason: PdfRejectionReason, message: string, detail?: string) {
    super(`PDF_REJECTED (${reason}) : ${message}`);
    this.name = 'PdfParseError';
    this.reason = reason;
    this.detail = detail;
  }
}

export function isPdfParseError(error: unknown): error is PdfParseError {
  return error instanceof PdfParseError;
}

/** Un fragment de texte positionné, tel que le moteur le rend. */
interface TextItem {
  readonly str: string;
  readonly height: number;
  readonly width: number;
  readonly transform: readonly number[];
}

interface Fragment {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly size: number;
}

interface PositionedLine {
  readonly text: string;
  readonly page: number;
  readonly lineIndex: number;
  /** Hauteur de police dominante de la ligne, arrondie — sert au niveau de titre. */
  readonly size: number;
  readonly x: number;
  readonly y: number;
  /**
   * Les fragments de la ligne, dans l'ordre de lecture.
   *
   * Conservés parce qu'une ligne de tableau ne se distingue d'une phrase que
   * par eux : « Iffigenalp    16h20 » et « Iffigenalp arrive à 16h20 » ont le
   * même texte recollé, mais pas les mêmes gouttières.
   */
  readonly fragments: readonly Fragment[];
}

/**
 * Tolérance de regroupement en ligne, en points PDF.
 *
 * Deux fragments dont les lignes de base diffèrent de moins d'un point
 * appartiennent à la même ligne : un exposant ou un changement de police
 * décale la ligne de base de fractions de point, et les séparer couperait une
 * phrase en deux blocks.
 */
const LINE_TOLERANCE = 1;

/** Deux décimales : au-delà, on capture du bruit de calcul, pas de la position. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Découpe une page en lignes, du haut vers le bas.
 *
 * L'origine d'un PDF est en bas à gauche : une ordonnée plus grande est plus
 * haut dans la page. Le tri est donc décroissant en `y`, croissant en `x`.
 */
function toLines(items: readonly TextItem[], page: number): readonly PositionedLine[] {
  const positioned = items
    .filter((item) => item.str.trim() !== '')
    .map((item) => ({
      text: item.str,
      x: round(item.transform[4] ?? 0),
      y: round(item.transform[5] ?? 0),
      width: round(item.width),
      size: round(item.height),
    }));

  const groups: { y: number; entries: typeof positioned }[] = [];

  for (const entry of positioned) {
    const group = groups.find((candidate) => Math.abs(candidate.y - entry.y) <= LINE_TOLERANCE);

    if (group === undefined) groups.push({ y: entry.y, entries: [entry] });
    else group.entries.push(entry);
  }

  return groups
    .sort((left, right) => right.y - left.y)
    .map((group, lineIndex) => {
      const entries = [...group.entries].sort((left, right) => left.x - right.x);
      const text = joinFragments(entries.map((entry) => entry.text));

      return {
        text,
        page,
        lineIndex,
        // La taille dominante d'une ligne est la plus grande : un titre suivi
        // d'un appel de note reste un titre.
        size: Math.max(...entries.map((entry) => entry.size)),
        x: entries[0]?.x ?? 0,
        y: group.y,
        fragments: entries,
      } satisfies PositionedLine;
    })
    .filter((line) => line.text !== '');
}

/**
 * Recolle les fragments d'une ligne.
 *
 * PDF.js rend un fragment par changement de style ou de position : un mot en
 * gras au milieu d'une phrase arrive séparé. Les recoller sans espace
 * produirait « autoriséeà Lenk » ; en ajouter un partout produirait « L ' assistance ».
 * L'espace n'est donc inséré que si aucun des deux côtés n'en porte déjà.
 */
function joinFragments(fragments: readonly string[]): string {
  return fragments
    .reduce((accumulated, fragment) => {
      if (accumulated === '') return fragment;

      const needsSpace = !/\s$/.test(accumulated) && !/^\s/.test(fragment);

      return accumulated + (needsSpace ? ' ' : '') + fragment;
    }, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Taille de corps du document.
 *
 * La plus fréquente parmi les lignes : dans un règlement, le corps de texte
 * domine largement les titres. La déduire du document plutôt que de la fixer
 * évite de traiter un document composé en 9 points comme un document de titres.
 */
function bodySize(lines: readonly PositionedLine[]): number {
  const counts = new Map<number, number>();

  for (const line of lines) counts.set(line.size, (counts.get(line.size) ?? 0) + 1);

  let dominant = 0;
  let best = -1;

  // À égalité de fréquence, la plus petite taille gagne : un document dont les
  // titres seraient aussi nombreux que le corps reste un document de corps.
  for (const [size, count] of [...counts.entries()].sort(([left], [right]) => left - right)) {
    if (count > best) {
      best = count;
      dominant = size;
    }
  }

  return dominant;
}

/**
 * Niveaux de titre, déduits des tailles employées.
 *
 * §18 attend un `sectionPath`, donc une hiérarchie. Un PDF ne la déclare pas :
 * il n'a ni `<h1>` ni `<h2>`. Elle est reconstruite à partir des tailles
 * supérieures au corps, la plus grande valant le niveau 1. C'est une
 * heuristique, et elle est dite comme telle : un document dont les titres ne
 * se distinguent que par la graisse produira des paragraphes, pas de fausses
 * sections.
 */
function headingLevels(
  lines: readonly PositionedLine[],
  body: number,
): ReadonlyMap<number, number> {
  const larger = [...new Set(lines.map((line) => line.size))]
    .filter((size) => size > body)
    .sort((left, right) => right - left);

  return new Map(larger.map((size, index) => [size, index + 1]));
}

export interface PdfDocumentInfo {
  readonly pageCount: number;
  readonly characterCount: number;
}

export interface PdfParseResult {
  readonly blocks: readonly ParsedBlock[];
  readonly info: PdfDocumentInfo;
}

/**
 * Chargeur du moteur, injectable.
 *
 * Le paquet reste pur : il ne lit ni le réseau, ni la base, ni le disque. Il
 * importe une bibliothèque, ce qui est une dépendance, pas une I/O. L'injection
 * sert aux tests qui doivent simuler un moteur défaillant — un document que
 * PDF.js accepterait mais qui casserait en cours de route.
 */
export interface PdfEngine {
  getDocumentProxy(data: Uint8Array): Promise<{
    readonly numPages: number;
    getPage(index: number): Promise<{ getTextContent(): Promise<{ items: readonly unknown[] }> }>;
  }>;
}

async function defaultEngine(): Promise<PdfEngine> {
  const { getDocumentProxy } = await import('unpdf');

  return {
    getDocumentProxy: (data) =>
      getDocumentProxy(data, {
        // Les polices système ne sont pas consultées : le rendu ne nous
        // intéresse pas, et lire le disque sortirait du périmètre du paquet.
        useSystemFonts: false,
      }) as unknown as ReturnType<PdfEngine['getDocumentProxy']>,
  };
}

/**
 * Extrait les blocks d'un PDF — §13.
 *
 * Rejette explicitement ce qu'il ne sait pas lire, avec la raison : §14 place
 * l'OCR dans un autre lot, et un texte deviné vaudrait moins que pas de texte.
 */
export async function parsePdfBlocks(
  bytes: Uint8Array,
  engine?: PdfEngine,
): Promise<PdfParseResult> {
  // Limite de taille avant toute lecture : on refuse sans ouvrir.
  if (bytes.byteLength > PDF_LIMITS.maxBytes) {
    throw new PdfParseError('too_large', 'document trop volumineux', String(bytes.byteLength));
  }

  const resolved = engine ?? (await defaultEngine());

  let document: Awaited<ReturnType<PdfEngine['getDocumentProxy']>>;

  try {
    // Le moteur **détache** le tampon qu'on lui passe : après l'appel, les
    // octets d'origine sont vidés. Lui donner une copie évite de détruire
    // l'entrée de l'appelant — qui en a encore besoin, ne serait-ce que pour
    // recalculer l'empreinte du snapshot ou pour réessayer.
    document = await resolved.getDocumentProxy(new Uint8Array(bytes));
  } catch (error) {
    // §13 ne prévoit pas de lire un document chiffré, et le déchiffrer
    // demanderait un mot de passe que personne ne nous a confié.
    if (isPasswordError(error)) {
      throw new PdfParseError('encrypted', 'document chiffré : lecture refusée');
    }

    throw new PdfParseError('unreadable', 'document illisible', errorName(error));
  }

  if (document.numPages > PDF_LIMITS.maxPages) {
    throw new PdfParseError('too_many_pages', 'trop de pages', String(document.numPages));
  }

  const lines: PositionedLine[] = [];
  let characterCount = 0;

  for (let page = 1; page <= document.numPages; page += 1) {
    let items: readonly unknown[];

    try {
      items = (await (await document.getPage(page)).getTextContent()).items;
    } catch (error) {
      // Une page illisible n'invalide pas le document : un règlement dont la
      // page 12 est corrompue garde onze pages de texte vérifiable.
      void error;
      continue;
    }

    for (const line of toLines(items.filter(isTextItem), page)) {
      characterCount += line.text.length;

      if (characterCount > PDF_LIMITS.maxCharacters) {
        throw new PdfParseError('too_large', 'texte extrait trop volumineux');
      }

      lines.push(line);
    }
  }

  if (lines.length === 0) {
    // §14 : « l'OCR n'est utilisé que si le PDF ne contient pas de texte
    // exploitable ». Nous sommes exactement dans ce cas, et l'OCR appartient à
    // un autre lot : il demanderait un contrat de fournisseur qui n'existe pas
    // dans `packages/contracts`, et le définir ici franchirait §56.
    throw new PdfParseError(
      'scanned_without_text',
      'aucune couche texte : document probablement scanné, OCR requis (§14)',
    );
  }

  return {
    blocks: toBlocks(lines),
    info: { pageCount: document.numPages, characterCount },
  };
}

function isTextItem(item: unknown): item is TextItem {
  const candidate = item as { str?: unknown; transform?: unknown; height?: unknown };

  return (
    typeof candidate.str === 'string' &&
    Array.isArray(candidate.transform) &&
    typeof candidate.height === 'number'
  );
}

function isPasswordError(error: unknown): boolean {
  return errorName(error) === 'PasswordException';
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'inconnu';
}

/**
 * Détection de tableaux — §13, « détection tableaux / blocs lorsque possible ».
 *
 * Un PDF ne déclare pas ses tableaux : il pose du texte à des coordonnées. Une
 * ligne de tableau ne se reconnaît donc qu'à sa forme — des fragments séparés
 * par des gouttières nettes, alignés d'une ligne à l'autre.
 *
 * L'enjeu est §84 : « une barrière doit conserver waypoint, horaire, basis ».
 * L'extracteur déterministe lit ces trois éléments dans des cellules indexées
 * par tableau et par ligne. Sans cette détection, un tableau de barrières
 * arriverait en paragraphes — « Iffigenalp 16h20 » — et §84 ne trouverait
 * rien dans un PDF là où il trouve tout dans le HTML équivalent.
 *
 * La détection est volontairement stricte. Elle exige des colonnes en nombre
 * constant et alignées, sur au moins deux lignes consécutives : de la prose
 * justifiée ne devient donc pas un tableau. Le prix de cette prudence est
 * qu'un tableau irrégulier reste en paragraphes — ce qui est le bon sens du
 * refus plutôt que de la structure inventée.
 */

/** Écart minimal entre deux cellules, en points. En deçà, c'est un mot suivant. */
const COLUMN_GAP = 8;

/** Décalage toléré entre les colonnes de deux lignes d'un même tableau. */
const COLUMN_ALIGNMENT = 12;

/** Sous deux lignes, il n'y a pas de tableau : il faut un en-tête et une donnée. */
const MIN_TABLE_ROWS = 2;

/**
 * Les cellules d'une ligne, ou `null` si la ligne n'a pas de gouttière.
 *
 * Les fragments d'une même cellule sont recollés : une cellule peut contenir
 * plusieurs fragments quand le générateur change de style au milieu d'un mot.
 */
function toCells(line: PositionedLine): readonly Fragment[][] | null {
  const cells: Fragment[][] = [];
  let current: Fragment[] = [];
  let previousEnd: number | null = null;

  for (const fragment of line.fragments) {
    if (previousEnd !== null && fragment.x - previousEnd >= COLUMN_GAP) {
      cells.push(current);
      current = [];
    }

    current.push(fragment);
    previousEnd = fragment.x + fragment.width;
  }

  if (current.length > 0) cells.push(current);

  return cells.length >= 2 ? cells : null;
}

/** Les abscisses de départ des cellules : la signature de colonnes d'une ligne. */
function columnStarts(cells: readonly Fragment[][]): readonly number[] {
  return cells.map((cell) => cell[0]?.x ?? 0);
}

function alignedWith(left: readonly number[], right: readonly number[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => Math.abs(value - (right[index] ?? 0)) <= COLUMN_ALIGNMENT)
  );
}

interface TableRow {
  readonly line: PositionedLine;
  readonly cells: readonly Fragment[][];
}

/**
 * Regroupe les lignes consécutives qui partagent une structure de colonnes.
 *
 * Rend, pour chaque ligne, l'index du tableau auquel elle appartient et son
 * rang dans celui-ci — ou rien si elle n'appartient à aucun.
 */
function detectTables(
  lines: readonly PositionedLine[],
): ReadonlyMap<
  PositionedLine,
  { tableIndex: number; rowIndex: number; cells: readonly Fragment[][] }
> {
  const assignment = new Map<
    PositionedLine,
    { tableIndex: number; rowIndex: number; cells: readonly Fragment[][] }
  >();

  let tableIndex = -1;
  let run: TableRow[] = [];

  function flush(): void {
    if (run.length >= MIN_TABLE_ROWS) {
      tableIndex += 1;

      run.forEach((row, rowIndex) => {
        assignment.set(row.line, { tableIndex, rowIndex, cells: row.cells });
      });
    }

    run = [];
  }

  for (const line of lines) {
    const cells = toCells(line);
    const previous = run[run.length - 1];

    // Un tableau ne traverse pas une page : les colonnes d'une page suivante
    // sont un autre tableau, même si elles s'alignent par coïncidence.
    const continues =
      cells !== null &&
      previous !== undefined &&
      previous.line.page === line.page &&
      alignedWith(columnStarts(cells), columnStarts(previous.cells));

    if (cells === null) {
      flush();
      continue;
    }

    if (!continues) flush();

    run.push({ line, cells });
  }

  flush();

  return assignment;
}

/**
 * Transforme les lignes en blocks — §18.
 *
 * Un titre ouvre une section et n'est pas dans sa propre section, exactement
 * comme en HTML : les deux parseurs doivent produire la même forme, sans quoi
 * un candidat extrait d'un PDF ne se comparerait pas à un candidat extrait
 * d'une page web.
 */
function toBlocks(lines: readonly PositionedLine[]): readonly ParsedBlock[] {
  const body = bodySize(lines);
  const levels = headingLevels(lines, body);
  const tables = detectTables(lines);
  const sectionByLevel = new Map<number, string>();
  const blocks: ParsedBlock[] = [];

  function currentPath(): readonly string[] {
    return [...sectionByLevel.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, heading]) => heading);
  }

  for (const line of lines) {
    const table = tables.get(line);
    // Une ligne de tableau n'est jamais un titre : sa taille de police peut
    // dépasser celle du corps sans qu'elle ouvre une section.
    const level = table === undefined ? levels.get(line.size) : undefined;

    if (level !== undefined) {
      for (const known of [...sectionByLevel.keys()]) {
        if (known >= level) sectionByLevel.delete(known);
      }
      sectionByLevel.set(level, line.text);
    }

    const path = currentPath();
    const sectionPath = level === undefined ? path : path.slice(0, -1);
    const heading = level === undefined ? (path[path.length - 1] ?? null) : null;

    if (table !== undefined) {
      // Une cellule par block, comme le parseur HTML en produit pour un
      // `<td>` : c'est ce qui permet à l'extracteur de §84 de lire un tableau
      // de barrières sans savoir de quel format il vient.
      for (const cell of table.cells) {
        const text = joinFragments(cell.map((fragment) => fragment.text));

        if (text === '') continue;

        blocks.push({
          blockIndex: blocks.length,
          pageNumber: line.page,
          sectionPath,
          heading,
          blockType: 'table',
          text,
          locator: {
            page: line.page,
            tableIndex: table.tableIndex,
            rowIndex: table.rowIndex,
            lineIndex: line.lineIndex,
            x: cell[0]?.x ?? line.x,
            y: line.y,
          },
        });
      }

      continue;
    }

    blocks.push({
      blockIndex: blocks.length,
      pageNumber: line.page,
      sectionPath,
      heading,
      blockType: level === undefined ? paragraphType(line.text) : 'heading',
      text: line.text,
      // §20 : de quoi revenir à la position exacte dans le document capturé.
      // La page et la ligne suffisent à retrouver un passage ; les coordonnées
      // permettent de le surligner.
      locator: { page: line.page, lineIndex: line.lineIndex, x: line.x, y: line.y },
    });
  }

  return blocks;
}

/** Une puce reste une liste : §18 la distingue d'un paragraphe. */
function paragraphType(text: string): BlockType {
  return /^\s*(?:[-•·–—*]|\d{1,2}[.)])\s+/.test(text) ? 'list' : 'paragraph';
}
