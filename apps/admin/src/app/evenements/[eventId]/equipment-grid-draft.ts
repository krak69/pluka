/**
 * Le brouillon du tableau du matériel — migration 0048. Pur : ce qu'une case
 * devient au clic, et ce qu'un brouillon envoie à la base. Séparé du
 * composant pour se tester sans navigateur.
 */

import { equipmentKey } from '@pluka/domain';

export type Requirement = 'mandatory' | 'conditional' | 'recommended';
/**
 * `unknown` : publié sans exigence, parce que la source ne la disait pas
 * (§82). La case le montre tel quel ; elle ne se choisit pas, elle se règle.
 */
export type Cell = Requirement | 'unknown' | null;

export interface GridRace {
  readonly id: string;
  readonly name: string;
  readonly detail: string | null;
}

export interface GridRow {
  readonly factKey: string;
  readonly label: string;
  readonly condition: string | null;
  readonly detail: string | null;
  /** Dans l'ordre des épreuves. */
  readonly cells: readonly Cell[];
  readonly sources: readonly string[];
}

export interface Line {
  readonly id: string;
  /** `null` pour une ligne ajoutée, pas encore enregistrée. */
  readonly factKey: string | null;
  readonly label: string;
  readonly condition: string;
  readonly detail: string;
  readonly cells: Readonly<Record<string, Cell>>;
  readonly sources: readonly string[];
}

export const CYCLE: readonly Cell[] = [null, 'recommended', 'conditional', 'mandatory'];

export const STATES: readonly { readonly value: Cell; readonly label: string; readonly key: string }[] = [
  { value: null, label: 'Non concernée', key: '0' },
  { value: 'recommended', label: 'Recommandé', key: '1' },
  { value: 'conditional', label: 'Conditionnel', key: '2' },
  { value: 'mandatory', label: 'Obligatoire', key: '3' },
];

export function labelOf(cell: Cell): string {
  if (cell === 'unknown') return 'Exigence à préciser';
  return STATES.find((state) => state.value === cell)?.label ?? 'Non concernée';
}

export function next(cell: Cell): Cell {
  if (cell === 'unknown') return 'recommended';
  return CYCLE[(CYCLE.indexOf(cell) + 1) % CYCLE.length] ?? null;
}

export function linesOf(rows: readonly GridRow[], races: readonly GridRace[]): Line[] {
  return rows.map((row) => ({
    id: row.factKey,
    factKey: row.factKey,
    label: row.label,
    condition: row.condition ?? '',
    detail: row.detail ?? '',
    cells: Object.fromEntries(races.map((race, index) => [race.id, row.cells[index] ?? null])),
    sources: row.sources,
  }));
}

export function trimmed(value: string): string | null {
  const text = value.trim();
  return text === '' ? null : text;
}

/** La condition ne s'écrit que dans les cases conditionnelles : sans elles, elle ne compte pas. */
function effectiveCondition(line: Line): string {
  return Object.values(line.cells).includes('conditional') ? line.condition.trim() : '';
}

function metaChanged(line: Line, original: Line | undefined): boolean {
  return (
    original === undefined ||
    line.label.trim() !== original.label.trim() ||
    effectiveCondition(line) !== effectiveCondition(original) ||
    line.detail.trim() !== original.detail.trim()
  );
}

/** Ce que la base doit recevoir pour une ligne, ou `null` si elle n'a pas changé. */
export function payloadOf(line: Line, original: Line | undefined, races: readonly GridRace[]) {
  const meta = metaChanged(line, original);
  const requirements: Record<string, Cell> = {};

  for (const race of races) {
    const cell = line.cells[race.id] ?? null;
    const before = original?.cells[race.id] ?? null;
    // Une exigence inconnue n'est jamais envoyée : la base n'invente pas ce que
    // la source ne dit pas, et le tableau non plus.
    if (cell === 'unknown') continue;
    // Le nom ou la précision changent : chaque case affichée prend la nouvelle
    // valeur. Sinon, seules les cases touchées partent — une case intacte ne
    // doit pas créer de version.
    if (cell !== before || (meta && cell !== null)) requirements[race.id] = cell;
  }

  if (Object.keys(requirements).length === 0) return null;

  return {
    factKey: line.factKey,
    label: line.label.trim(),
    condition: trimmed(line.condition),
    detail: trimmed(line.detail),
    requirements,
  };
}


/** Le nombre de cases dont l'exigence a changé. */
export function changedCellCount(
  lines: readonly Line[],
  originals: ReadonlyMap<string, Line>,
  races: readonly GridRace[],
): number {
  return lines.reduce(
    (sum, line) =>
      sum +
      races.filter(
        (race) =>
          (line.cells[race.id] ?? null) !== (originals.get(line.id)?.cells[race.id] ?? null),
      ).length,
    0,
  );
}

/** La clé d'un nom : celle que la base donnera à une ligne ajoutée. */
export function labelKey(label: string): string | null {
  return equipmentKey(label);
}

/** La clé d'une ligne : la sienne si elle est publiée, sinon celle de son nom. */
export function keyOf(line: Pick<Line, 'factKey' | 'label'>): string | null {
  return line.factKey ?? labelKey(line.label);
}

function normalized(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    // « 80 K », « 80K », « 80-k » : la même épreuve.
    .replace(/[^a-z0-9]+/g, '');
}

export interface RaceMatch {
  readonly from: GridRace;
  readonly to: GridRace;
}

/**
 * Associe les épreuves de l'édition précédente à celles-ci : même nom
 * d'abord, sinon même distance. Une épreuve sans correspondance n'est pas
 * devinée — elle est dite.
 */
export function matchRaces(
  previous: readonly GridRace[],
  current: readonly GridRace[],
): { readonly matches: readonly RaceMatch[]; readonly unmatched: readonly GridRace[] } {
  const taken = new Set<string>();
  const matches: RaceMatch[] = [];
  const pick = (from: GridRace, same: (to: GridRace) => boolean): boolean => {
    const to = current.find((race) => !taken.has(race.id) && same(race));
    if (to === undefined) return false;
    taken.add(to.id);
    matches.push({ from, to });
    return true;
  };

  const rest = previous.filter(
    (from) => !pick(from, (to) => normalized(to.name) === normalized(from.name)),
  );
  const unmatched = rest.filter(
    (from) => from.detail === null || !pick(from, (to) => to.detail === from.detail),
  );

  return { matches, unmatched };
}

/**
 * Reprend le matériel de l'édition précédente dans le brouillon. Pour chaque
 * épreuve associée, la case prend l'exigence d'alors ; une ligne absente
 * d'aujourd'hui s'ajoute, une ligne présente garde son nom. Une exigence
 * inconnue n'est pas reprise. Rien n'est publié : on ajuste, puis on
 * enregistre.
 */
export function importPrevious(
  lines: readonly Line[],
  previous: { readonly races: readonly GridRace[]; readonly rows: readonly GridRow[] },
  races: readonly GridRace[],
  newId: () => string,
): { readonly lines: readonly Line[]; readonly added: number; readonly updated: number; readonly matches: readonly RaceMatch[]; readonly unmatched: readonly GridRace[] } {
  const { matches, unmatched } = matchRaces(previous.races, races);
  const result = [...lines];
  let added = 0;
  let updated = 0;

  for (const row of previous.rows) {
    const cells: Record<string, Cell> = {};
    for (const match of matches) {
      const index = previous.races.findIndex((race) => race.id === match.from.id);
      const cell = row.cells[index] ?? null;
      if (cell !== 'unknown') cells[match.to.id] = cell;
    }
    if (!Object.values(cells).some((cell) => cell !== null)) continue;

    const at = result.findIndex((line) => keyOf(line) === row.factKey);
    const existing = result[at];
    if (existing !== undefined) {
      const merged = { ...existing.cells, ...cells };
      if (races.some((race) => (merged[race.id] ?? null) !== (existing.cells[race.id] ?? null))) {
        result[at] = { ...existing, cells: merged };
        updated += 1;
      }
      continue;
    }

    result.push({
      id: newId(),
      factKey: null,
      label: row.label,
      condition: row.condition ?? '',
      detail: row.detail ?? '',
      cells: Object.fromEntries(races.map((race) => [race.id, cells[race.id] ?? null])),
      sources: [],
    });
    added += 1;
  }

  return { lines: result, added, updated, matches, unmatched };
}

/**
 * Une liste collée depuis un règlement : un matériel par ligne. Les puces et
 * numéros de liste sont retirés, rien d'autre — le nom reste celui du
 * règlement, et aucune exigence n'est lue dans le texte.
 */
export function pastedLabels(text: string): readonly string[] {
  const seen = new Set<string>();
  const labels: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const label = raw
      .replace(/^\s*(?:[-–—•·*▪◦●○■□✓✔]+|\(?\d{1,2}[.)]|[a-z][.)])\s+/i, '')
      .replace(/\s+/g, ' ')
      .replace(/[;,.]+$/, '')
      .trim();
    const key = equipmentKey(label);
    if (label.length < 2 || key === null || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }

  return labels;
}
