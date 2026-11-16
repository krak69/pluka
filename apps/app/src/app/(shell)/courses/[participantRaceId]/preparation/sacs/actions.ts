'use server';

import {
  addBagItems,
  createBag,
  deleteBag,
  dismissBagSuggestion,
  DomainError,
  EntitlementError,
  removeBagItem,
  renameBag,
  restoreBagSuggestions,
  setBagItemChecked,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';

import { bagsContext } from '@/lib/preparation';
import { requireSession } from '@/lib/session';

/**
 * Gestes de l'onglet Sacs. Le client n'envoie que la participation, le sac et
 * l'intention : le point, le droit (Race Pass) et la propriété se décident
 * dans le domaine, puis dans la base (0095).
 */

export interface BagActionState {
  readonly error?: string;
}

function field(form: FormData, name: string): string {
  return String(form.get(name) ?? '');
}

function pathOf(participantRaceId: string): string {
  return `/courses/${participantRaceId}/preparation/sacs`;
}

/** Le motif d'un refus, dit au coureur ; le détail technique reste dans les journaux. */
function messageOf(error: unknown): string {
  if (error instanceof EntitlementError) {
    return 'Les sacs font partie de la préparation complète, avec le Race Pass.';
  }
  if (error instanceof DomainError && error.code === 'validation') {
    const detail = Object.values(error.details)[0];
    return detail === undefined
      ? 'Vérifie ce que tu as saisi.'
      : `${detail.charAt(0).toUpperCase()}${detail.slice(1)}.`;
  }
  console.error('sacs : geste refusé', {
    code: error instanceof DomainError ? error.code : 'inconnu',
  });
  return 'Ce changement n’a pas pu être enregistré. Réessaie dans un instant.';
}

async function run(form: FormData, gesture: (participantRaceId: string) => Promise<unknown>) {
  const participantRaceId = field(form, 'participantRaceId');
  await gesture(participantRaceId).catch((error: unknown) => {
    messageOf(error);
  });
  revalidatePath(pathOf(participantRaceId));
}

async function context(participantRaceId: string) {
  return bagsContext(await requireSession(pathOf(participantRaceId)));
}

/** Accepte une suggestion : le rôle et le point suffisent, le nom se déduit. */
export async function acceptSuggestionAction(form: FormData): Promise<void> {
  await run(form, async (participantRaceId) =>
    createBag(await context(participantRaceId), {
      participantRaceId,
      bagType: field(form, 'bagType'),
      pointId: field(form, 'pointId') === '' ? null : field(form, 'pointId'),
    }),
  );
}

export async function dismissSuggestionAction(form: FormData): Promise<void> {
  await run(form, async (participantRaceId) =>
    dismissBagSuggestion(await context(participantRaceId), {
      participantRaceId,
      key: field(form, 'key'),
    }),
  );
}

export async function restoreSuggestionsAction(form: FormData): Promise<void> {
  await run(form, async (participantRaceId) =>
    restoreBagSuggestions(await context(participantRaceId), { participantRaceId }),
  );
}

/** Un sac ajouté à la main : son rôle, son point s'il en faut un, son nom s'il est « autre ». */
export async function createBagAction(
  _previous: BagActionState,
  form: FormData,
): Promise<BagActionState> {
  const participantRaceId = field(form, 'participantRaceId');
  const bagType = field(form, 'bagType');
  const needsPoint = bagType === 'drop_bag' || bagType === 'assistance';
  const name = field(form, 'name').trim();

  try {
    await createBag(await context(participantRaceId), {
      participantRaceId,
      bagType,
      pointId: needsPoint && field(form, 'pointId') !== '' ? field(form, 'pointId') : null,
      ...(bagType === 'other' && name !== '' ? { name } : {}),
    });
  } catch (error) {
    return { error: messageOf(error) };
  }
  revalidatePath(pathOf(participantRaceId));
  return {};
}

export async function renameBagAction(
  _previous: BagActionState,
  form: FormData,
): Promise<BagActionState> {
  const participantRaceId = field(form, 'participantRaceId');
  try {
    await renameBag(await context(participantRaceId), {
      participantRaceId,
      bagId: field(form, 'bagId'),
      name: field(form, 'name'),
    });
  } catch (error) {
    return { error: messageOf(error) };
  }
  revalidatePath(pathOf(participantRaceId));
  return {};
}

export async function deleteBagAction(form: FormData): Promise<void> {
  await run(form, async (participantRaceId) =>
    deleteBag(await context(participantRaceId), {
      participantRaceId,
      bagId: field(form, 'bagId'),
    }),
  );
}

/** Un élément tapé, avec sa quantité. */
export async function addBagItemAction(
  _previous: BagActionState,
  form: FormData,
): Promise<BagActionState> {
  const participantRaceId = field(form, 'participantRaceId');
  const quantity = Number(field(form, 'quantity') || '1');
  try {
    await addBagItems(await context(participantRaceId), {
      participantRaceId,
      bagId: field(form, 'bagId'),
      labels: [field(form, 'label')],
      quantity: Number.isInteger(quantity) ? quantity : 1,
    });
  } catch (error) {
    return { error: messageOf(error) };
  }
  revalidatePath(pathOf(participantRaceId));
  return {};
}

/** Un ou plusieurs éléments repris de la checklist ou de « Mon matériel », d'un clic. */
export async function addBagPicksAction(form: FormData): Promise<void> {
  await run(form, async (participantRaceId) =>
    addBagItems(await context(participantRaceId), {
      participantRaceId,
      bagId: field(form, 'bagId'),
      labels: form.getAll('label').map(String),
    }),
  );
}

export async function setBagItemAction(form: FormData): Promise<void> {
  await run(form, async (participantRaceId) =>
    setBagItemChecked(await context(participantRaceId), {
      participantRaceId,
      bagId: field(form, 'bagId'),
      itemId: field(form, 'itemId'),
      checked: field(form, 'checked') === 'true',
    }),
  );
}

export async function removeBagItemAction(form: FormData): Promise<void> {
  await run(form, async (participantRaceId) =>
    removeBagItem(await context(participantRaceId), {
      participantRaceId,
      bagId: field(form, 'bagId'),
      itemId: field(form, 'itemId'),
    }),
  );
}
