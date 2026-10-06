'use server';

import {
  archiveNutritionProduct,
  createOrganization,
  deleteOrganization,
  dismissReport,
  hideReportedContent,
  updateOrganization,
  retryAdminJob,
  validateNutritionProduct,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { ActionState } from '@/app/actions';
import { actionFailure, adminActionsContext } from '@/lib/admin';
import { checked, createOrganizationCommand, text, updateOrganizationCommand } from '@/lib/form';
import { requireSession } from '@/lib/session';

/**
 * Écritures de la console d'administration — migration 0029.
 *
 * Même contrat que `actions.ts` : chaque action transmet une intention et un
 * acteur à un use case de `@pluka/domain`, et ne décide rien. La garde
 * `pluka_admin`, la transition autorisée et la ligne de journal sont dans la
 * fonction SQL ; la confirmation des gestes destructeurs est revérifiée par le
 * schéma du domaine.
 *
 * Un refus revient en `ActionState.error`, que le formulaire affiche à côté de
 * son bouton. Aucun bouton n'est masqué selon le rôle : c'est la base qui
 * répond, et l'écran qui le dit.
 *
 * Un succès redirige vers l'écran, avec `?fait=` : le geste change le statut
 * de la ligne, donc la fait sortir de la file ou perdre son bouton — un
 * compte rendu porté par le formulaire disparaîtrait avec elle. L'écran
 * l'annonce en tête (`lib/console-notice.ts`).
 */

/**
 * Masquer le contenu signalé.
 *
 * Le succès quitte le détail pour la file : recharger le détail relirait le
 * contenu et l'identité des personnes, donc écrirait une seconde lecture
 * auditée que personne n'a demandée.
 */
export async function hideReportedContentAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const reportId = text(form, 'reportId') ?? '';
  const context = adminActionsContext(await requireSession(`/signalements/${reportId}`));

  let closed: number;

  try {
    ({ closedReports: closed } = await hideReportedContent(context, {
      reportId,
      confirmed: checked(form, 'confirmed'),
    }));
  } catch (error) {
    return actionFailure(error);
  }

  revalidatePath('/signalements');
  revalidatePath('/vue-d-ensemble');
  redirect(`/signalements?fait=masque&n=${closed}`);
}

/** Classer sans suite — même retour vers la file, pour la même raison. */
export async function dismissReportAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const reportId = text(form, 'reportId') ?? '';
  const context = adminActionsContext(await requireSession(`/signalements/${reportId}`));

  try {
    await dismissReport(context, { reportId });
  } catch (error) {
    return actionFailure(error);
  }

  revalidatePath('/signalements');
  revalidatePath('/vue-d-ensemble');
  redirect('/signalements?fait=classe');
}

export async function retryJobAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const context = adminActionsContext(await requireSession('/traitements'));

  let retry: number;

  try {
    ({ retry } = await retryAdminJob(context, { jobId: text(form, 'jobId') ?? '' }));
  } catch (error) {
    return actionFailure(error);
  }

  revalidatePath('/traitements');
  revalidatePath('/vue-d-ensemble');
  redirect(`/traitements?fait=relance&n=${retry}`);
}

/**
 * Les deux onglets de la Banque portent des gestes : le retour se fait sur
 * celui d'où le geste est parti. Une liste fermée, pas une URL libre.
 */
const PRODUCT_TABS = {
  catalogue: '/produits/catalogue',
  'a-verifier': '/produits/a-verifier',
} as const;

function productTab(form: FormData): string {
  const from = text(form, 'from');
  return from === 'a-verifier' ? PRODUCT_TABS['a-verifier'] : PRODUCT_TABS.catalogue;
}

export async function validateNutritionProductAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const tab = productTab(form);
  const context = adminActionsContext(await requireSession(tab));

  try {
    await validateNutritionProduct(context, { productId: text(form, 'productId') ?? '' });
  } catch (error) {
    return actionFailure(error);
  }

  revalidateProducts();
  redirect(`${tab}?fait=valide`);
}

/** Refuser une proposition ou retirer une fiche du catalogue : les deux archivent. */
export async function archiveNutritionProductAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const tab = productTab(form);
  const context = adminActionsContext(await requireSession(tab));

  try {
    await archiveNutritionProduct(context, {
      productId: text(form, 'productId') ?? '',
      confirmed: checked(form, 'confirmed'),
    });
  } catch (error) {
    return actionFailure(error);
  }

  revalidateProducts();
  redirect(`${tab}?fait=archive`);
}

function revalidateProducts(): void {
  revalidatePath(PRODUCT_TABS.catalogue);
  revalidatePath(PRODUCT_TABS['a-verifier']);
  revalidatePath('/vue-d-ensemble');
}

/**
 * Créer une organisation — migration 0030.
 *
 * Le succès revient à la liste, où la nouvelle organisation apparaît : le
 * formulaire n'a plus rien à afficher une fois la ligne créée.
 */
export async function createOrganizationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const context = adminActionsContext(await requireSession('/organisations/nouvelle'));

  try {
    await createOrganization(context, createOrganizationCommand(form));
  } catch (error) {
    return actionFailure(error);
  }

  revalidatePath('/organisations');
  revalidatePath('/evenements/nouveau');
  revalidatePath('/vue-d-ensemble');
  redirect('/organisations?fait=organisation');
}

/**
 * Éditer une organisation — migration 0031.
 *
 * Retour à la liste, qui porte les champs modifiés. Une saisie identique n'est
 * pas une erreur : la base n'écrit rien, et l'écran le dit.
 */
export async function updateOrganizationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const organizationId = text(form, 'organizationId') ?? '';
  const context = adminActionsContext(await requireSession(`/organisations/${organizationId}`));

  let changedFields: number;

  try {
    ({ changedFields } = await updateOrganization(context, updateOrganizationCommand(form)));
  } catch (error) {
    return actionFailure(error);
  }

  revalidatePath('/organisations');
  revalidatePath(`/organisations/${organizationId}`);
  revalidatePath('/evenements/nouveau');
  revalidatePath('/');
  revalidatePath('/vue-d-ensemble');
  redirect(
    changedFields === 0
      ? '/organisations?fait=organisation-inchangee'
      : '/organisations?fait=organisation-modifiee',
  );
}

/**
 * Supprimer une organisation vide — migration 0032.
 *
 * Le succès quitte la fiche, qui n'existe plus, pour la liste.
 */
export async function deleteOrganizationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const organizationId = text(form, 'organizationId') ?? '';
  const context = adminActionsContext(await requireSession(`/organisations/${organizationId}`));

  try {
    await deleteOrganization(context, { organizationId, confirmed: checked(form, 'confirmed') });
  } catch (error) {
    return actionFailure(error);
  }

  revalidatePath('/organisations');
  revalidatePath('/evenements/nouveau');
  revalidatePath('/vue-d-ensemble');
  redirect('/organisations?fait=organisation-supprimee');
}
