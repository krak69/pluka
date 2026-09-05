import type { ParsedBlock } from '../parsing/blocks.js';
import type { ParsedChunk } from '../parsing/chunk.js';
import {
  factKeyOf,
  type CandidateEvidence,
  type ConfidenceLabel,
  type ExtractedCandidate,
  type FactCategory,
} from './candidates.js';

/**
 * Extraction déterministe — docs/engines/SOURCES_EXTRACTION.md §29.
 *
 * > « Ne pas utiliser un LLM pour parser ce qu'un parseur déterministe sait
 * > déjà lire proprement. »
 *
 * §29 nomme ce qui relève de cette couche : dates, horaires, tableaux bien
 * structurés, coordonnées, formats connus. Trois familles sont implémentées
 * ici, choisies parce qu'elles sont à la fois fréquentes dans un règlement et
 * exactement lisibles sans interprétation :
 *
 * 1. les **barrières horaires en tableau** (§84) ;
 * 2. l'**heure de départ** (§79) ;
 * 3. les **distances et dénivelés** (§80).
 *
 * Ce qui demande de comprendre une phrase — une règle d'assistance, une
 * condition de matériel — n'est pas ici : c'est le domaine de l'IA, et elle
 * n'intervient qu'après.
 *
 * Aucune de ces fonctions ne devine. Quand le document ne dit pas, le candidat
 * sort incomplet et marqué à revoir : §84 l'exige pour la base d'une barrière,
 * et le principe vaut partout ailleurs.
 */

/**
 * Version de l'extracteur déterministe.
 *
 * §76 : « une modification pouvant changer les candidats doit être
 * identifiable ». Cette version entre dans le run au même titre que celle du
 * parseur.
 */
export const DETERMINISTIC_EXTRACTOR_VERSION = 'deterministic-1.0.0';

/** Longueur maximale d'un extrait de preuve — §20. */
const EXCERPT_MAX = 240;

const MONTHS: Readonly<Record<string, number>> = {
  janvier: 1,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
};

export interface DeterministicInput {
  readonly blocks: readonly ParsedBlock[];
  readonly chunks: readonly ParsedChunk[];
}

export interface DeterministicOutcome {
  readonly candidates: readonly ExtractedCandidate[];
  /**
   * Blocks effectivement lus par une règle.
   *
   * Distinct des blocks cités en preuve : l'en-tête d'un tableau de barrières
   * est lu — c'est lui qui donne la base horaire — sans produire de candidat.
   * §29 a besoin de cette liste-là, pas de celle des preuves : c'est elle qui
   * dit ce qu'il est inutile de soumettre au modèle.
   *
   * Une cellule qu'aucune règle ne regarde — une colonne « commentaire » dans
   * un tableau de barrières — n'y figure pas, et son chunk part donc à l'IA.
   * L'inverse ferait disparaître une information que personne n'a lue.
   */
  readonly readBlockIndexes: ReadonlySet<number>;
}

interface Pass {
  readonly candidates: readonly ExtractedCandidate[];
  readonly read: readonly number[];
}

export function extractDeterministic(input: DeterministicInput): DeterministicOutcome {
  const chunkOf = chunkIndexByBlock(input.chunks);

  const passes = [
    extractCutoffTables(input.blocks, chunkOf),
    extractStartTimes(input.blocks, chunkOf),
    extractMeasurements(input.blocks, chunkOf),
  ];

  return {
    candidates: passes.flatMap((pass) => pass.candidates),
    readBlockIndexes: new Set(passes.flatMap((pass) => pass.read)),
  };
}

// ============================================================
// Barrières horaires (§84)
// ============================================================

interface TableRow {
  readonly rowIndex: number;
  readonly cells: readonly ParsedBlock[];
}

/**
 * §84 : « une barrière doit conserver : waypoint ; horaire ; basis si
 * disponible ». Le tableau est le format où ces trois éléments sont
 * effectivement lisibles sans interprétation — d'où le choix de §29 de le
 * traiter ici plutôt que par un modèle.
 */
function extractCutoffTables(
  blocks: readonly ParsedBlock[],
  chunkOf: ReadonlyMap<number, number>,
): Pass {
  const candidates: ExtractedCandidate[] = [];
  const read: number[] = [];

  for (const [, rows] of groupTables(blocks)) {
    const header = rows[0];
    if (header === undefined || rows.length < 2) continue;

    if (!header.cells.some((cell) => looksLikeCutoffHeader(cell.text))) continue;

    // L'en-tête est lu en entier : c'est lui qui porte la base horaire de §84.
    for (const cell of header.cells) read.push(cell.blockIndex);

    for (const row of rows.slice(1)) {
      const found = cutoffFromRow(row, header, chunkOf);
      if (found === null) continue;

      candidates.push(found.candidate);
      read.push(...found.read);
    }
  }

  return { candidates, read };
}

function looksLikeCutoffHeader(text: string): boolean {
  return /barri[eè]re|cut[- ]?off|heure limite|temps limite/i.test(text);
}

function cutoffFromRow(
  row: TableRow,
  header: TableRow,
  chunkOf: ReadonlyMap<number, number>,
): { readonly candidate: ExtractedCandidate; readonly read: readonly number[] } | null {
  const timeCellIndex = row.cells.findIndex((cell) => readTime(cell.text) !== null);
  if (timeCellIndex < 0) return null;

  const timeCell = row.cells[timeCellIndex] as ParsedBlock;
  const time = readTime(timeCell.text);
  if (time === null) return null;

  // Le waypoint est la première cellule textuelle qui ne porte pas d'horaire :
  // dans un tableau de barrières, c'est le nom du point.
  const nameCell = row.cells.find(
    (cell) => readTime(cell.text) === null && /[a-zA-ZÀ-ÿ]{2}/.test(cell.text),
  );

  if (nameCell === undefined) return null;

  // §84 : « si la source ne permet pas de savoir si l'horaire est basé sur
  // l'arrivée ou le départ : ne pas inventer ». La base est lue dans l'en-tête
  // de la colonne, à défaut dans le titre de section — jamais supposée.
  const fromColumn = readBasis(header.cells[timeCellIndex]?.text ?? '');
  const fromSection = readBasis(sectionText(timeCell));
  const basis = fromColumn ?? fromSection;

  const notes =
    basis === null
      ? 'base horaire absente du document : arrivée ou départ non déterminé, à confirmer manuellement (§84)'
      : fromColumn !== null
        ? "base horaire lue dans l'en-tête de colonne"
        : 'base horaire lue dans le titre de section';

  return {
    candidate: build({
      factType: 'cutoff',
      subjectKey: nameCell.text,
      context: basis,
      valueText: time.value,
      valueJson: { waypoint: nameCell.text, basis, raw: timeCell.text },
      // Un horaire lu dans une cellule ne s'interprète pas : la seule
      // incertitude porte sur la base, et elle est portée par `reviewState`.
      confidence: 'high',
      notes,
      reviewState: basis === null ? 'needs_review' : 'detected',
      evidence: [
        evidenceOf(timeCell, chunkOf, true),
        ...(nameCell.blockIndex === timeCell.blockIndex
          ? []
          : [evidenceOf(nameCell, chunkOf, false)]),
      ],
    }),
    read: [timeCell.blockIndex, nameCell.blockIndex],
  };
}

function readBasis(text: string): 'arrival' | 'departure' | null {
  if (/arriv/i.test(text)) return 'arrival';
  if (/d[ée]part|sortie/i.test(text)) return 'departure';
  return null;
}

function groupTables(blocks: readonly ParsedBlock[]): ReadonlyMap<number, readonly TableRow[]> {
  const tables = new Map<number, Map<number, ParsedBlock[]>>();

  for (const block of blocks) {
    if (block.blockType !== 'table') continue;

    const tableIndex = block.locator.tableIndex;
    const rowIndex = block.locator.rowIndex;
    if (tableIndex === undefined || rowIndex === undefined) continue;

    const rows = tables.get(tableIndex) ?? new Map<number, ParsedBlock[]>();
    const cells = rows.get(rowIndex) ?? [];

    cells.push(block);
    rows.set(rowIndex, cells);
    tables.set(tableIndex, rows);
  }

  const result = new Map<number, readonly TableRow[]>();

  for (const [tableIndex, rows] of tables) {
    result.set(
      tableIndex,
      [...rows.entries()]
        .sort(([left], [right]) => left - right)
        .map(([rowIndex, cells]) => ({ rowIndex, cells })),
    );
  }

  return result;
}

// ============================================================
// Heure de départ (§79)
// ============================================================

/**
 * §79 : « toute date / heure extraite doit essayer de conserver : date ;
 * heure locale ; timezone si résolue ; contexte de Race ».
 *
 * Aucun fuseau n'est résolu ici : un règlement écrit « 7h10 » sans dire dans
 * quel fuseau, et le déduire du pays serait une supposition. L'heure reste
 * locale, la note le dit, et le rattachement à l'édition reste une décision de
 * la couche domaine — §79 : « toute résolution contextuelle doit rester
 * traçable ».
 */
function extractStartTimes(
  blocks: readonly ParsedBlock[],
  chunkOf: ReadonlyMap<number, number>,
): Pass {
  const found: {
    readonly block: ParsedBlock;
    readonly time: string;
    readonly date: string | null;
  }[] = [];

  for (const block of blocks) {
    if (block.blockType === 'table') continue;

    if (!/d[ée]part|start/i.test(`${sectionText(block)} ${block.text}`)) continue;

    const time = readTime(block.text);
    if (time === null) continue;

    found.push({ block, time: time.value, date: readDate(block.text) });
  }

  if (found.length === 0) return { candidates: [], read: [] };

  // Deux heures de départ différentes dans un même document : vagues, épreuves
  // distinctes, ou contradiction. §36 en fera un conflit ; ici on refuse de
  // trancher et on marque à revoir.
  const ambiguous = new Set(found.map((entry) => entry.time)).size > 1;

  const candidates = found.map((entry) =>
    build({
      factType: 'start',
      subjectKey: 'start_time',
      context: null,
      valueText: entry.time,
      valueJson: { localTime: entry.time, date: entry.date, timezone: null },
      validFrom: entry.date,
      confidence: ambiguous ? 'medium' : 'high',
      notes: ambiguous
        ? 'plusieurs heures de départ distinctes dans ce document : vagues ou épreuves à distinguer'
        : "heure locale telle qu'écrite ; aucun fuseau résolu (§79)",
      reviewState: ambiguous ? 'needs_review' : 'detected',
      evidence: [evidenceOf(entry.block, chunkOf, true)],
    }),
  );

  return { candidates, read: found.map((entry) => entry.block.blockIndex) };
}

// ============================================================
// Distances et dénivelés (§80)
// ============================================================

/**
 * §80 : « les valeurs structurées doivent être normalisées […] mais la valeur
 * originale doit rester récupérable dans l'evidence ».
 *
 * D'où la répartition : `valueNumber` porte 4600, l'extrait de preuve porte
 * « 4'600 m D+ ». La normalisation ne remplace pas la citation.
 */
function extractMeasurements(
  blocks: readonly ParsedBlock[],
  chunkOf: ReadonlyMap<number, number>,
): Pass {
  const candidates: ExtractedCandidate[] = [];
  const read: number[] = [];

  for (const block of blocks) {
    for (const measure of readMeasurements(block.text)) {
      read.push(block.blockIndex);
      candidates.push(
        build({
          factType: 'course',
          subjectKey: measure.subjectKey,
          context: null,
          valueNumber: measure.value,
          unit: measure.unit,
          confidence: 'high',
          notes: measure.note,
          reviewState: 'detected',
          evidence: [evidenceOf(block, chunkOf, true, measure.raw)],
        }),
      );
    }
  }

  return { candidates, read };
}

interface Measurement {
  readonly subjectKey: string;
  readonly value: number;
  readonly unit: string;
  readonly raw: string;
  readonly note: string | null;
}

/** Un nombre écrit à la française ou à la suisse : `4600`, `4'600`, `4 600`, `42,195`. */
const NUMBER = String.raw`\d[\d  '’ .,]*\d|\d`;

const MEASUREMENT_PATTERNS: readonly (readonly [RegExp, string])[] = [
  // D+ / D- écrits dans les deux ordres usuels : « 4'600 m D+ » et « D+ : 4600 m ».
  [
    new RegExp(String.raw`(${NUMBER})\s*(km|m)\b[^.;\n]{0,12}?(?:D\s*\+|dénivelé positif)`, 'i'),
    'elevation_gain',
  ],
  [
    new RegExp(String.raw`(?:D\s*\+|dénivelé positif)\s*[:=]?\s*(${NUMBER})\s*(km|m)\b`, 'i'),
    'elevation_gain',
  ],
  [
    new RegExp(String.raw`(${NUMBER})\s*(km|m)\b[^.;\n]{0,12}?(?:D\s*[-−]|dénivelé négatif)`, 'i'),
    'elevation_loss',
  ],
  [
    new RegExp(String.raw`(?:D\s*[-−]|dénivelé négatif)\s*[:=]?\s*(${NUMBER})\s*(km|m)\b`, 'i'),
    'elevation_loss',
  ],
];

const DISTANCE_PATTERN = new RegExp(
  String.raw`(?:distance|parcours|longueur)[^.;\n]{0,20}?(${NUMBER})\s*km\b` +
    String.raw`|(${NUMBER})\s*km\b[^.;\n]{0,15}?(?:de (?:course|parcours|distance)|au total)`,
  'i',
);

function readMeasurements(text: string): readonly Measurement[] {
  const found: Measurement[] = [];
  const seen = new Set<string>();

  function push(measure: Measurement): void {
    if (seen.has(measure.subjectKey)) return;
    seen.add(measure.subjectKey);
    found.push(measure);
  }

  for (const [pattern, subjectKey] of MEASUREMENT_PATTERNS) {
    const match = pattern.exec(text);
    if (match === null) continue;

    const value = readNumber(match[1] ?? '');
    if (value === null) continue;

    const unit = (match[2] ?? 'm').toLowerCase();

    // §80 demande des unités normalisées : un dénivelé se compte en mètres. La
    // conversion est arithmétique, pas interprétative, et reste dite dans la note.
    push({
      subjectKey,
      value: unit === 'km' ? value * 1000 : value,
      unit: 'm',
      raw: match[0],
      note: unit === 'km' ? 'valeur convertie de km en m (§80)' : null,
    });
  }

  const distance = DISTANCE_PATTERN.exec(text);

  if (distance !== null) {
    const value = readNumber(distance[1] ?? distance[2] ?? '');
    if (value !== null) {
      push({ subjectKey: 'distance', value, unit: 'km', raw: distance[0], note: null });
    }
  }

  return found;
}

/**
 * Lit un nombre écrit à la française ou à la suisse.
 *
 * `4'600`, `4 600`, `4 600` (espace fine) désignent tous 4600 ; `42,195`
 * désigne 42.195. Le point n'est jamais traité comme séparateur de milliers :
 * `4.600` serait ambigu, et une ambiguïté résolue au jugé produirait un
 * dénivelé faux présenté comme une lecture exacte.
 */
export function readNumber(raw: string): number | null {
  const cleaned = raw.replace(/['’  \s]/g, '').replace(',', '.');

  if (cleaned === '') return null;

  const value = Number(cleaned);

  return Number.isFinite(value) ? value : null;
}

// ============================================================
// Horaires et dates
// ============================================================

/** `7h10`, `07 h 10`, `07:10`, `7h`. Rend l'horaire normalisé et l'extrait lu. */
export function readTime(text: string): { readonly value: string; readonly raw: string } | null {
  const match = /\b(\d{1,2})\s*(?:h|:)\s*(\d{2})?\b/i.exec(text);
  if (match === null) return null;

  const hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);

  if (hours > 23 || minutes > 59) return null;

  return {
    value: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
    raw: match[0],
  };
}

/** Date ISO ou date française écrite en toutes lettres. Rien d'autre n'est deviné. */
export function readDate(text: string): string | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso !== null) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const french = /\b(\d{1,2})\s+([a-zà-ÿ]+)\s+(\d{4})\b/i.exec(text);
  if (french === null) return null;

  const month = MONTHS[stripAccents(french[2] ?? '').toLowerCase()];
  if (month === undefined) return null;

  return `${french[3]}-${String(month).padStart(2, '0')}-${(french[1] ?? '').padStart(2, '0')}`;
}

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ============================================================
// Provenance
// ============================================================

function chunkIndexByBlock(chunks: readonly ParsedChunk[]): ReadonlyMap<number, number> {
  const map = new Map<number, number>();

  for (const chunk of chunks) {
    for (const blockIndex of chunk.blockIndexes) {
      // Le recouvrement place un block dans deux chunks : le premier fait foi,
      // pour que la preuve soit stable d'un run à l'autre.
      if (!map.has(blockIndex)) map.set(blockIndex, chunk.chunkIndex);
    }
  }

  return map;
}

function evidenceOf(
  block: ParsedBlock,
  chunkOf: ReadonlyMap<number, number>,
  isPrimary: boolean,
  excerpt?: string,
): CandidateEvidence {
  return {
    blockIndex: block.blockIndex,
    chunkIndex: chunkOf.get(block.blockIndex) ?? null,
    pageNumber: block.pageNumber,
    sectionPath: block.sectionPath,
    locator: block.locator,
    excerpt: truncate(excerpt ?? block.text),
    isPrimary,
  };
}

function sectionText(block: ParsedBlock): string {
  return [...block.sectionPath, block.heading ?? ''].join(' ');
}

function truncate(text: string): string {
  return text.length <= EXCERPT_MAX ? text : `${text.slice(0, EXCERPT_MAX - 1)}…`;
}

function build(input: {
  readonly factType: FactCategory;
  readonly subjectKey: string;
  readonly context: string | null;
  readonly valueText?: string | null;
  readonly valueNumber?: number | null;
  readonly unit?: string | null;
  readonly valueJson?: Readonly<Record<string, unknown>> | null;
  readonly validFrom?: string | null;
  readonly confidence: ConfidenceLabel;
  readonly notes: string | null;
  readonly reviewState: 'detected' | 'needs_review';
  readonly evidence: readonly CandidateEvidence[];
}): ExtractedCandidate {
  return {
    factType: input.factType,
    subjectKey: input.subjectKey,
    context: input.context,
    factKey: factKeyOf(input),
    valueText: input.valueText ?? null,
    valueNumber: input.valueNumber ?? null,
    unit: input.unit ?? null,
    valueJson: input.valueJson ?? null,
    validFrom: input.validFrom ?? null,
    validTo: null,
    evidence: input.evidence,
    confidence: input.confidence,
    notes: input.notes,
    origin: 'deterministic',
    reviewState: input.reviewState,
  };
}
