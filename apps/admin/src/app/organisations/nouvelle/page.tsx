import Link from 'next/link';

import { CreateOrganizationForm } from '@/app/create-organization-form';
import { AdminPageHeader } from '@/components/admin-page';
import { requireAdminConsoleGate } from '@/lib/admin';

/**
 * Création d'une organisation — 00_PRODUCT_SPEC §3.5, « gestion
 * d'organisations ». Le prototype n'a pas ce geste ; la page suit
 * `/evenements/nouveau`.
 *
 * La garde d'entrée renvoie un non-administrateur vers `/refuse` avant
 * d'afficher le formulaire ; `admin_create_organization` revérifie le rôle à
 * l'envoi.
 */
export const metadata = { title: 'Créer une organisation' };

export default async function NewOrganizationPage() {
  await requireAdminConsoleGate('/organisations/nouvelle');

  return (
    <main className="ad-page">
      <Link href="/organisations" className="pk-link">
        Organisations
      </Link>

      <AdminPageHeader title="Créer une organisation" />

      <CreateOrganizationForm />
    </main>
  );
}
