import { redirect } from 'next/navigation';

/** `05_ROUTES_FLOWS.md` §9.3 — redirection vers le premier onglet. */
export default async function PreparationPage({
  params,
}: {
  readonly params: Promise<{ readonly participantRaceId: string }>;
}) {
  const { participantRaceId } = await params;

  redirect(`/courses/${participantRaceId}/preparation/materiel`);
}
