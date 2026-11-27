import { getCommunity, listMyCommunities } from '@pluka/domain';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { NewThreadForm } from '@/app/(shell)/communaute/new-thread-form';
import { Icon } from '@/components/icon';
import { communityContext, communityEnabled } from '@/lib/community';
import { communityName, isCommunityCategory } from '@/lib/community-format';
import { requireSession } from '@/lib/session';

/**
 * Créer un sujet — prototype `composerOpen`. Une page plutôt qu'une boîte de
 * dialogue : elle marche sans JavaScript, et sur mobile un formulaire plein
 * écran se remplit mieux qu'une fenêtre par-dessus la liste.
 */
export const metadata = { title: 'Créer un sujet · Communauté' };

export default async function NewCommunityThreadPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly edition?: string;
    readonly categorie?: string;
    readonly course?: string;
    readonly point?: string;
  }>;
}) {
  if (!communityEnabled()) notFound();

  const { edition, categorie, course, point } = await searchParams;
  const session = await requireSession('/communaute/nouveau');
  const context = communityContext(session);
  const community = (await listMyCommunities(context)).find(
    (candidate) => candidate.editionId === edition,
  );
  if (community === undefined) redirect('/communaute');

  const view = await getCommunity(context, { editionId: community.editionId });
  const back = `/communaute?edition=${community.editionId}`;
  // Un point venu du Plan ou de La course : sa course est choisie avec lui.
  const pointRace = view.races.find((race) =>
    race.points.some((entry) => entry.waypointId === point),
  );
  const raceId = view.races.some((race) => race.raceId === course) ? course : pointRace?.raceId;

  return (
    <div className="cm-page">
      <Link href={back} className="cm-back">
        <Icon name="ArrowLeft" size={18} />
        Toutes les discussions
      </Link>

      <header className="cm-intro">
        <p className="pk-label">Communauté · {communityName(community)}</p>
        <h1 className="cm-title">Créer un sujet</h1>
      </header>

      <div className="cm-layout">
        <div className="cm-main">
          <div className="cm-card cm-form-card">
            <NewThreadForm
              editionId={community.editionId}
              races={view.races}
              defaultCategory={isCommunityCategory(categorie) ? categorie : 'other'}
              defaultRaceId={raceId ?? ''}
              defaultWaypointId={pointRace === undefined ? '' : (point ?? '')}
              cancelHref={back}
            />
          </div>
        </div>

        <aside className="cm-aside" aria-label="Pour un bon sujet">
          <section className="cm-card cm-side" aria-labelledby="cm-tips-title">
            <p id="cm-tips-title" className="pk-label">
              Pour une réponse rapide
            </p>
            <ol className="cm-tips">
              <li>
                <strong>Une question par sujet</strong>, posée dans le titre.
              </li>
              <li>
                <strong>Rattache-la à son point</strong>&nbsp;: elle apparaît alors dans le Plan des
                participants de cette course.
              </li>
              <li>
                <strong>Dis ce que tu as déjà vérifié</strong> — règlement, guide du coureur.
              </li>
            </ol>
          </section>
          <section className="cm-card cm-note" aria-labelledby="cm-visible-title">
            <p id="cm-visible-title" className="pk-label">
              Qui le lira
            </p>
            <p className="cm-note-text">
              Les participants de l’édition, toutes courses confondues. Ton nom s’affiche
              «&nbsp;Prénom N.&nbsp;»&nbsp;; n’écris ni téléphone ni adresse.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
