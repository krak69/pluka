import {
  COMMUNITY_CATEGORIES,
  getCommunity,
  listMyCommunities,
  type CommunityCategory,
  type CommunitySummary,
  type CommunityView,
} from '@pluka/domain';
import { SectionHeader, TerrainBand } from '@pluka/ui';
import Link from 'next/link';

import { Byline, TrustNote } from '@/app/(shell)/communaute/community-ui';
import { Icon } from '@/components/icon';
import { NotWired } from '@/components/not-wired';
import { communityContext, communityEnabled } from '@/lib/community';
import {
  COMMUNITY_CATEGORY_LABELS,
  communityFigures,
  communityListHref,
  communityName,
  communityNewHref,
  communityThreadHref,
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
 * coureur, un sélecteur apparaît quand il en prépare plusieurs. Une bande de
 * terrain pose la scène (06_DESIGN_SYSTEM §22) et porte la seule action Lichen ;
 * dessous, une carte par sujet, et sur grand écran une colonne pour les points
 * du parcours et le rappel de l'information officielle.
 *
 * Les puces de catégorie, le sélecteur et `?point=` sont des liens : ils
 * marchent sans JavaScript et se partagent. Pas de fil global, pas d'abonnés
 * (AC-COM-02).
 */
export const metadata = { title: 'Communauté' };

export default async function CommunityPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly edition?: string;
    readonly categorie?: string;
    readonly point?: string;
  }>;
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

  const { edition, categorie, point } = await searchParams;
  const session = await requireSession('/communaute');
  const context = communityContext(session);
  const communities = await listMyCommunities(context);
  const selected =
    communities.find((community) => community.editionId === edition) ?? communities[0];

  if (selected === undefined) {
    return (
      <div className="cm-page">
        <TerrainBand
          tone="dark"
          topo
          eyebrow="Communauté"
          title="Les participants de ta course, au même endroit."
          body={
            <p className="cm-band-text">
              Inscris-toi à une course&nbsp;: tu retrouveras ici les participants de son édition,
              leurs questions et leurs conseils.
            </p>
          }
          primaryAction={
            <Link href="/recherche" className="pk-btn pk-button-primary cm-cta">
              Trouver une course
            </Link>
          }
        />
      </div>
    );
  }

  const view = await getCommunity(context, { editionId: selected.editionId });
  const category = isCommunityCategory(categorie) ? categorie : undefined;
  // Un point inconnu de l'édition n'est pas un filtre : la liste reste entière.
  const place = view.races
    .flatMap((race) =>
      race.points.map((entry) => ({ ...entry, raceId: race.raceId, raceName: race.name })),
    )
    .find((entry) => entry.waypointId === point);
  const atPlace =
    place === undefined
      ? view.threads
      : view.threads.filter((thread) => thread.waypointId === place.waypointId);
  const threads =
    category === undefined ? atPlace : atPlace.filter((thread) => thread.category === category);
  const counts = new Map<CommunityCategory, number>();
  for (const thread of atPlace) {
    counts.set(thread.category, (counts.get(thread.category) ?? 0) + 1);
  }
  const newHref = communityNewHref(selected.editionId, {
    category,
    race: place?.raceId,
    point: place?.waypointId,
  });
  const now = new Date();
  const courseHref =
    selected.myRaces[0] === undefined
      ? null
      : `/courses/${selected.myRaces[0].participantRaceId}/course`;

  return (
    <div className="cm-page">
      <TerrainBand
        tone="dark"
        topo
        eyebrow="Communauté"
        title={communityName(selected)}
        body={
          <>
            <p className="cm-band-text">
              Les participants de l’édition s’y entraident, toutes courses confondues&nbsp;: des
              conseils de terrain, pas des informations officielles.
            </p>
            {communities.length > 1 ? (
              <CommunityPicker communities={communities} selected={selected} />
            ) : null}
          </>
        }
        footer={communityFigures(view.threads)}
        primaryAction={
          <Link href={newHref} className="pk-btn pk-button-primary cm-cta">
            <Icon name="Plus" size={18} />
            Créer un sujet
          </Link>
        }
      />

      <div className="cm-layout">
        <div className="cm-main">
          {place === undefined ? null : (
            <p className="cm-place">
              <Icon name="MapPin" size={16} />
              <span>
                Sujets rattachés à <strong>{place.name}</strong>
                {view.races.length > 1 ? ` · ${place.raceName}` : ''}
              </span>
              <Link
                href={communityListHref(selected.editionId, { category })}
                className="cm-place-clear"
              >
                Tous les points
              </Link>
            </p>
          )}

          <nav aria-label="Catégories" className="cm-chips-wrap">
            <ul className="cm-chips">
              <li>
                <Link
                  href={communityListHref(selected.editionId, { point: place?.waypointId })}
                  className="cm-chip"
                  aria-current={category === undefined ? 'true' : undefined}
                >
                  Tous
                  <span className="cm-chip-count">{atPlace.length}</span>
                </Link>
              </li>
              {COMMUNITY_CATEGORIES.map((value) => (
                <li key={value}>
                  <Link
                    href={communityListHref(selected.editionId, {
                      category: value,
                      point: place?.waypointId,
                    })}
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
            <div className="cm-card cm-empty">
              <span className="cm-empty-mark" aria-hidden="true">
                <Icon name="ChatsCircle" size={26} />
              </span>
              <p className="cm-empty-title">
                {category !== undefined
                  ? `Pas encore de discussion dans ${COMMUNITY_CATEGORY_LABELS[category]}.`
                  : place !== undefined
                    ? `Pas encore de discussion sur ${place.name}.`
                    : 'Pas encore de discussion ici.'}
              </p>
              <p className="cm-empty-text">
                {category !== undefined
                  ? 'Tu peux être le premier à poser une question sur cette catégorie.'
                  : place !== undefined
                    ? 'Tu peux être le premier à poser une question sur ce point.'
                    : 'Tu peux être le premier à poser une question aux participants de l’édition.'}
              </p>
              {/* Le Lichen est dans la bande : ici, une action secondaire (AGENTS §43). */}
              <Link href={newHref} className="pk-btn pk-button-secondary cm-cta">
                <Icon name="Plus" size={18} />
                Poser une question
              </Link>
            </div>
          ) : (
            <ul className="cm-threads">
              {threads.map((thread) => (
                <li key={thread.id}>
                  <ThreadCard
                    thread={thread}
                    when={communityWhen(thread.lastActivityAt, now, selected.timezone)}
                    showRace={view.races.length > 1}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="cm-aside" aria-label="À côté des discussions">
          <PointsCard view={view} editionId={selected.editionId} current={place?.waypointId} />
          <TrustNote courseHref={courseHref} />
        </aside>
      </div>
    </div>
  );
}

/** Un sujet de la liste — prototype `commThreads` : catégorie, titre, auteur, réponses. */
function ThreadCard({
  thread,
  when,
  showRace,
}: {
  readonly thread: CommunityView['threads'][number];
  readonly when: string;
  readonly showRace: boolean;
}) {
  return (
    <Link href={communityThreadHref(thread.id)} className="cm-card cm-thread">
      <span className="cm-thread-tags">
        <span className="pk-label cm-tag cm-tag-category">
          {COMMUNITY_CATEGORY_LABELS[thread.category]}
        </span>
        {thread.waypointName === null ? null : (
          <span className="pk-label cm-tag cm-tag-point">
            <Icon name="MapPin" size={12} />
            {thread.waypointName}
          </span>
        )}
        {thread.raceName === null || !showRace ? null : (
          <span className="pk-label cm-tag">{thread.raceName}</span>
        )}
        {thread.status === 'hidden' ? (
          <span className="cm-flag">Masqué par la modération</span>
        ) : null}
      </span>
      <span className="cm-thread-title">{thread.title}</span>
      <span className="cm-thread-foot">
        <Byline label={thread.authorLabel} mine={thread.isMine} when={when} />
        <span className="cm-thread-stats">
          <span className="cm-stat">
            <Icon name="ChatCircle" size={16} />
            {thread.replyCount}
            <span className="pk-visually-hidden">
              {thread.replyCount > 1 ? ' réponses' : ' réponse'}
            </span>
          </span>
          {thread.usefulCount > 0 ? (
            <span className="cm-stat">
              <Icon name="ThumbsUp" size={16} />
              {thread.usefulCount}
              <span className="pk-visually-hidden"> utile</span>
            </span>
          ) : null}
        </span>
      </span>
    </Link>
  );
}

/**
 * Les points du parcours qui ont des discussions, du plus discuté au moins —
 * une entrée par le terrain plutôt que par la catégorie.
 */
function PointsCard({
  view,
  editionId,
  current,
}: {
  readonly view: CommunityView;
  readonly editionId: string;
  readonly current: string | undefined;
}) {
  const names = new Map(
    view.races.flatMap((race) =>
      race.points.map((entry) => [
        entry.waypointId,
        view.races.length > 1 ? `${entry.name} · ${race.name}` : entry.name,
      ]),
    ),
  );
  const counts = new Map<string, number>();
  for (const thread of view.threads) {
    if (thread.waypointId !== null) {
      counts.set(thread.waypointId, (counts.get(thread.waypointId) ?? 0) + 1);
    }
  }
  const points = [...counts.entries()]
    .filter(([waypointId]) => names.has(waypointId))
    .sort((left, right) => right[1] - left[1]);
  if (points.length === 0) return null;

  return (
    <section className="cm-card cm-side" aria-labelledby="cm-points-title">
      <p id="cm-points-title" className="pk-label">
        Par point du parcours
      </p>
      <ul className="cm-side-list">
        {points.map(([waypointId, count]) => (
          <li key={waypointId}>
            <Link
              href={communityListHref(editionId, { point: waypointId })}
              aria-current={current === waypointId ? 'true' : undefined}
            >
              <Icon name="MapPin" size={15} />
              <span className="cm-side-name">{names.get(waypointId)}</span>
              <span className="cm-side-count">{discussionCount(count)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
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
              href={communityListHref(community.editionId)}
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
