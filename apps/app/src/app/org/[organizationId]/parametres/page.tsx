import { redirect } from 'next/navigation';

/**
 * Paramètres — redirige vers leur premier sous-onglet. §6.1 vise
 * `/evenement` ; tant qu'il n'a pas d'écran, c'est l'équipe.
 */
export default async function SettingsPage({
  params,
}: {
  readonly params: Promise<{ readonly organizationId: string }>;
}) {
  const { organizationId } = await params;
  redirect(`/org/${organizationId}/parametres/equipe`);
}
