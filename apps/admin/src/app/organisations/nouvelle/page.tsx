import { CreateOrganizationForm } from '@/app/create-organization-form';
import { requireAdminConsoleGate } from '@/lib/admin';

/**
 * Création d'une organisation — 00_PRODUCT_SPEC §3.5, « gestion
 * d'organisations ». Le prototype n'a pas ce geste ; la page suit
 * la même grammaire que `/evenements/nouveau` : plein écran (`isFocusMode`,
 * la barre latérale reste), bandeau de terrain en tête, carte centrée.
 *
 * La garde d'entrée renvoie un non-administrateur vers `/refuse` avant
 * d'afficher le formulaire ; `admin_create_organization` revérifie le rôle à
 * l'envoi.
 */
export const metadata = { title: 'Créer une organisation' };

export default async function NewOrganizationPage() {
  await requireAdminConsoleGate('/organisations/nouvelle');

  return (
    <main className="ad-wizard-page">
      <CreateOrganizationForm />
    </main>
  );
}
