'use client';

import {
  useActionState,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

import type { ActionState } from '@/app/actions';
import {
  changedCellCount,
  importPrevious,
  keyOf,
  labelKey,
  labelOf,
  linesOf,
  next,
  pastedLabels,
  payloadOf,
  STATES,
  trimmed,
  type Cell,
  type GridRace,
  type GridRow,
  type Line,
  type Requirement,
} from '@/app/evenements/[eventId]/equipment-grid-draft';
import { RequirementGlyph } from '@/app/evenements/[eventId]/equipment-glyph';
import { decideEquipmentProposalAction, saveEditionEquipmentAction } from '@/app/fact-actions';

export type { GridRace, GridRow } from '@/app/evenements/[eventId]/equipment-grid-draft';

/**
 * Le tableau du matériel d'une édition — migration 0048.
 *
 * Une ligne par pièce, une colonne par épreuve, une exigence par case. Un
 * clic fait passer la case à l'exigence suivante (non concernée → recommandée
 * → conditionnelle → obligatoire → non concernée) ; un clic droit ou un appui
 * long ouvre le choix direct ; au clavier, 0 à 3.
 *
 * Rien n'est publié au clic : les clics forment un brouillon, et
 * « Enregistrer » l'applique en une transaction. Une hésitation ne crée ni
 * trois versions, ni trois alertes aux coureurs.
 */

function CellMenu({
  current,
  onPick,
  onClose,
}: {
  readonly current: Cell;
  readonly onPick: (value: Cell) => void;
  readonly onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const away = (event: globalThis.PointerEvent) => {
      if (menu.current !== null && !menu.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [onClose]);

  return (
    <div
      ref={menu}
      className="ad-grid-menu"
      role="menu"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {STATES.map((state) => (
        <button
          key={state.key}
          type="button"
          role="menuitemradio"
          aria-checked={state.value === current}
          className="ad-grid-menu-item"
          onClick={() => onPick(state.value)}
        >
          <RequirementGlyph value={state.value} />
          <span>{state.label}</span>
          <kbd>{state.key}</kbd>
        </button>
      ))}
    </div>
  );
}

function GridCell({
  race,
  line,
  value,
  changed,
  onSet,
  onPaintStart,
  onPaintEnter,
}: {
  readonly race: GridRace;
  readonly line: Line;
  readonly value: Cell;
  readonly changed: boolean;
  readonly onSet: (value: Cell) => void;
  /** Souris ou stylet : la case prend l'état suivant, et le geste peint les cases survolées. */
  readonly onPaintStart: (value: Cell) => void;
  readonly onPaintEnter: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  // Le clic qui suit un appui déjà traité ne refait pas le geste.
  const pointerHandled = useRef(false);

  const cancelPress = () => {
    if (press.current !== null) clearTimeout(press.current);
    press.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const state = STATES.find((entry) => entry.key === event.key);
    if (state !== undefined) {
      event.preventDefault();
      onSet(state.value);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onSet(null);
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      setMenu(true);
    }
  };

  // Souris : l'appui change la case et commence à peindre. Écran tactile :
  // un appui long ouvre le choix direct, comme le clic droit.
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== 'touch') {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      pointerHandled.current = true;
      onPaintStart(next(value));
      return;
    }
    longPressed.current = false;
    press.current = setTimeout(() => {
      longPressed.current = true;
      setMenu(true);
    }, 450);
  };

  return (
    <td className="ad-grid-td" data-changed={changed ? 'true' : 'false'}>
      <button
        type="button"
        className="ad-grid-cell"
        data-state={value ?? 'none'}
        aria-haspopup="menu"
        aria-label={`${line.label.trim() || 'Nouveau matériel'} — ${race.name} : ${labelOf(value)}${
          changed ? ' (modifié)' : ''
        }. Clic : ${labelOf(next(value)).toLowerCase()}.`}
        title={`${race.name} : ${labelOf(value)}`}
        onClick={() => {
          if (pointerHandled.current) {
            pointerHandled.current = false;
            return;
          }
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          onSet(next(value));
        }}
        onPointerEnter={onPaintEnter}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu(true);
        }}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
      >
        <RequirementGlyph value={value} />
      </button>
      {menu ? (
        <CellMenu
          current={value}
          onPick={(picked) => {
            onSet(picked);
            setMenu(false);
          }}
          onClose={() => setMenu(false)}
        />
      ) : null}
    </td>
  );
}

const INITIAL: ActionState = {};

/**
 * Une ligne proposée par les sources. Chaque case montre l'exigence lue ; là
 * où la pièce est déjà publiée, la case dit ce qui change (« actuel →
 * proposé ») ou « = ». Accepter et écarter sont des gestes de revue, publiés
 * aussitôt : ils attendent donc que le brouillon soit enregistré.
 */
function ProposalRow({
  eventId,
  editionId,
  races,
  proposal,
  current,
  locked,
}: {
  readonly eventId: string;
  readonly editionId: string;
  readonly races: readonly GridRace[];
  readonly proposal: GridProposal;
  /** La ligne publiée de même clé, si elle existe. */
  readonly current: Line | undefined;
  /** Un brouillon est en cours : la revue attend qu'il soit enregistré. */
  readonly locked: boolean;
}) {
  const [state, action, pending] = useActionState(decideEquipmentProposalAction, INITIAL);
  const candidateIds = proposal.cells
    .map((cell) => cell?.candidateId ?? null)
    .filter((candidateId): candidateId is string => candidateId !== null);
  const conditions = [
    ...new Set(
      proposal.cells
        .map((cell) => cell?.condition ?? null)
        .filter((condition): condition is string => condition !== null),
    ),
  ];

  return (
    <tr className="ad-grid-tr ad-grid-proposal">
      <th scope="row" className="ad-grid-item">
        <div className="ad-grid-item-button ad-grid-proposal-item">
          <span className="ad-grid-name">{proposal.label}</span>
          <span className="ad-grid-flag ad-grid-flag-proposal">
            {current === undefined ? 'Proposé' : 'Changement proposé'}
          </span>
          {conditions.length === 0 ? null : (
            <span className="ad-grid-meta">{conditions.join(' · ')}</span>
          )}
          {proposal.excerpt === null ? null : (
            <details className="ad-grid-evidence">
              <summary>{proposal.source ?? 'Source'}</summary>
              <blockquote>{proposal.excerpt}</blockquote>
            </details>
          )}
        </div>
      </th>
      {races.map((race, index) => {
        const cell = proposal.cells[index] ?? null;
        const before = current?.cells[race.id] ?? null;
        const proposed: Cell = cell === null ? null : (cell.requirement ?? 'unknown');
        const same = cell !== null && current !== undefined && before === proposed;
        return (
          <td
            key={race.id}
            className="ad-grid-td ad-grid-proposal-td"
            data-diff={cell === null ? 'none' : same ? 'same' : current === undefined ? 'new' : 'change'}
          >
            {cell === null ? (
              <span className="pk-visually-hidden">{race.name} : rien de proposé</span>
            ) : same ? (
              <span className="ad-grid-same" title={`${race.name} : inchangé`}>
                =<span className="pk-visually-hidden">{race.name} : inchangé</span>
              </span>
            ) : (
              <span className="ad-grid-diff" title={`${race.name} : ${labelOf(before)} → ${labelOf(proposed)}`}>
                {current === undefined ? null : (
                  <>
                    <span className="ad-grid-diff-before">
                      <RequirementGlyph value={before} />
                    </span>
                    <span aria-hidden="true">→</span>
                  </>
                )}
                <RequirementGlyph value={proposed} />
                <span className="pk-visually-hidden">
                  {race.name} : {current === undefined ? '' : `${labelOf(before)} → `}
                  {labelOf(proposed)}
                  {cell.conflict ? ' (contredit le publié)' : ''}
                </span>
              </span>
            )}
          </td>
        );
      })}
      <td className="ad-grid-all">
        <form action={action} className="ad-grid-proposal-actions">
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="editionId" value={editionId} />
          <input type="hidden" name="trustLevel" value="pluka_validated" />
          {candidateIds.map((candidateId) => (
            <input key={candidateId} type="hidden" name="candidateIds" value={candidateId} />
          ))}
          {proposal.duplicateIds.map((candidateId) => (
            <input key={candidateId} type="hidden" name="duplicateIds" value={candidateId} />
          ))}
          <button
            type="submit"
            name="decision"
            value="accept"
            className="pk-btn pk-button-primary ad-grid-proposal-button"
            disabled={pending || locked}
            title={locked ? 'Enregistre ou annule le brouillon d’abord' : 'Publier en « Validée PLUKA »'}
          >
            Accepter
          </button>
          <button
            type="submit"
            name="decision"
            value="reject"
            className="pk-btn pk-button-secondary ad-grid-proposal-button"
            disabled={pending || locked}
          >
            Écarter
          </button>
          {state.error === undefined ? null : (
            <p className="pk-field-error" role="alert">
              {state.error}
            </p>
          )}
        </form>
      </td>
    </tr>
  );
}

/** Une ligne proposée par les sources (0046), sérialisable. */
export interface GridProposal {
  readonly factKey: string;
  readonly label: string;
  readonly cells: readonly ({
    readonly candidateId: string;
    readonly requirement: Requirement | null;
    readonly condition: string | null;
    readonly conflict: boolean;
  } | null)[];
  readonly duplicateIds: readonly string[];
  readonly excerpt: string | null;
  readonly source: string | null;
}

export interface GridPrevious {
  readonly year: number;
  readonly races: readonly GridRace[];
  readonly rows: readonly GridRow[];
}

const HISTORY = 50;

export function EquipmentGrid({
  eventId,
  editionId,
  races,
  rows,
  proposals,
  previous,
}: {
  readonly eventId: string;
  readonly editionId: string;
  readonly races: readonly GridRace[];
  readonly rows: readonly GridRow[];
  readonly proposals: readonly GridProposal[];
  /** Le matériel de l'édition précédente, à reprendre ; `null` s'il n'y en a pas. */
  readonly previous: GridPrevious | null;
}) {
  const id = useId();
  const originals = useMemo(() => new Map(linesOf(rows, races).map((line) => [line.id, line])), [
    rows,
    races,
  ]);
  const [lines, setLines] = useState<Line[]>(() => linesOf(rows, races));
  // L'annulation revient d'un geste : chaque geste dépose l'état d'avant.
  const [history, setHistory] = useState<readonly Line[][]>([]);
  // Une ligne s'ouvre d'elle-même tant qu'une de ses cases vient de passer en
  // conditionnel dans le brouillon — il faut la condition — et se referme
  // quand il n'y en a plus. Ouvrir ou fermer à la main reste possible.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const [newLabel, setNewLabel] = useState('');
  const [newRequirement, setNewRequirement] = useState<Requirement>('mandatory');
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const counter = useRef(0);
  const paint = useRef<{ readonly value: Cell } | null>(null);
  const [state, action, pending] = useActionState(saveEditionEquipmentAction, INITIAL);

  const newId = () => {
    counter.current += 1;
    return `new-${counter.current}`;
  };

  /** Avant chaque geste : l'état courant part dans l'historique. */
  const record = () => setHistory((current) => [...current.slice(-(HISTORY - 1)), lines]);

  const undo = () => {
    const last = history.at(-1);
    if (last === undefined) return;
    setLines(last);
    setHistory((current) => current.slice(0, -1));
  };

  // Un geste de peinture finit où que le bouton soit relâché.
  useEffect(() => {
    const stop = () => {
      paint.current = null;
    };
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);
    return () => {
      document.removeEventListener('pointerup', stop);
      document.removeEventListener('pointercancel', stop);
    };
  }, []);

  const payload = lines
    .map((line) => ({ line, body: payloadOf(line, originals.get(line.id), races) }))
    .filter((entry) => entry.body !== null);
  const changedCells = changedCellCount(lines, originals, races);
  const dirty = payload.length > 0;

  // Quitter la page avec un brouillon non enregistré se demande.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = (lineId: string, change: (line: Line) => Line) =>
    setLines((current) => current.map((line) => (line.id === lineId ? change(line) : line)));

  const setCell = (lineId: string, raceId: string, value: Cell, recorded = false) => {
    if (!recorded) record();
    update(lineId, (line) => ({ ...line, cells: { ...line.cells, [raceId]: value } }));
  };

  const setAll = (lineId: string, value: Cell) => {
    record();
    update(lineId, (line) => ({
      ...line,
      cells: Object.fromEntries(races.map((race) => [race.id, value])),
    }));
  };

  const without = (set: ReadonlySet<string>, lineId: string) =>
    new Set([...set].filter((entry) => entry !== lineId));

  /** Une case passée en conditionnel dans ce brouillon : la condition est à écrire. */
  const conditionalInDraft = (line: Line) =>
    races.some(
      (race) =>
        line.cells[race.id] === 'conditional' &&
        originals.get(line.id)?.cells[race.id] !== 'conditional',
    );

  const isOpen = (line: Line) =>
    !closed.has(line.id) && (opened.has(line.id) || conditionalInDraft(line));

  const toggleOpen = (line: Line) => {
    if (isOpen(line)) {
      setOpened((current) => without(current, line.id));
      setClosed((current) => new Set([...current, line.id]));
    } else {
      setClosed((current) => without(current, line.id));
      setOpened((current) => new Set([...current, line.id]));
    }
  };

  const addLine = () => {
    const label = newLabel.trim();
    if (label === '') return;
    const lineId = newId();
    record();
    setLines((current) => [
      ...current,
      {
        id: lineId,
        factKey: null,
        label,
        condition: '',
        detail: '',
        cells: Object.fromEntries(races.map((race) => [race.id, newRequirement])),
        sources: [],
      },
    ]);
    setNewLabel('');
  };

  const reset = () => {
    setLines(linesOf(rows, races));
    setHistory([]);
    setOpened(new Set());
    setClosed(new Set());
    setNotice(null);
  };

  const takePrevious = () => {
    if (previous === null) return;
    const result = importPrevious(lines, previous, races, newId);
    if (result.added + result.updated === 0) {
      setNotice(`Rien à reprendre de ${previous.year} : le tableau le contient déjà.`);
      return;
    }
    record();
    setLines([...result.lines]);
    setNotice(
      [
        `Repris de ${previous.year} : ${result.added} ajouté${result.added > 1 ? 's' : ''}, ${
          result.updated
        } réglé${result.updated > 1 ? 's' : ''}.`,
        result.matches.length === 0
          ? null
          : `Épreuves associées : ${result.matches
              .map((match) => `${match.from.name} → ${match.to.name}`)
              .join(', ')}.`,
        result.unmatched.length === 0
          ? null
          : `Sans correspondance, non repris : ${result.unmatched
              .map((race) => race.name)
              .join(', ')}.`,
        'Vérifie, puis enregistre.',
      ]
        .filter((part) => part !== null)
        .join(' '),
    );
  };

  const known = new Set(lines.map(keyOf).filter((key): key is string => key !== null));
  // Ce qui figure déjà au tableau n'est pas ajouté deux fois.
  const pastedNew = pastedLabels(pasted).filter((label) => !known.has(labelKey(label) ?? ''));

  const addPasted = () => {
    if (pastedNew.length === 0) return;
    record();
    setLines((current) => [
      ...current,
      ...pastedNew.map((label) => ({
        id: newId(),
        factKey: null,
        label,
        condition: '',
        detail: '',
        cells: Object.fromEntries(races.map((race) => [race.id, newRequirement])),
        sources: [],
      })),
    ]);
    setNotice(
      `${pastedNew.length} matériel${pastedNew.length > 1 ? 's' : ''} ajouté${
        pastedNew.length > 1 ? 's' : ''
      } au brouillon. Règle les cases, puis enregistre.`,
    );
    setPasted('');
    setPasting(false);
  };

  // Les refus de la base reviennent par position dans le brouillon envoyé.
  const errors = state.fieldErrors ?? {};
  const errorOf = (lineId: string, field: string): string | undefined => {
    const index = payload.findIndex((entry) => entry.line.id === lineId);
    return index === -1 ? undefined : errors[`lines.${index}.${field}`];
  };
  const globalError = errors['lines'] ?? state.error;

  return (
    <div
      className="ad-grid"
      onKeyDown={(event) => {
        // Ctrl+Z annule le dernier geste — sauf dans un champ, qui garde le sien.
        const target = event.target as HTMLElement;
        if (target.closest('input, textarea, select') !== null) return;
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
          event.preventDefault();
          undo();
        }
      }}
    >
      <div className="ad-grid-legend" aria-label="Légende">
        {STATES.slice(1)
          .reverse()
          .map((entry) => (
            <span key={entry.key} className="ad-grid-legend-item">
              <span className="ad-grid-swatch" data-state={entry.value ?? 'none'}>
                <RequirementGlyph value={entry.value} />
              </span>
              {entry.label}
            </span>
          ))}
        <span className="ad-grid-legend-item">
          <span className="ad-grid-swatch" data-state="none">
            <RequirementGlyph value={null} />
          </span>
          Non concernée
        </span>
        <span className="ad-grid-legend-help">
          Clic : exigence suivante · glisser : peindre plusieurs cases · clic droit ou appui long : choisir · 0 à 3 · Ctrl+Z
        </span>
      </div>

      <div className="ad-grid-toolbar">
        {previous === null ? null : (
          <button type="button" className="pk-btn pk-button-secondary" onClick={takePrevious}>
            Reprendre le matériel de {previous.year}
          </button>
        )}
        <button
          type="button"
          className="pk-btn pk-button-secondary"
          aria-expanded={pasting}
          aria-controls={`${id}-paste`}
          onClick={() => setPasting((current) => !current)}
        >
          Coller une liste
        </button>
        <button
          type="button"
          className="pk-btn pk-button-secondary ad-grid-undo"
          onClick={undo}
          disabled={history.length === 0}
          title="Ctrl+Z"
        >
          ↶ Annuler le dernier geste
        </button>
      </div>

      {pasting ? (
        <div className="ad-grid-paste" id={`${id}-paste`}>
          <label className="pk-field-label" htmlFor={`${id}-paste-text`}>
            La liste du règlement, un matériel par ligne
          </label>
          <textarea
            id={`${id}-paste-text`}
            className="pk-input ad-grid-paste-text"
            rows={6}
            value={pasted}
            placeholder={'Veste imperméable avec capuche\nFrontale + piles de rechange\nCouverture de survie'}
            onChange={(event) => setPasted(event.target.value)}
          />
          <p className="ad-grid-meta">
            Les puces et numéros sont retirés ; le texte n’est pas interprété — tu règles ensuite
            chaque case.
          </p>
          <div className="ad-grid-paste-foot">
            <label className="pk-visually-hidden" htmlFor={`${id}-paste-requirement`}>
              Exigence pour toutes les épreuves
            </label>
            <select
              id={`${id}-paste-requirement`}
              className="pk-input ad-grid-add-select"
              value={newRequirement}
              onChange={(event) => setNewRequirement(event.target.value as Requirement)}
            >
              <option value="mandatory">Obligatoire partout</option>
              <option value="conditional">Conditionnel partout</option>
              <option value="recommended">Recommandé partout</option>
            </select>
            <button
              type="button"
              className="pk-btn pk-button-primary"
              disabled={pastedNew.length === 0}
              onClick={addPasted}
            >
              {pastedNew.length === 0
                ? 'Ajouter au brouillon'
                : `Ajouter ${pastedNew.length} matériel${pastedNew.length > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      ) : null}

      {notice === null ? null : (
        <p className="ad-grid-notice" role="status">
          {notice}
        </p>
      )}

      <div className="ad-grid-scroll">
        <table className="ad-grid-table">
          <caption className="pk-visually-hidden">
            Matériel par épreuve. Chaque case dit l’exigence de l’épreuve pour ce matériel.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="ad-grid-th-item">
                Matériel
              </th>
              {races.map((race) => (
                <th key={race.id} scope="col" className="ad-grid-th">
                  <span className="ad-grid-th-name">{race.name}</span>
                  {race.detail === null ? null : (
                    <span className="ad-grid-th-meta">{race.detail}</span>
                  )}
                </th>
              ))}
              <th scope="col" className="ad-grid-th-all">
                <span className="pk-visually-hidden">Toutes les épreuves</span>
              </th>
            </tr>
          </thead>
          {proposals.length === 0 ? null : (
            <tbody className="ad-grid-proposals">
              <tr>
                <th colSpan={races.length + 2} scope="rowgroup" className="ad-grid-section">
                  À relire · lu dans les sources{' '}
                  <span className="ad-grid-group-count">{proposals.length}</span>
                  <span className="ad-grid-section-lede">
                    {dirty
                      ? 'Enregistre ou annule le brouillon pour accepter ou écarter.'
                      : 'Accepter publie en « Validée PLUKA », avec l’extrait comme preuve. Tu pourras ensuite régler les cases.'}
                  </span>
                </th>
              </tr>
              {proposals.map((proposal) => (
                <ProposalRow
                  key={proposal.factKey}
                  eventId={eventId}
                  editionId={editionId}
                  races={races}
                  proposal={proposal}
                  current={originals.get(proposal.factKey)}
                  locked={dirty}
                />
              ))}
            </tbody>
          )}
          <tbody>
            {proposals.length === 0 ? null : (
              <tr>
                <th colSpan={races.length + 2} scope="rowgroup" className="ad-grid-section">
                  Publié
                </th>
              </tr>
            )}
            {lines.length === 0 ? (
              <tr>
                <td colSpan={races.length + 2} className="ad-grid-empty">
                  Aucun matériel pour l’instant. Ajoute-le ci-dessous depuis le règlement, ou
                  importe les documents de l’événement : le matériel qu’ils citent sera proposé à
                  la relecture.
                </td>
              </tr>
            ) : null}
            {lines.map((line) => {
              const original = originals.get(line.id);
              const lineOpen = isOpen(line);
              const hasConditional = Object.values(line.cells).includes('conditional');
              const needsCondition =
                Object.values(line.cells).includes('conditional') && line.condition.trim() === '';
              const isNew = line.factKey === null;
              const meta = [trimmed(line.condition), trimmed(line.detail)].filter(
                (part): part is string => part !== null,
              );
              const conditionError = errorOf(line.id, 'condition');
              const labelError = errorOf(line.id, 'label');
              const requirementsError = errorOf(line.id, 'requirements');

              return [
                <tr
                  key={line.id}
                  className="ad-grid-tr"
                  data-new={isNew ? 'true' : 'false'}
                  data-dirty={payloadOf(line, original, races) === null ? 'false' : 'true'}
                >
                  <th scope="row" className="ad-grid-item">
                    <button
                      type="button"
                      className="ad-grid-item-button"
                      aria-expanded={lineOpen}
                      aria-controls={`${id}-${line.id}-edit`}
                      onClick={() => toggleOpen(line)}
                    >
                      <span className="ad-grid-name">{line.label}</span>
                      {meta.length === 0 ? null : (
                        <span className="ad-grid-meta">{meta.join(' · ')}</span>
                      )}
                      {isNew ? <span className="ad-grid-flag">Nouveau</span> : null}
                      {needsCondition ? (
                        <span className="ad-grid-flag ad-grid-flag-warn">Condition à préciser</span>
                      ) : null}
                    </button>
                  </th>
                  {races.map((race) => (
                    <GridCell
                      key={race.id}
                      race={race}
                      line={line}
                      value={line.cells[race.id] ?? null}
                      changed={(line.cells[race.id] ?? null) !== (original?.cells[race.id] ?? null)}
                      onSet={(value) => setCell(line.id, race.id, value)}
                      onPaintStart={(value) => {
                        paint.current = { value };
                        setCell(line.id, race.id, value);
                      }}
                      onPaintEnter={() => {
                        if (paint.current === null) return;
                        // Le geste a déjà déposé l'état d'avant : un seul retour l'annule.
                        if ((line.cells[race.id] ?? null) !== paint.current.value) {
                          setCell(line.id, race.id, paint.current.value, true);
                        }
                      }}
                    />
                  ))}
                  <td className="ad-grid-all">
                    <label className="pk-visually-hidden" htmlFor={`${id}-${line.id}-all`}>
                      {line.label} : régler toutes les épreuves
                    </label>
                    <select
                      id={`${id}-${line.id}-all`}
                      className="ad-grid-all-select"
                      value=""
                      onChange={(event) => {
                        const picked = STATES.find((entry) => entry.key === event.target.value);
                        if (picked !== undefined) setAll(line.id, picked.value);
                      }}
                    >
                      <option value="" disabled>
                        Toutes…
                      </option>
                      {STATES.slice()
                        .reverse()
                        .map((entry) => (
                          <option key={entry.key} value={entry.key}>
                            {entry.label}
                          </option>
                        ))}
                    </select>
                  </td>
                </tr>,
                lineOpen ? (
                  <tr key={`${line.id}-edit`} className="ad-grid-edit-tr">
                    <td colSpan={races.length + 2} id={`${id}-${line.id}-edit`}>
                      <div className="ad-grid-edit">
                        <div className="pk-field">
                          <label className="pk-field-label" htmlFor={`${id}-${line.id}-label`}>
                            Nom, tel que le règlement l’écrit
                          </label>
                          <input
                            id={`${id}-${line.id}-label`}
                            className="pk-input"
                            value={line.label}
                            autoComplete="off"
                            onChange={(event) =>
                              update(line.id, (current) => ({ ...current, label: event.target.value }))
                            }
                          />
                          {labelError === undefined ? null : (
                            <p className="pk-field-error">{labelError}</p>
                          )}
                        </div>
                        {/* La condition ne vaut que pour les cases conditionnelles : sans elles, pas de champ. */}
                        {hasConditional ? (
                          <div className="pk-field">
                            <label className="pk-field-label" htmlFor={`${id}-${line.id}-condition`}>
                              Condition des cases conditionnelles
                            </label>
                            <input
                              id={`${id}-${line.id}-condition`}
                              className="pk-input"
                              value={line.condition}
                              placeholder="Ex. si température prévue < 5 °C"
                              autoComplete="off"
                              aria-invalid={needsCondition || conditionError !== undefined}
                              onChange={(event) =>
                                update(line.id, (current) => ({
                                  ...current,
                                  condition: event.target.value,
                                }))
                              }
                            />
                            {conditionError === undefined ? null : (
                              <p className="pk-field-error">{conditionError}</p>
                            )}
                          </div>
                        ) : null}
                        <div className="pk-field">
                          <label className="pk-field-label" htmlFor={`${id}-${line.id}-detail`}>
                            Précision (facultative)
                          </label>
                          <input
                            id={`${id}-${line.id}-detail`}
                            className="pk-input"
                            value={line.detail}
                            placeholder="Ex. membrane 10 000 mm, coutures étanchées"
                            autoComplete="off"
                            onChange={(event) =>
                              update(line.id, (current) => ({ ...current, detail: event.target.value }))
                            }
                          />
                        </div>
                        <div className="ad-grid-edit-foot">
                          <span className="ad-grid-meta">
                            {line.sources.length === 0
                              ? isNew
                                ? 'Saisi ici, non encore enregistré.'
                                : null
                              : `Source : ${line.sources.join(', ')}`}
                          </span>
                          {isNew ? (
                            <button
                              type="button"
                              className="pk-link"
                              onClick={() =>
                                setLines((current) => current.filter((entry) => entry.id !== line.id))
                              }
                            >
                              Supprimer cette ligne
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="pk-link"
                              onClick={() => setAll(line.id, null)}
                            >
                              Retirer de toutes les épreuves
                            </button>
                          )}
                        </div>
                        {requirementsError === undefined ? null : (
                          <p className="pk-field-error">{requirementsError}</p>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>

      <form
        className="ad-grid-add"
        onSubmit={(event) => {
          event.preventDefault();
          addLine();
        }}
      >
        <label className="pk-visually-hidden" htmlFor={`${id}-new`}>
          Nom du matériel à ajouter
        </label>
        <input
          id={`${id}-new`}
          className="pk-input ad-grid-add-input"
          placeholder="Ajouter un matériel, tel que le règlement l’écrit…"
          autoComplete="off"
          value={newLabel}
          onChange={(event) => setNewLabel(event.target.value)}
        />
        <label className="pk-visually-hidden" htmlFor={`${id}-new-requirement`}>
          Exigence pour toutes les épreuves
        </label>
        <select
          id={`${id}-new-requirement`}
          className="pk-input ad-grid-add-select"
          value={newRequirement}
          onChange={(event) => setNewRequirement(event.target.value as Requirement)}
        >
          <option value="mandatory">Obligatoire partout</option>
          <option value="conditional">Conditionnel partout</option>
          <option value="recommended">Recommandé partout</option>
        </select>
        <button type="submit" className="pk-btn pk-button-secondary" disabled={newLabel.trim() === ''}>
          Ajouter
        </button>
      </form>

      {dirty ? (
        <form action={action} className="ad-grid-save" aria-label="Enregistrer le matériel">
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="editionId" value={editionId} />
          <input
            type="hidden"
            name="lines"
            value={JSON.stringify(payload.map((entry) => entry.body))}
          />
          <p className="ad-grid-save-count" aria-live="polite">
            <strong>
              {changedCells} case{changedCells > 1 ? 's' : ''} modifiée{changedCells > 1 ? 's' : ''}
            </strong>
            {payload.length > 0 ? ` · ${payload.length} matériel${payload.length > 1 ? 's' : ''}` : null}
          </p>
          <label className="pk-visually-hidden" htmlFor={`${id}-trust`}>
            Niveau de confiance
          </label>
          <select
            id={`${id}-trust`}
            name="trustLevel"
            className="pk-input ad-grid-save-select"
            defaultValue="pluka_validated"
          >
            <option value="pluka_validated">Validée PLUKA</option>
            <option value="official">Officielle — éditeur de l’organisation</option>
          </select>
          <label className="pk-visually-hidden" htmlFor={`${id}-note`}>
            Motif (facultatif)
          </label>
          <input
            id={`${id}-note`}
            name="note"
            className="pk-input ad-grid-save-note"
            placeholder="Motif (facultatif) — ex. règlement 2026"
            autoComplete="off"
          />
          <button type="button" className="pk-btn pk-button-secondary" onClick={reset}>
            Tout annuler
          </button>
          <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          {globalError === undefined ? null : (
            <p className="pk-field-error ad-grid-save-error" role="alert">
              {globalError}
            </p>
          )}
        </form>
      ) : null}
    </div>
  );
}
