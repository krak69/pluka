import { redirect } from 'next/navigation';

/**
 * La Nutrition vit sous le Plan (AGENTS §39, prototype) : l'ancienne adresse
 * mène à sa bande sur la page Plan.
 */
export default async function NutritionPage({
  params,
}: {
  readonly params: Promise<{ readonly participantRaceId: string }>;
}) {
  const { participantRaceId } = await params;
  redirect(`/courses/${participantRaceId}/plan#nutrition`);
}
