import { redirect } from 'next/navigation';

/**
 * `05_ROUTES_FLOWS.md` §5.2 : la racine d'une course n'a pas d'écran propre —
 * le prototype ouvre sur le Plan. §9.3 impose la redirection plutôt qu'une page
 * vide.
 */
export default async function CoursePage({
  params,
}: {
  readonly params: Promise<{ readonly participantRaceId: string }>;
}) {
  const { participantRaceId } = await params;

  redirect(`/courses/${participantRaceId}/plan`);
}
