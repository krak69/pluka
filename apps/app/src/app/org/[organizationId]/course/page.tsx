import { redirect } from 'next/navigation';

/** `/course` n'a pas d'écran propre : il s'ouvre sur les informations (05_ROUTES_FLOWS §6.1). */
export default async function CoursePage({
  params,
}: {
  readonly params: Promise<{ readonly organizationId: string }>;
}) {
  const { organizationId } = await params;
  redirect(`/org/${organizationId}/course/informations`);
}
