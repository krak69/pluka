import type { EditionEquipmentRow, EquipmentProposal, RaceEquipmentItem } from '@pluka/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { EquipmentPanel } from '@/app/courses/[raceId]/equipment-panel';
import { EditionEquipmentPanel } from '@/app/evenements/[eventId]/edition-equipment';

vi.mock('@/app/fact-actions', () => ({
  saveEditionEquipmentAction: async () => ({}),
  decideEquipmentProposalAction: async () => ({}),
}));

/**
 * Le tableau du matériel d'une édition — migrations 0047, 0048. Une ligne par
 * pièce, une case par épreuve, une exigence par case ; la fiche épreuve le
 * lit et renvoie à l'événement. La garde est en base (pgTAP 33).
 */

const RACES = [
  { id: 'race-a', name: '80K', detail: '80 km' },
  { id: 'race-b', name: '20K', detail: '20 km' },
];

function item(overrides: Partial<RaceEquipmentItem> = {}): RaceEquipmentItem {
  return {
    factId: 'f1',
    factKey: 'equipment.frontale',
    label: 'Frontale',
    requirement: 'mandatory',
    condition: null,
    detail: 'piles de rechange',
    trustLevel: 'pluka_validated',
    retired: false,
    versionNumber: 1,
    publishedAt: '2026-10-15T10:00:00Z',
    source: { title: 'Règlement 2026', page: 3, excerpt: 'Frontale' },
    ...overrides,
  };
}

function row(overrides: Partial<EditionEquipmentRow> = {}): EditionEquipmentRow {
  return {
    factKey: 'equipment.frontale',
    label: 'Frontale',
    requirement: 'mixed',
    strongest: 'mandatory',
    condition: null,
    detail: 'piles de rechange',
    cells: [item(), item({ factId: 'f2', requirement: 'recommended' })],
    trustLevel: 'pluka_validated',
    sources: ['Règlement 2026'],
    ...overrides,
  };
}

function panel(
  rows: readonly EditionEquipmentRow[] | null,
  proposals: readonly EquipmentProposal[] = [],
  previous: { year: number; races: typeof RACES; rows: EditionEquipmentRow[] } | null = null,
): string {
  return renderToStaticMarkup(
    <EditionEquipmentPanel
      eventId="event-1"
      editionId="edition-1"
      editionYear={2026}
      races={RACES}
      rows={rows}
      proposals={proposals}
      previous={previous}
    />,
  );
}

function proposal(overrides: Partial<EquipmentProposal> = {}): EquipmentProposal {
  return {
    factKey: 'equipment.frontale',
    label: 'Frontale',
    cells: [
      {
        candidateId: 'cand-a',
        label: 'Frontale',
        conflict: true,
        requirement: 'mandatory',
        condition: null,
        detail: null,
      },
      {
        candidateId: 'cand-b',
        label: 'Frontale',
        conflict: false,
        requirement: 'mandatory',
        condition: null,
        detail: null,
      },
    ],
    duplicateIds: ['cand-dup'],
    evidence: {
      excerpt: 'Frontale obligatoire avec piles de rechange.',
      sourceTitle: 'Règlement 2026',
      pageNumber: 4,
      sourceUrl: null,
    },
    ...overrides,
  };
}

describe('le tableau du matériel, sur l’écran événement', () => {
  it('une colonne par épreuve, une case par exigence, avec sa forme', () => {
    const html = panel([row()]);

    expect(html).toContain('id="materiel"');
    expect(html).toMatch(/<th scope="col" class="ad-grid-th"><span class="ad-grid-th-name">80K/);
    expect(html).toContain('Frontale — 80K : Obligatoire');
    expect(html).toContain('Frontale — 20K : Recommandé');
    expect(html).toContain('data-glyph="mandatory"');
    expect(html).toContain('data-glyph="recommended"');
  });

  it('un clic annonce l’exigence suivante, dans l’ordre du cycle', () => {
    const html = panel([row({ cells: [item(), null] })]);

    // obligatoire → non concernée ; non concernée → recommandé.
    expect(html).toContain('80K : Obligatoire. Clic : non concernée.');
    expect(html).toContain('20K : Non concernée. Clic : recommandé.');
  });

  it('la légende dit les quatre états et comment les choisir', () => {
    const html = panel([row()]);

    for (const label of ['Obligatoire', 'Conditionnel', 'Recommandé', 'Non concernée']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('clic droit ou appui long');
  });

  it('rien n’est publié au clic : pas de barre d’enregistrement sans brouillon', () => {
    const html = panel([row()]);

    expect(html).not.toContain('ad-grid-save');
    expect(html).toContain('Ajouter un matériel');
  });

  it('un matériel sans exigence se montre « à préciser », jamais en recommandé', () => {
    const html = panel([
      row({ requirement: null, strongest: null, cells: [item({ requirement: null }), null] }),
    ]);

    expect(html).toContain('80K : Exigence à préciser');
    expect(html).toContain('data-glyph="unknown"');
    expect(html).toContain('sans exigence');
  });

  it('compte par exigence la plus forte', () => {
    const html = panel([row()]);

    expect(html).toMatch(/Obligatoire<\/dt><dd>1<\/dd>/);
    expect(html).toMatch(/Recommandé<\/dt><dd>0<\/dd>/);
  });

  it('un tableau vide invite à ajouter ; une lecture impossible le dit', () => {
    expect(panel([])).toContain('Aucun matériel pour l’instant');
    expect(panel(null)).toContain('n’a pas pu être lu');
  });
});

describe('les propositions des sources, dans le tableau', () => {
  it('en tête, avec ce qui change case par case et l’extrait comme preuve', () => {
    const html = panel([row()], [proposal()]);

    expect(html).toContain('À relire · lu dans les sources');
    expect(html).toContain('Changement proposé');
    // 80K : obligatoire déjà publié ; 20K : recommandé → obligatoire.
    expect(html).toContain('80K : inchangé');
    expect(html).toContain('20K : Recommandé → Obligatoire');
    expect(html).toContain('Frontale obligatoire avec piles de rechange.');
    expect(html).toContain('Règlement 2026, p. 4');
  });

  it('accepter et écarter portent les candidats, doublons compris', () => {
    const html = panel([row()], [proposal()]);

    expect(html).toContain('name="candidateIds" value="cand-a"');
    expect(html).toContain('name="candidateIds" value="cand-b"');
    expect(html).toContain('name="duplicateIds" value="cand-dup"');
    expect(html).toMatch(/value="accept"[^>]*name="decision"/);
    expect(html).toMatch(/value="reject"[^>]*name="decision"/);
  });

  it('une pièce nouvelle se dit « Proposé »', () => {
    const html = panel([], [proposal({ factKey: 'equipment.sifflet', label: 'Sifflet' })]);
    expect(html).toContain('Proposé');
    expect(html).toContain('Sifflet');
  });
});

describe('les outils du tableau', () => {
  it('reprendre l’édition précédente n’apparaît que si elle a du matériel', () => {
    expect(panel([row()])).not.toContain('Reprendre le matériel');
    expect(
      panel([row()], [], { year: 2025, races: RACES, rows: [row()] }),
    ).toContain('Reprendre le matériel de 2025');
  });

  it('coller une liste et annuler le dernier geste sont là, l’annulation éteinte sans geste', () => {
    const html = panel([row()]);
    expect(html).toContain('Coller une liste');
    expect(html).toMatch(/ad-grid-undo"[^>]*disabled=""/);
    expect(html).toContain('glisser : peindre plusieurs cases');
  });
});

describe('fiche épreuve : le matériel en lecture, avec les pictos de l’événement', () => {
  const race = (
    pendingFromSources: number | null,
    items: readonly RaceEquipmentItem[] | null = [item()],
  ) =>
    renderToStaticMarkup(
      <EquipmentPanel
        raceName="80K"
        items={items}
        pendingFromSources={pendingFromSources}
        manageHref="/evenements/event-1/materiel"
      />,
    );

  it('groupe par exigence, avec le picto, la source et le niveau de confiance', () => {
    const html = race(null, [
      item(),
      item({
        factId: 'f2',
        label: 'Gants',
        requirement: 'conditional',
        condition: 'si température < 5 °C',
        detail: null,
      }),
      item({ factId: 'f3', label: 'Bâtons', requirement: 'recommended', detail: null }),
    ]);

    expect(html).toContain('Ce que lisent les coureurs de 80K');
    expect(html).toContain('data-glyph="mandatory"');
    expect(html).toContain('data-glyph="conditional"');
    expect(html).toContain('data-glyph="recommended"');
    expect(html).toContain('si température &lt; 5 °C');
    expect(html).toContain('Règlement 2026, p. 3');
    expect(html).toContain('Validée PLUKA');
    expect(html).toMatch(/Obligatoire<\/dt><dd>1<\/dd>/);
  });

  it('ne se modifie pas ici : il renvoie à l’onglet Matériel de l’événement', () => {
    const html = race(null);
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<input');
    expect(html).toContain('Modifier dans l’événement');
    expect(html).toContain('href="/evenements/event-1/materiel"');
  });

  it('un matériel sans exigence est « à préciser », jamais rangé ailleurs', () => {
    const html = race(null, [item({ requirement: null })]);
    expect(html).toContain('À préciser');
    expect(html).toContain('data-glyph="unknown"');
  });

  it('les retirés ne s’affichent pas ; une liste vide invite à renseigner', () => {
    const html = race(null, [item({ retired: true })]);
    expect(html).toContain('Aucun matériel pour cette épreuve');
    expect(html).not.toContain('Frontale');
  });

  it('signale le matériel lu dans les sources, et dit une lecture impossible', () => {
    expect(race(2)).toContain('2 propositions de matériel');
    expect(race(0)).not.toContain('proposition');
    expect(race(null, null)).toContain('n’a pas pu être lu');
  });
});
