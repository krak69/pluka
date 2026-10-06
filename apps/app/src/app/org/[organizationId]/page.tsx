import { redirect } from 'next/navigation';

/**
 * Accueil organisateur — pas encore d'écran (05_ROUTES_FLOWS §6.1, état
 * livré). En attendant, l'espace s'ouvre sur l'équipe ; la redirection tombera
 * quand l'accueil existera.
 */
export default async function OrganizationHomePage({
  params,
}: {
  readonly params: Promise<{ readonly organizationId: string }>;
}) {
  const { organizationId } = await params;
  redirect(`/org/${organizationId}/parametres/equipe`);
}
