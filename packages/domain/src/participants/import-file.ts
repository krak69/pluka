/**
 * Lire et juger un fichier de participants — 00_PRODUCT_SPEC §29.1.
 *
 * Module pur. Un tableur français exporte en point-virgule et souvent en
 * Windows-1252 : le fichier se lit tel qu'il arrive, sans demander de réglage.
 * Une ligne refusée n'arrête pas les autres : elle se dit, et l'organisation
 * décide (AC-B2B-PART-03).
 */

export const MAX_IMPORT_ROWS = 5000;

export interface ParsedFile {
  readonly headers: readonly string[];
  readonly rows: readonly Readonly<Record<string, string>>[];
}

/** UTF-8 s'il est valide, sinon Windows-1252 : ce qu'Excel écrit en France. */
export function decodeFile(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/u, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function delimiterOf(firstLine: string): string {
  const candidates = [';', ',', '\t'];
  let best = ';';
  let bestCount = -1;
  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** RFC 4180 : les guillemets protègent séparateurs et retours à la ligne. */
function parseRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char !== '"') field += char;
      else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = false;
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === delimiter) {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  return records.filter((row) => row.some((cell) => cell.trim() !== ''));
}

export function parseParticipantFile(text: string): ParsedFile {
  const delimiter = delimiterOf(text.split(/\r?\n/u, 1)[0] ?? '');
  const [head, ...body] = parseRecords(text, delimiter);
  if (head === undefined) return { headers: [], rows: [] };

  // Deux colonnes de même nom ne doivent pas s'écraser.
  const seen = new Map<string, number>();
  const headers = head.map((cell, index) => {
    const name = cell.trim() === '' ? `Colonne ${String(index + 1)}` : cell.trim();
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name} (${String(count)})`;
  });

  return {
    headers,
    rows: body.map((cells) =>
      Object.fromEntries(headers.map((header, index) => [header, (cells[index] ?? '').trim()])),
    ),
  };
}

export const PARTICIPANT_FIELDS = [
  { key: 'firstName', label: 'Prénom', required: true, hints: ['prenom', 'firstname', 'first name'] },
  { key: 'lastName', label: 'Nom', required: true, hints: ['nom', 'lastname', 'last name', 'nom de famille'] },
  { key: 'email', label: 'E-mail', required: true, hints: ['email', 'e-mail', 'mail', 'courriel'] },
  { key: 'race', label: 'Épreuve', required: false, hints: ['epreuve', 'course', 'distance', 'race'] },
  { key: 'bib', label: 'Dossard', required: false, hints: ['dossard', 'bib', 'numero'] },
  { key: 'wave', label: 'Vague', required: false, hints: ['vague', 'sas', 'wave'] },
  { key: 'sex', label: 'Sexe', required: false, hints: ['sexe', 'genre', 'sex', 'gender'] },
  { key: 'birthDate', label: 'Date de naissance', required: false, hints: ['naissance', 'date de naissance', 'birth', 'ddn'] },
  { key: 'nationality', label: 'Nationalité', required: false, hints: ['nationalite', 'nationality', 'pays', 'nat'] },
  { key: 'itraIndex', label: 'Indice ITRA', required: false, hints: ['itra', 'indice itra', 'itra index'] },
  { key: 'utmbIndex', label: 'UTMB Index', required: false, hints: ['utmb', 'utmb index', 'indice utmb'] },
  { key: 'itraId', label: 'Identifiant ITRA', required: false, hints: ['id itra', 'itra id', 'runner id'] },
  { key: 'utmbId', label: 'Identifiant UTMB', required: false, hints: ['id utmb', 'utmb id'] },
] as const;

export type ParticipantFieldKey = (typeof PARTICIPANT_FIELDS)[number]['key'];

export type ParticipantColumns = Partial<Record<ParticipantFieldKey, string>>;

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Une proposition, jamais une décision : l'organisation voit et corrige (AC-B2B-PART-02). */
export function suggestColumns(headers: readonly string[]): ParticipantColumns {
  const columns: ParticipantColumns = {};
  const taken = new Set<string>();

  for (const field of PARTICIPANT_FIELDS) {
    const exact = headers.find(
      (header) => !taken.has(header) && (field.hints as readonly string[]).includes(normalize(header)),
    );
    const partial =
      exact ??
      headers.find(
        (header) =>
          !taken.has(header) &&
          field.hints.some((hint) => hint.length > 3 && normalize(header).includes(hint)),
      );
    if (partial !== undefined) {
      columns[field.key] = partial;
      taken.add(partial);
    }
  }

  return columns;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;

function birthDateOf(value: string): string | null {
  const french = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/u.exec(value);
  const iso = french === null ? /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value) : null;
  const [day, month, year] =
    french === null ? [iso?.[3], iso?.[2], iso?.[1]] : [french[1], french[2], french[3]];
  if (day === undefined || month === undefined || year === undefined) return null;

  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date) ? date : null;
}

function sexOf(value: string): 'female' | 'male' | 'other' | null {
  const normalized = normalize(value);
  if (['f', 'femme', 'female', 'feminin'].includes(normalized)) return 'female';
  if (['m', 'h', 'homme', 'male', 'masculin'].includes(normalized)) return 'male';
  if (['x', 'autre', 'other', 'nb', 'non binaire'].includes(normalized)) return 'other';
  return null;
}

function indexOf(value: string): number | null {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 2000 ? parsed : null;
}

export interface ImportRace {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface JudgedRow {
  readonly rowNumber: number;
  readonly status: 'valid' | 'error' | 'skipped';
  readonly error: string | null;
  readonly mapped: Readonly<Record<string, string | number>> | null;
}

/**
 * Juger chaque ligne. Pure : le doublon qu'on voit ici est celui du fichier ;
 * celui déjà en base se traite à l'import, dans la même transaction que
 * l'écriture.
 */
export function judgeRows(
  rows: readonly { readonly rowNumber: number; readonly data: Readonly<Record<string, string>> }[],
  columns: ParticipantColumns,
  races: readonly ImportRace[],
): readonly JudgedRow[] {
  const seen = new Set<string>();
  const onlyRace = races.length === 1 ? races[0] : undefined;

  return rows.map(({ rowNumber, data }) => {
    const read = (key: ParticipantFieldKey): string => {
      const column = columns[key];
      return column === undefined ? '' : (data[column] ?? '').trim();
    };
    const refuse = (error: string): JudgedRow => ({ rowNumber, status: 'error', error, mapped: null });

    const firstName = read('firstName');
    const lastName = read('lastName');
    const email = read('email').toLowerCase();

    if (firstName === '' || lastName === '') return refuse('Prénom ou nom manquant.');
    if (!EMAIL.test(email)) return refuse('Adresse e-mail invalide.');

    const raceValue = normalize(read('race'));
    const race =
      raceValue === ''
        ? onlyRace
        : races.find(
            (candidate) =>
              normalize(candidate.name) === raceValue || normalize(candidate.slug) === raceValue,
          );
    if (race === undefined) {
      return refuse(raceValue === '' ? 'Épreuve manquante.' : `Épreuve inconnue : ${read('race')}.`);
    }

    const key = `${race.id}|${email}`;
    if (seen.has(key)) {
      return { rowNumber, status: 'skipped', error: 'En double dans le fichier.', mapped: null };
    }
    seen.add(key);

    const mapped: Record<string, string | number> = {
      raceId: race.id,
      email,
      firstName,
      lastName,
    };

    for (const key of ['bib', 'wave', 'nationality', 'itraId', 'utmbId'] as const) {
      const value = read(key);
      if (value !== '') mapped[key] = value;
    }

    const rawSex = read('sex');
    if (rawSex !== '') {
      const sex = sexOf(rawSex);
      if (sex === null) return refuse(`Sexe non reconnu : ${rawSex}.`);
      mapped['sex'] = sex;
    }

    const rawBirth = read('birthDate');
    if (rawBirth !== '') {
      const birthDate = birthDateOf(rawBirth);
      if (birthDate === null) return refuse(`Date de naissance illisible : ${rawBirth}.`);
      mapped['birthDate'] = birthDate;
    }

    for (const key of ['itraIndex', 'utmbIndex'] as const) {
      const raw = read(key);
      if (raw === '') continue;
      const value = indexOf(raw);
      if (value === null) return refuse(`Indice illisible : ${raw}.`);
      mapped[key] = value;
    }

    return { rowNumber, status: 'valid', error: null, mapped };
  });
}
