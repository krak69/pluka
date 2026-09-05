import type { FactCandidateReviewRecord } from '@pluka/db';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CandidateReviewList } from '@/app/courses/[raceId]/revue/review-list';

/**
 * L'écran de revue rend la provenance consultable — SOURCES_EXTRACTION §30, §20.
 *
 * « Un réviseur doit pouvoir voir d'où vient la valeur avant de décider. » Ce
 * n'est pas une intention qu'on peut vérifier en relisant le composant : ces
 * tests rendent la liste et cherchent dans le balisage ce que §20 appelle la
 * preuve minimale — snapshot, block, page, section, locator, extrait.
 *
 * Le rendu est statique : ce qui est testé est ce qu'un réviseur reçoit à la
 * première réponse du serveur, avant tout JavaScript.
 */

const RACE_ID = 'eeeeeeee-0000-4000-8000-000000000005';

function candidate(overrides: Partial<FactCandidateReviewRecord> = {}): FactCandidateReviewRecord {
  return {
    candidateId: 'dddddddd-0000-4000-8000-000000000010',
    raceId: RACE_ID,
    category: 'assistance',
    factKey: 'assistance/lenk/authorization',
    valueText: 'autorisée uniquement à Lenk',
    valueNumber: null,
    unit: null,
    valueJson: null,
    confidenceLabel: 'high',
    status: 'needs_review',
    origin: 'ai',
    notes: null,
    matchedFactId: null,
    publishedValueText: null,
    publishedVersionId: null,
    publishedTrustLevel: null,
    conflictType: null,
    conflictStatus: null,
    excerpt: 'Assistance autorisée uniquement à Lenk.',
    pageNumber: 14,
    sectionPath: ['Règlement 2026', 'Assistance'],
    locator: { cssSelector: 'p', charOffset: 482 },
    snapshotId: 'eeeeeeee-0000-4000-8000-000000000007',
    snapshotContentHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    blockIndex: 12,
    chunkIndex: 3,
    blockContent: 'Assistance autorisée uniquement à Lenk, sur le parking indiqué.',
    sourceTitle: 'Règlement 2026',
    sourceUrl: 'https://organisation.example/reglement',
    sourceType: 'url',
    organizationName: 'Organisation Test',
    snapshotRetrievedAt: '2026-03-01T08:00:00Z',
    provider: 'fournisseur-test',
    model: 'modele-test',
    extractedAt: '2026-03-01T08:05:00Z',
    ...overrides,
  };
}

function render(candidates: readonly FactCandidateReviewRecord[]): string {
  return renderToStaticMarkup(<CandidateReviewList raceId={RACE_ID} candidates={candidates} />);
}

describe('valeur proposée', () => {
  it('affiche la valeur et son identité logique', () => {
    const html = render([candidate()]);

    expect(html).toContain('autorisée uniquement à Lenk');
    expect(html).toContain('assistance/lenk/authorization');
  });

  it('compose une valeur numérique avec son unité', () => {
    // §80 : la valeur normalisée se lit avec son unité, jamais seule.
    const html = render([
      candidate({
        valueText: null,
        valueNumber: 4600,
        unit: 'm',
        factKey: 'course/elevation_gain',
      }),
    ]);

    expect(html).toContain('4600 m');
  });

  it('dit d’où vient la proposition', () => {
    // §29 : une lecture de tableau ne se relit pas comme une interprétation
    // de modèle. Le réviseur doit savoir laquelle il a sous les yeux.
    expect(render([candidate({ origin: 'ai' })])).toContain('Proposition d’un modèle');
    expect(render([candidate({ origin: 'deterministic' })])).toContain('Lecture déterministe');
  });
});

describe('provenance consultable', () => {
  const html = render([candidate()]);

  it('donne l’adresse de la preuve — §20', () => {
    // « snapshot_id, block_id ou chunk_id » : sans adresse, une citation ne
    // se remonte pas jusqu'au document.
    expect(html).toContain('eeeeeeee-0000-4000-8000-000000000007');
    expect(html).toContain('n° 12');
    expect(html).toContain('chunk n° 3');
  });

  it('donne la page, la section et l’extrait', () => {
    expect(html).toContain('14');
    expect(html).toContain('Règlement 2026 › Assistance');
    expect(html).toContain('Assistance autorisée uniquement à Lenk.');
  });

  it('affiche le locator tel que le parseur l’a écrit', () => {
    // Sa forme dépend du format. L'écran ne fige aucune clé : un locator de
    // PDF s'affichera aussi bien qu'un sélecteur HTML.
    expect(html).toContain('cssSelector : p');
    expect(html).toContain('charOffset : 482');
  });

  it('nomme la source, son type et son organisme — §86', () => {
    expect(html).toContain('Règlement 2026');
    expect(html).toContain('Organisation Test');
    expect(html).toContain('url');
    expect(html).toContain('https://organisation.example/reglement');
  });

  it('permet de relire l’extrait dans son block', () => {
    expect(html).toContain('Assistance autorisée uniquement à Lenk, sur le parking indiqué.');
  });

  it('reste repliée : la source ne pollue pas la liste', () => {
    // §86 : accessible sans polluer l'écran principal.
    expect(html).toContain('<details');
    expect(html).toContain('Voir la source');
  });

  it('n’invente aucune provenance absente', () => {
    // Une source saisie manuellement n'a ni page, ni locator. L'écran n'a pas
    // à combler le vide.
    const bare = render([
      candidate({
        pageNumber: null,
        locator: {},
        snapshotId: null,
        blockIndex: null,
        chunkIndex: null,
        blockContent: null,
        sourceUrl: null,
      }),
    ]);

    expect(bare).not.toContain('Locator');
    expect(bare).not.toContain('Snapshot');
    expect(bare).not.toContain('Ouvrir le document');
  });
});

describe('fact courant en regard', () => {
  it('affiche la valeur publiée quand elle existe — §30', () => {
    const html = render([
      candidate({
        matchedFactId: 'aaaa',
        publishedValueText: '16:20',
        publishedTrustLevel: 'official',
      }),
    ]);

    expect(html).toContain('Fact courant');
    expect(html).toContain('16:20');
  });

  it('rend le niveau de confiance par son libellé humain — §87', () => {
    // Le vocabulaire de la base et celui du Design System sont désormais le
    // même : `publishedTrustLevel` alimente `TrustBadge` sans traduction, et
    // le composant porte le libellé — « texte toujours présent ».
    const official = render([
      candidate({
        matchedFactId: 'aaaa',
        publishedValueText: '16:20',
        publishedTrustLevel: 'official',
      }),
    ]);

    expect(official).toContain('Officielle');
    expect(official).toContain('data-trust-level="official"');

    const validated = render([
      candidate({
        matchedFactId: 'aaaa',
        publishedValueText: '16:20',
        publishedTrustLevel: 'pluka_validated',
      }),
    ]);

    expect(validated).toContain('Validée PLUKA');
    expect(validated).toContain('data-trust-level="pluka_validated"');
  });

  it('le dit quand il n’y en a pas', () => {
    expect(render([candidate()])).toContain('aucun');
  });
});

describe('contradiction', () => {
  const conflicted = render([
    candidate({
      status: 'conflict',
      conflictType: 'published_fact_conflict',
      publishedValueText: '16:20',
      matchedFactId: 'aaaa',
    }),
  ]);

  it('signale l’état sans compter sur la couleur — §185', () => {
    expect(conflicted).toContain('Contradiction');
  });

  it('exige une confirmation explicite — §38', () => {
    // « Il ne choisit pas automatiquement une valeur. » La case n'est pas
    // cochée par défaut, et sans elle le domaine refuse.
    expect(conflicted).toContain('name="resolveConflict"');
    expect(conflicted).toContain('Je confirme remplacer la valeur publiée');
    expect(conflicted).not.toContain('checked');
    expect(conflicted).toContain('Résoudre et publier');
  });

  it('ne demande aucune confirmation sans contradiction', () => {
    const plain = render([candidate()]);

    expect(plain).not.toContain('name="resolveConflict"');
    expect(plain).toContain('Accepter et publier');
  });
});

describe('actions', () => {
  const html = render([candidate()]);

  it('propose accepter et rejeter — §31', () => {
    expect(html).toContain('Accepter et publier');
    expect(html).toContain('Rejeter');
    expect(html).toContain('value="reject"');
  });

  it('laisse le réviseur choisir le niveau de confiance', () => {
    // §32 : ce qu'il a le droit de conférer est tranché par le domaine, pas
    // par l'écran. Les deux niveaux sont donc proposés.
    expect(html).toContain('value="official"');
    expect(html).toContain('value="pluka_validated"');
  });

  it('permet de corriger la valeur avant publication — §31', () => {
    expect(html).toContain('name="valueText"');
    expect(html).toContain('name="note"');
  });

  it('ne transmet jamais d’identité d’acteur', () => {
    // L'acteur vient de la session, relu côté serveur. Un champ caché
    // porterait une identité déclarée par le navigateur.
    expect(html).not.toContain('actorUserId');
    expect(html).not.toContain('userId');
  });
});

describe('liste vide', () => {
  it('le dit plutôt que d’afficher un tableau vide', () => {
    expect(render([])).toContain('Aucun candidat en attente de revue');
  });
});
