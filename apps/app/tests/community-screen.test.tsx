import {
  COMMUNITY_CATEGORIES,
  COMMUNITY_REPORT_REASONS,
  createCommunityThreadCommandSchema,
  replyCommunityThreadCommandSchema,
} from '@pluka/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NewThreadForm } from '@/app/(shell)/communaute/new-thread-form';
import { ReplyForm, ReportForm } from '@/app/(shell)/communaute/thread-forms';
import {
  authorInitials,
  communityFigures,
  COMMUNITY_CATEGORY_LABELS,
  communityListHref,
  communityNewHref,
  pointCommunities,
  COMMUNITY_REPORT_REASON_LABELS,
  communityName,
  communityWhen,
  discussionCount,
  isCommunityCategory,
  replyCount,
} from '@/lib/community-format';

/**
 * Écran Communauté — prototype `commVals` ; 05_ROUTES_FLOWS §12.4 ; 0114.
 *
 * Les formulaires postent exactement les champs des commandes du domaine ; les
 * puces sont celles du prototype, dans son ordre ; une date se lit à l'heure de
 * l'épreuve.
 */

const EDITION = 'aaaaaaaa-0000-4000-8000-000000000012';
const THREAD = 'aaaaaaaa-0000-4000-8000-000000000191';
const POST = 'aaaaaaaa-0000-4000-8000-000000000192';
const LENK = 'aaaaaaaa-0000-4000-8000-000000000201';
const RACES = [
  {
    raceId: 'aaaaaaaa-0000-4000-8000-000000000101',
    name: 'Les 5 clochers',
    points: [
      { waypointId: 'aaaaaaaa-0000-4000-8000-000000000200', name: 'Départ', distanceKm: 0 },
      { waypointId: LENK, name: 'Lenk', distanceKm: 12.3 },
    ],
  },
  { raceId: 'aaaaaaaa-0000-4000-8000-000000000102', name: 'Les 9 clochers', points: [] },
];

function fieldNames(markup: string): readonly string[] {
  return [
    ...new Set(
      [...markup.matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"/g)].map(
        (match) => match[1] as string,
      ),
    ),
  ].sort();
}

/** La balise `<input>` d'un nom et d'une valeur, quel que soit l'ordre de ses attributs. */
function inputTag(markup: string, name: string, value: string): string {
  return (
    [...markup.matchAll(/<input\b[^>]*>/g)]
      .map((match) => match[0])
      .find((tag) => tag.includes(`name="${name}"`) && tag.includes(`value="${value}"`)) ?? ''
  );
}

describe('libellés', () => {
  it('les puces sont celles du prototype, dans son ordre', () => {
    expect(COMMUNITY_CATEGORIES.map((category) => COMMUNITY_CATEGORY_LABELS[category])).toEqual([
      'Questions',
      'Préparation',
      'Parcours',
      'Logistique',
      'Matériel & nutrition',
      'Assistance',
      'Retours de course',
    ]);
  });

  it('chaque motif de signalement a un libellé', () => {
    for (const reason of COMMUNITY_REPORT_REASONS) {
      expect(COMMUNITY_REPORT_REASON_LABELS[reason]).not.toBe(reason);
    }
  });

  it('une catégorie d’URL inconnue n’est pas une catégorie', () => {
    expect(isCommunityCategory('logistics')).toBe(true);
    expect(isCommunityCategory('Logistique')).toBe(false);
    expect(isCommunityCategory(undefined)).toBe(false);
  });

  it('nomme l’édition et compte au singulier comme au pluriel', () => {
    expect(communityName({ eventName: 'Les Clochers', year: 2027 })).toBe('Les Clochers 2027');
    expect(discussionCount(1)).toBe('1 discussion');
    expect(discussionCount(4)).toBe('4 discussions');
    expect(replyCount(0)).toBe('Aucune réponse');
    expect(replyCount(1)).toBe('1 réponse');
    expect(replyCount(12)).toBe('12 réponses');
  });
});

describe('communityWhen', () => {
  const now = new Date('2026-11-27T10:00:00.000Z');

  it('relatif sur la journée', () => {
    expect(communityWhen('2026-11-27T09:59:30.000Z', now, 'Europe/Paris')).toBe('à l’instant');
    expect(communityWhen('2026-11-27T09:48:00.000Z', now, 'Europe/Paris')).toBe('il y a 12 min');
    expect(communityWhen('2026-11-27T07:00:00.000Z', now, 'Europe/Paris')).toBe('il y a 3 h');
  });

  it('une horloge en avance ne fait pas écrire « dans »', () => {
    expect(communityWhen('2026-11-27T10:05:00.000Z', now, 'Europe/Paris')).toBe('à l’instant');
  });

  it('au-delà, la date à l’heure de l’épreuve, l’année seulement si elle change', () => {
    // 23:30 UTC le 11 est déjà le 12 à Paris.
    expect(communityWhen('2026-11-11T23:30:00.000Z', now, 'Europe/Paris')).toBe('12 nov.');
    expect(communityWhen('2025-06-03T08:00:00.000Z', now, 'Europe/Paris')).toBe('3 juin 2025');
  });
});

describe('créer un sujet', () => {
  it('poste les champs de la commande', () => {
    const markup = renderToStaticMarkup(
      <NewThreadForm
        editionId={EDITION}
        races={RACES}
        defaultCategory="logistics"
        defaultRaceId=""
        cancelHref={`/communaute?edition=${EDITION}`}
      />,
    );

    expect(fieldNames(markup)).toEqual(
      Object.keys(createCommunityThreadCommandSchema.shape).sort(),
    );
    expect(inputTag(markup, 'category', 'logistics')).toContain('checked=""');
    expect(inputTag(markup, 'category', 'other')).not.toContain('checked');
    expect(markup).toContain('Toute l’édition');
  });

  it('les points sont rangés par course, et celui venu du Plan est choisi', () => {
    const markup = renderToStaticMarkup(
      <NewThreadForm
        editionId={EDITION}
        races={RACES}
        defaultCategory="other"
        defaultRaceId={RACES[0]?.raceId ?? ''}
        defaultWaypointId={LENK}
        cancelHref="/communaute"
      />,
    );

    expect(markup).toContain('<optgroup label="Les 5 clochers">');
    // Une course sans point n'ouvre pas de groupe vide.
    expect(markup).not.toContain('<optgroup label="Les 9 clochers">');
    expect(markup).toMatch(
      new RegExp(`<option value="${LENK}" selected="">Lenk — km 12,3</option>`),
    );
  });

  it('une édition d’une seule course ne demande pas laquelle', () => {
    const markup = renderToStaticMarkup(
      <NewThreadForm
        editionId={EDITION}
        races={RACES.slice(0, 1)}
        defaultCategory="other"
        defaultRaceId=""
        cancelHref="/communaute"
      />,
    );

    expect(fieldNames(markup)).not.toContain('raceId');
  });
});

describe('répondre et signaler', () => {
  it('répondre poste les champs de la commande', () => {
    const markup = renderToStaticMarkup(<ReplyForm threadId={THREAD} />);

    expect(fieldNames(markup)).toEqual(Object.keys(replyCommunityThreadCommandSchema.shape).sort());
  });

  it('signaler une réponse la nomme, avec un motif obligatoire parmi ceux du domaine', () => {
    const markup = renderToStaticMarkup(<ReportForm threadId={THREAD} postId={POST} />);

    expect(fieldNames(markup)).toEqual(['details', 'postId', 'reason', 'threadId']);
    expect(
      [...markup.matchAll(/name="reason" value="([a-z]+)"/g)].map((match) => match[1]),
    ).toEqual([...COMMUNITY_REPORT_REASONS]);
    for (const reason of COMMUNITY_REPORT_REASONS) {
      expect(inputTag(markup, 'reason', reason)).toContain('required=""');
    }
  });

  it('signaler le sujet ne poste pas de réponse', () => {
    const markup = renderToStaticMarkup(<ReportForm threadId={THREAD} />);

    expect(fieldNames(markup)).not.toContain('postId');
  });
});

describe('un point du parcours', () => {
  const community = {
    editionId: EDITION,
    raceId: 'aaaaaaaa-0000-4000-8000-000000000101',
    pointThreads: ['t1', 't2', 't3', 't4'].map(
      (id, index) =>
        ({
          id,
          title: `Sujet ${id}`,
          waypointId: LENK,
          replyCount: index,
        }) as never,
    ),
  };

  it('les liens gardent l’édition, le filtre et le préremplissage', () => {
    expect(communityListHref(EDITION, { point: LENK })).toBe(
      `/communaute?edition=${EDITION}&point=${LENK}`,
    );
    expect(communityNewHref(EDITION, { race: 'r', point: LENK })).toBe(
      `/communaute/nouveau?edition=${EDITION}&course=r&point=${LENK}`,
    );
  });

  it('un résumé par point, même sans discussion ; trois sujets au plus', () => {
    const points = pointCommunities(community, [LENK, 'autre-point']);

    expect(points[LENK]?.count).toBe(4);
    expect(points[LENK]?.threads.map((thread) => thread.id)).toEqual(['t1', 't2', 't3']);
    expect(points[LENK]?.threads[1]).toMatchObject({
      replies: '1 réponse',
      href: '/communaute/sujets/t2',
    });
    expect(points['autre-point']).toMatchObject({ count: 0, threads: [] });
    expect(points['autre-point']?.askHref).toContain('point=autre-point');
  });
});

describe('en-tête et auteurs', () => {
  it('les initiales viennent du libellé réduit, jamais d’autre chose', () => {
    expect(authorInitials('Alice D.')).toBe('AD');
    expect(authorInitials('Participant')).toBe('P');
    expect(authorInitials('élodie m.')).toBe('ÉM');
    expect(authorInitials('Compte supprimé')).toBe('–');
  });

  it('l’en-tête compte les discussions, les réponses et les points, sans rien de personnel', () => {
    expect(
      communityFigures([
        { replyCount: 2, waypointId: 'w-1' },
        { replyCount: 1, waypointId: 'w-1' },
        { replyCount: 0, waypointId: null },
      ]),
    ).toBe('3 discussions · 3 réponses · 1 point du parcours');
    expect(communityFigures([{ replyCount: 1, waypointId: null }])).toBe(
      '1 discussion · 1 réponse',
    );
  });
});
