import { getRaceAdministration, listCandidatesForReview } from '@pluka/domain';
import { Divider, MicroLabel } from '@pluka/ui';
import Link from 'next/link';

import { CandidateReviewList } from '@/app/courses/[raceId]/revue/review-list';
import { redirectOnDomainError, requireAdminContext, requireFactReviewContext } from '@/lib/admin';

/**
 * Revue des candidats d'extraction — docs/engines/SOURCES_EXTRACTION.md §30.
 *
 * « Toute information critique extraite doit passer par une validation humaine
 * avant publication. La revue doit afficher : valeur proposée ; type ;
 * source ; extrait ; page / section ; anciennes valeurs ; contradictions ;
 * action proposée. »
 *
 * L'écran ne décide rien. Il lit par `listCandidatesForReview` — dont la
 * fonction SQL porte sa propre condition d'accès — et agit par les use cases
 * de publication. Aucun rôle n'est testé ici : §32 est appliqué par le
 * domaine et réappliqué par la base, et un bouton proposé à tort donne un
 * refus lisible, jamais un contournement.
 *
 * Deux contextes, parce que deux autorités différentes : `requireAdminContext`
 * garde l'application d'administration (réservée à `pluka_admin`), tandis que
 * la revue elle-même est ouverte aux rôles d'organisation. Les deux sont
 * relues en base.
 */
export default async function ReviewPage({
  params,
}: {
  readonly params: Promise<{ readonly raceId: string }>;
}) {
  const { raceId } = await params;
  const returnTo = `/courses/${raceId}/revue`;

  const adminContext = await requireAdminContext(returnTo);
  const { race, event } = await getRaceAdministration(adminContext, { raceId }).catch(
    redirectOnDomainError,
  );

  const reviewContext = await requireFactReviewContext(returnTo);
  const candidates = await listCandidatesForReview(reviewContext, { raceId, limit: 100 }).catch(
    redirectOnDomainError,
  );

  return (
    <main
      style={{
        maxWidth: 'var(--content-main)',
        margin: '0 auto',
        padding: 'var(--space-8) var(--space-6)',
      }}
    >
      <Link href={`/courses/${raceId}`} className="pk-link">
        {race.name}
      </Link>

      <MicroLabel>Revue des candidats</MicroLabel>
      <h1 className="pk-h1" style={{ margin: 'var(--space-2) 0 var(--space-2)' }}>
        {event.name}
      </h1>

      <p className="pk-body" style={{ color: 'var(--pk-text-muted)', maxWidth: '62ch' }}>
        Chaque proposition est issue d’une extraction. Rien n’est publié tant qu’une décision
        humaine n’a pas été prise, et la valeur retenue devient une version datée, remplaçable mais
        jamais réécrite.
      </p>

      <Divider spaced />

      <CandidateReviewList raceId={raceId} candidates={candidates} />
    </main>
  );
}
