import {
  COMMUNITY_CATEGORIES,
  getCommunity,
  listMyCommunities,
  type CommunityCategory,
  type CommunitySummary,
} from '@pluka/domain';
import { SectionHeader } from '@pluka/ui';
import Link from 'next/link';

import { Icon } from '@/components/icon';
import { NotWired } from '@/components/not-wired';
import { communityContext, communityEnabled } from '@/lib/community';
import {
  COMMUNITY_CATEGORY_LABELS,
  communityName,
  communityWhen,
  discussionCount,
  isCommunityCategory,
} from '@/lib/community-format';
import { requireSession } from '@/lib/session';

/**
 * Communauté — 00_PRODUCT_SPEC §21 ; 05_ROUTES_FLOWS §12.4 ; prototype
 * `tab: 'communaute'` ; migration 0114.
 *
 * Une communauté par édition : l'écran ouvre celle de la prochaine course du
 * coureur, un sélecteur apparaît quand il en prépare plusieurs. Les puces de
 * catégorie et le sélecteur sont des liens : ils marchent sans JavaScript et
 * se partagent. Pas de fil global, pas d'abonnés (AC-COM-02).
 */
export const metadata = { title: 'Communauté' };

function listHref(editionId: string, category?: CommunityCategory): string {
  const params = new URLSearchParams({ edition: editionId });
  if (category !== undefined) params.set('categorie', category);
  return `/communaute?${params.toString()}`;
}

function newThreadHref(editionId: string, category?: CommunityCategory): string {
  const params = new URLSearchParams({ edition: editionId });
  if (category !== undefined) params.set('categorie', category);
  return `/communaute/nouveau?${params.toString()}`;
}

export default async function CommunityPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly edition?: string; readonly categorie?: string }>;
}) {
  if (!communityEnabled()) {
    return (
      <div className="ap-page">
        <SectionHeader eyebrow="Ma saison" title="Communauté" />
        <NotWired
          area="Communauté"
          purpose="Les retours des autres participants sur ton épreuve — utiles sur le terrain, jamais présentés comme une règle officielle."
          detail="Les échanges ne sont pas encore ouverts."
        />
      </div>
    );
  }

  const { edition, categorie } = await searchParams;
  const session = await requireSession('/communaute');
  const context = communityContext(session);
  const communities = await listMyCommunities(context);
  const selected =
    communities.find((community) => community.editionId === edition) ?? communities[0];

  if (selected === undefined) {
    return (
      <div className="cm-page">
        <header className="cm-intro">
          <h1 className="cm-title">Communauté</h1>
        </header>
        <div className="cm-empty">
          <Icon name="ChatsCircle" size={26} />
          <p className="cm-empty-title">Ta communauté s’ouvre avec ta première course.</p>
          <p className="cm-empty-text">
            Inscris-toi à une course : tu retrouveras ici les participants de son édition, leurs
            questions et leurs conseils.
          </p>
          <Link href="/recherche" className="pk-btn pk-button-primary cm-cta">
            Trouver une course
          </Link>
        </div>
      </div>
    );
  }

  const view = await getCommunity(context, { editionId: selected.editionId });
  const category = isCommunityCategory(categorie) ? categorie : undefined;
  const threads =
    category === undefined
      ? view.threads
      : view.threads.filter((thread) => thread.category === category);
  const counts = new Map<CommunityCategory, number>();
  for (const thread of view.threads) {
    counts.set(thread.category, (counts.get(thread.category) ?? 0) + 1);
  }
  const now = new Date();

  return (
    <div className="cm-page">
      <header className="cm-intro">
        <h1 className="cm-title">Communauté · {communityName(selected)}</h1>
        <p className="cm-sub">
          Les participants de l’édition s’y entraident, toutes courses confondues. Ce sont des
          conseils de terrain, pas des informations officielles.
        </p>
      </header>

      {communities.length > 1 ? (
        <CommunityPicker communities={communities} selected={selected} />
      ) : null}

      <div className="cm-bar">
        <p className="cm-count">{discussionCount(view.threads.length)}</p>
        {/* Une liste vide porte déjà l'action dans son état vide : un seul Lichen (AGENTS §43). */}
        {threads.length === 0 ? null : (
          <Link
            href={newThreadHref(selected.editionId, category)}
            className="pk-btn pk-button-primary cm-cta"
          >
            <Icon name="Plus" size={18} />
            Créer un sujet
          </Link>
        )}
      </div>

      <nav aria-label="Catégories">
        <ul className="cm-chips">
          <li>
            <Link
              href={listHref(selected.editionId)}
              className="cm-chip"
              aria-current={category === undefined ? 'true' : undefined}
            >
              Tous
            </Link>
          </li>
          {COMMUNITY_CATEGORIES.map((value) => (
            <li key={value}>
              <Link
                href={listHref(selected.editionId, value)}
                className="cm-chip"
                aria-current={category === value ? 'true' : undefined}
              >
                {COMMUNITY_CATEGORY_LABELS[value]}
                {(counts.get(value) ?? 0) > 0 ? (
                  <span className="cm-chip-count">{counts.get(value)}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {threads.length === 0 ? (
        <div className="cm-empty">
          <Icon name="ChatsCircle" size={26} />
          <p className="cm-empty-title">
            {category === undefined
              ? 'Pas encore de discussion ici.'
              : `Pas encore de discussion dans ${COMMUNITY_CATEGORY_LABELS[category]}.`}
          </p>
          <p className="cm-empty-text">
            {category === undefined
              ? 'Tu peux être le premier à poser une question aux participants de l’édition.'
              : 'Tu peux être le premier à poser une question sur cette catégorie.'}
          </p>
          <Link
            href={newThreadHref(selected.editionId, category)}
            className="pk-btn pk-button-primary cm-cta"
          >
            <Icon name="Plus" size={18} />
            Créer un sujet
          </Link>
        </div>
      ) : (
        <ul className="cm-threads">
          {threads.map((thread) => (
            <li key={thread.id}>
              <Link href={`/communaute/sujets/${thread.id}`} className="cm-thread">
                <span className="cm-thread-main">
                  <span className="cm-thread-title">{thread.title}</span>
                  <span className="cm-thread-meta">
                    <span className="cm-thread-cat">
                      {COMMUNITY_CATEGORY_LABELS[thread.category]}
                    </span>
                    <span>
                      {thread.isMine ? 'Toi' : thread.authorLabel} ·{' '}
                      {communityWhen(thread.lastActivityAt, now, selected.timezone)}
                    </span>
                    {thread.raceName === null || view.races.length < 2 ? null : (
                      <span>{thread.raceName}</span>
                    )}
                    {thread.waypointName === null ? null : (
                      <span className="cm-thread-point">
                        <Icon name="MapPin" size={14} />
                        {thread.waypointName}
                      </span>
                    )}
                    {thread.status === 'hidden' ? (
                      <span className="cm-flag">Masqué par la modération</span>
                    ) : null}
                  </span>
                </span>
                <span className="cm-thread-stats">
                  <span>
                    <Icon name="ChatCircle" size={15} />
                    {thread.replyCount}
                    <span className="pk-visually-hidden">
                      {thread.replyCount > 1 ? ' réponses' : ' réponse'}
                    </span>
                  </span>
                  {thread.usefulCount > 0 ? (
                    <span>
                      <Icon name="ThumbsUp" size={15} />
                      {thread.usefulCount}
                      <span className="pk-visually-hidden"> utile</span>
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Les communautés du coureur, une par édition ; les passées après les prochaines. */
function CommunityPicker({
  communities,
  selected,
}: {
  readonly communities: readonly CommunitySummary[];
  readonly selected: CommunitySummary;
}) {
  return (
    <nav aria-label="Mes communautés">
      <ul className="cm-picker">
        {communities.map((community) => (
          <li key={community.editionId}>
            <Link
              href={listHref(community.editionId)}
              className="cm-picker-item"
              aria-current={community.editionId === selected.editionId ? 'true' : undefined}
            >
              <span className="cm-picker-name">{communityName(community)}</span>
              <span className="cm-picker-races">
                {community.myRaces.map((race) => race.name).join(' · ')}
                {community.past ? ' · passée' : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
