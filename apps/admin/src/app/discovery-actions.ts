'use server';

import {
  addEditionDocuments,
  addEditionFile,
  createEventWithEdition,
  refreshEventInventory,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { ActionState } from '@/app/actions';
import { actionFailure, eventDiscoveryContext } from '@/lib/admin';
import { createEventWithEditionCommand, text, texts } from '@/lib/form';
import { requireSession } from '@/lib/session';

/**
 * Création classique d'un événement, inventaire du site, documents —
 * migrations 0040, 0042.
 *
 * Même contrat que les autres actions de la console : lire le formulaire,
 * passer l'intention au use case, rendre le refus. Aucune règle ici — le
 * domaine valide, la base garde et journalise.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function context(returnTo: string) {
  return eventDiscoveryContext(await requireSession(returnTo));
}

/** Étapes 1 à 3 envoyées ensemble ; le succès ouvre l'étape 4, les documents. */
export async function createEventWithEditionAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  let eventId: string;

  try {
    ({ eventId } = await createEventWithEdition(
      await context('/evenements/nouveau'),
      createEventWithEditionCommand(form),
    ));
  } catch (error) {
    return actionFailure(error);
  }

  revalidatePath('/');
  redirect(`/evenements/${eventId}/documents?creation=1`);
}

/** Relancer la lecture du site officiel. */
export async function refreshEventInventoryAction(form: FormData): Promise<void> {
  const eventId = text(form, 'eventId');
  if (eventId === undefined || !UUID.test(eventId)) return;

  const returnTo = `/evenements/${eventId}/documents`;
  await refreshEventInventory(await context(returnTo), { eventId });

  revalidatePath(returnTo);
  redirect(returnTo);
}

/** Empreinte SHA-256 des octets reçus — jamais celle qu'annoncerait le navigateur. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Étape 4 : les pages et documents choisis et les fichiers déposés partent à
 * l'analyse. Chaque choix coché porte `kind|url|titre` ; son épreuve est lue
 * dans le champ `scope.<url>`.
 */
export async function analyzeDocumentsAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const eventId = text(form, 'eventId');
  const editionId = text(form, 'editionId');
  if (eventId === undefined || !UUID.test(eventId) || editionId === undefined) {
    return { error: 'Édition introuvable.' };
  }

  const returnTo = `/evenements/${eventId}/documents`;
  const ctx = await context(returnTo);

  const documents = texts(form, 'documents')
    .filter((value) => value !== '')
    .map((value) => {
      const [kind = 'page', url = '', ...title] = value.split('|');
      return {
        url,
        kind: kind === 'pdf' ? ('pdf' as const) : ('page' as const),
        title: title.join('|') || url,
        raceId: text(form, `scope.${url}`) ?? null,
      };
    });

  const files = form
    .getAll('files')
    .filter((value): value is File => value instanceof File && value.size > 0);

  if (documents.length === 0 && files.length === 0) {
    return { error: 'Choisis au moins une page ou un document, ou dépose un fichier.' };
  }

  try {
    if (documents.length > 0) await addEditionDocuments(ctx, { editionId, documents });

    for (const upload of files) {
      const bytes = new Uint8Array(await upload.arrayBuffer());
      await addEditionFile(ctx, {
        editionId,
        fileName: upload.name,
        bytes,
        contentHash: await sha256Hex(bytes),
        raceId: text(form, 'filesScope') ?? null,
      });
    }
  } catch (error) {
    return actionFailure(error);
  }

  revalidatePath(returnTo);
  redirect(`${returnTo}?analyse=1`);
}
