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
  }>;
}) {
  if (!communityEnabled()) notFound();

  const { edition, categorie, course } = await searchParams;
  const session = await requireSession('/communaute/nouveau');
  const context = communityContext(session);
  const community = (await listMyCommunities(context)).find(
    (candidate) => candidate.editionId === edition,
  );
  if (community === undefined) redirect('/communaute');

  const view = await getCommunity(context, { editionId: community.editionId });
  const back = `/communaute?edition=${community.editionId}`;

  return (
    <div className="cm-page cm-page-narrow">
      <Link href={back} className="cm-back">
        <Icon name="ArrowLeft" size={18} />
        Toutes les discussions
      </Link>

      <header className="cm-intro">
        <h1 className="cm-title">Créer un sujet</h1>
        <p className="cm-sub">
          {communityName(community)} — visible par les participants de l’édition, toutes courses
          confondues. Ton nom s’affiche sous la forme « Prénom N. ».
        </p>
      </header>

      <NewThreadForm
        editionId={community.editionId}
        races={view.races}
        defaultCategory={isCommunityCategory(categorie) ? categorie : 'other'}
        defaultRaceId={view.races.some((race) => race.raceId === course) ? (course ?? '') : ''}
        cancelHref={back}
      />
    </div>
  );
}
