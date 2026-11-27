import {
  DomainError,
  getCommunityThread,
  listMyCommunities,
  type CommunityThreadView,
} from '@pluka/domain';
import { TrustBadge } from '@pluka/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  deleteCommunityContentAction,
  setCommunityUsefulAction,
} from '@/app/(shell)/communaute/actions';
import { Byline, TrustNote } from '@/app/(shell)/communaute/community-ui';
import { ReplyForm, ReportForm } from '@/app/(shell)/communaute/thread-forms';
import { CommunityText } from '@/components/community-text';
import { Icon } from '@/components/icon';
import { communityContext, communityEnabled } from '@/lib/community';
import {
  COMMUNITY_CATEGORY_LABELS,
  communityListHref,
  communityName,
  communityWhen,
  replyCount,
} from '@/lib/community-format';
import { requireSession } from '@/lib/session';

/**
 * Un sujet de la Communauté — prototype `threadOpen` ; 03_PRIVACY_RLS §53 à
 * §55 ; 0114.
 *
 * Un sujet masqué par la modération reste lisible par son auteur seul, sans
 * réponse possible ; un sujet supprimé, ou d'une communauté où le coureur n'a
 * pas sa place, n'existe pas pour lui : la page répond 404 dans les deux cas,
 * sans dire lequel (03_PRIVACY_RLS §120).
 */
export const metadata = { title: 'Discussion · Communauté' };

async function readThread(
  context: ReturnType<typeof communityContext>,
  threadId: string,
): Promise<CommunityThreadView> {
  try {
    return await getCommunityThread(context, { threadId });
  } catch (error) {
    if (
      error instanceof DomainError &&
      (error.code === 'not_found' || error.code === 'forbidden' || error.code === 'validation')
    ) {
      notFound();
    }
    throw error;
  }
}

export default async function CommunityThreadPage({
  params,
}: {
  readonly params: Promise<{ readonly threadId: string }>;
}) {
  if (!communityEnabled()) notFound();

  const { threadId } = await params;
  const session = await requireSession(`/communaute/sujets/${threadId}`);
  const context = communityContext(session);
  const [thread, communities] = await Promise.all([
    readThread(context, threadId),
    listMyCommunities(context),
  ]);
  const community = communities.find((candidate) => candidate.editionId === thread.editionId);
  const timeZone = community?.timezone ?? 'UTC';
  const now = new Date();
  const published = thread.status === 'published';
  const posts = thread.posts;
  const answers = posts.filter((post) => post.status === 'published').length;
  // La course du sujet quand c'est l'une des siennes : son Plan et La course sont à un clic.
  const sameRace = community?.myRaces.find((race) => race.raceId === thread.raceId);
  const mine = sameRace ?? community?.myRaces[0];
  const pointHref =
    thread.waypointId === null
      ? null
      : communityListHref(thread.editionId, { point: thread.waypointId });

  return (
    <div className="cm-page">
      <Link href={communityListHref(thread.editionId)} className="cm-back">
        <Icon name="ArrowLeft" size={18} />
        {community === undefined ? 'Communauté' : `Communauté · ${communityName(community)}`}
      </Link>

      <div className="cm-layout">
        <div className="cm-main">
          <article className="cm-card cm-message cm-opening" aria-labelledby="cm-thread-title">
            {published ? null : (
              <p className="cm-moderated" role="note">
                Masqué par la modération&nbsp;: toi seul le vois encore, et il ne reçoit plus de
                réponses.
              </p>
            )}
            <div className="cm-thread-tags">
              <span className="pk-label cm-tag cm-tag-category">
                {COMMUNITY_CATEGORY_LABELS[thread.category]}
              </span>
              {pointHref === null || thread.waypointName === null ? null : (
                <Link href={pointHref} className="pk-label cm-tag cm-tag-point">
                  <Icon name="MapPin" size={12} />
                  {thread.waypointName}
                </Link>
              )}
              {thread.raceName === null ? null : (
                <span className="pk-label cm-tag">{thread.raceName}</span>
              )}
              <TrustBadge level="community" />
            </div>
            <h1 id="cm-thread-title" className="cm-thread-heading">
              {thread.title}
            </h1>
            <Byline
              label={thread.authorLabel}
              mine={thread.isMine}
              when={communityWhen(thread.createdAt, now, timeZone)}
            />
            {thread.body === '' ? null : <CommunityText text={thread.body} />}
            <div className="cm-message-foot cm-gestures">
              {thread.isMine || !published ? (
                <UsefulCount count={thread.usefulCount} />
              ) : (
                <UsefulButton
                  threadId={thread.id}
                  useful={thread.usefulByMe}
                  count={thread.usefulCount}
                />
              )}
              {thread.isMine || !published ? null : <ReportForm threadId={thread.id} />}
              {thread.isMine ? (
                <DeleteForm threadId={thread.id} editionId={thread.editionId} what="sujet" />
              ) : null}
            </div>
          </article>

          <section className="cm-answers" aria-labelledby="cm-answers-title">
            <h2 id="cm-answers-title" className="cm-section-title">
              Conseils de participants
              <span className="cm-count-pill">{answers}</span>
            </h2>

            {posts.length === 0 ? (
              <p className="cm-answers-empty">
                {published
                  ? 'Pas encore de réponse. Tu connais ce point, ou tu as déjà couru ici\u00a0? Ta réponse aidera les autres.'
                  : 'Aucune réponse.'}
              </p>
            ) : (
              <ol className="cm-posts">
                {posts.map((post) => {
                  const postPublished = post.status === 'published';
                  return (
                    <li key={post.id} className="cm-card cm-message">
                      <Byline
                        label={post.authorLabel}
                        mine={post.isMine}
                        when={communityWhen(post.createdAt, now, timeZone)}
                      >
                        {postPublished ? null : (
                          <span className="cm-flag">Masqué par la modération</span>
                        )}
                      </Byline>
                      <CommunityText text={post.body} />
                      <div className="cm-message-foot cm-gestures">
                        {post.isMine || !postPublished || !published ? (
                          <UsefulCount count={post.usefulCount} />
                        ) : (
                          <UsefulButton
                            threadId={thread.id}
                            postId={post.id}
                            useful={post.usefulByMe}
                            count={post.usefulCount}
                          />
                        )}
                        {post.isMine || !postPublished || !published ? null : (
                          <ReportForm threadId={thread.id} postId={post.id} />
                        )}
                        {post.isMine ? (
                          <DeleteForm
                            threadId={thread.id}
                            postId={post.id}
                            editionId={thread.editionId}
                            what="réponse"
                          />
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            {thread.canReply ? (
              <div className="cm-card cm-reply-card">
                <ReplyForm threadId={thread.id} />
              </div>
            ) : published ? null : (
              <p className="cm-answers-empty">Ce sujet ne reçoit plus de réponses.</p>
            )}
          </section>
        </div>

        <aside className="cm-aside" aria-label="À propos de cette discussion">
          <section className="cm-card cm-side" aria-labelledby="cm-about-title">
            <p id="cm-about-title" className="pk-label">
              Cette discussion
            </p>
            <dl className="cm-facts">
              {community === undefined ? null : (
                <div>
                  <dt>Édition</dt>
                  <dd>{communityName(community)}</dd>
                </div>
              )}
              <div>
                <dt>Course</dt>
                <dd>{thread.raceName ?? 'Toute l’édition'}</dd>
              </div>
              {thread.waypointName === null ? null : (
                <div>
                  <dt>Point</dt>
                  <dd>{thread.waypointName}</dd>
                </div>
              )}
              <div>
                <dt>Réponses</dt>
                <dd>{replyCount(answers)}</dd>
              </div>
            </dl>
            <div className="cm-side-links">
              {pointHref === null ? null : (
                <Link href={pointHref}>
                  <Icon name="ChatsCircle" size={15} />
                  Les discussions de ce point
                </Link>
              )}
              {sameRace === undefined || thread.waypointId === null ? null : (
                <Link
                  href={`/courses/${sameRace.participantRaceId}/plan#point-${thread.waypointId}`}
                >
                  <Icon name="Path" size={15} />
                  Voir ce point dans mon Plan
                </Link>
              )}
            </div>
          </section>
          <TrustNote
            courseHref={mine === undefined ? null : `/courses/${mine.participantRaceId}/course`}
          />
        </aside>
      </div>
    </div>
  );
}

/** Un « utile » sur son propre message, ou sur un message masqué : un compte, pas un bouton. */
function UsefulCount({ count }: { readonly count: number }) {
  if (count === 0) return null;
  return (
    <span className="cm-useful-count">
      <Icon name="ThumbsUp" size={16} />
      Utile · {count}
    </span>
  );
}

function UsefulButton({
  threadId,
  postId,
  useful,
  count,
}: {
  readonly threadId: string;
  readonly postId?: string;
  readonly useful: boolean;
  readonly count: number;
}) {
  return (
    <form action={setCommunityUsefulAction}>
      <input type="hidden" name="threadId" value={threadId} />
      {postId === undefined ? null : <input type="hidden" name="postId" value={postId} />}
      <input type="hidden" name="useful" value={useful ? 'false' : 'true'} />
      <button type="submit" className="cm-gesture cm-useful" aria-pressed={useful}>
        <Icon name="ThumbsUp" size={16} />
        Utile · {count}
      </button>
    </form>
  );
}

/** Retirer son message : une confirmation repliée, sans JavaScript. */
function DeleteForm({
  threadId,
  postId,
  editionId,
  what,
}: {
  readonly threadId: string;
  readonly postId?: string;
  readonly editionId: string;
  readonly what: 'sujet' | 'réponse';
}) {
  return (
    <details className="cm-disclosure">
      <summary className="cm-gesture">
        <Icon name="Trash" size={16} />
        Supprimer
      </summary>
      <form action={deleteCommunityContentAction} className="cm-disclosure-body">
        <input type="hidden" name="threadId" value={threadId} />
        <input type="hidden" name="editionId" value={editionId} />
        {postId === undefined ? null : <input type="hidden" name="postId" value={postId} />}
        <p className="cm-disclosure-text">
          {what === 'sujet'
            ? 'Ton sujet et ses réponses disparaîtront pour tout le monde. C’est définitif.'
            : 'Ta réponse disparaîtra pour tout le monde. C’est définitif.'}
        </p>
        <button type="submit" className="pk-btn pk-button-destructive">
          Supprimer {what === 'sujet' ? 'mon sujet' : 'ma réponse'}
        </button>
      </form>
    </details>
  );
}
