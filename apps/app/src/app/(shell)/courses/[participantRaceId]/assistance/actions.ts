'use server';

import {
  addAssistant,
  addRendezvous,
  addRendezvousItems,
  createAssistantLink,
  DomainError,
  EntitlementError,
  removeAssistant,
  removeRendezvous,
  removeRendezvousItem,
  revokeAssistantLink,
  setAssistanceStatus,
  setRendezvousInstructions,
  updateAssistant,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';

import type { ActionState } from '@/app/actions';
import { assistanceContext } from '@/lib/assistance';
import { publicEnv } from '@/lib/env';
import { requireSession } from '@/lib/session';

/**
 * Gestes de l'écran Assistance. Le client n'envoie que des identifiants et
 * l'intention : le droit (choix gratuit, le reste au Race Pass), la propriété
 * et le point autorisé se décident dans le domaine, puis dans la base (0005,
 * 0098).
 */

function field(form: FormData, name: string): string {
  return String(form.get(name) ?? '');
}

function pathOf(participantRaceId: string): string {
  return `/courses/${participantRaceId}/assistance`;
}

/** Le motif d'un refus, dit au coureur ; le détail technique reste dans les journaux. */
function messageOf(error: unknown, invalid: string): string {
  if (error instanceof EntitlementError) {
    return 'Tes accompagnants et leurs rendez-vous font partie de la préparation complète, avec le Race Pass.';
  }
  if (error instanceof DomainError && error.code === 'validation') return invalid;
  console.error('assistance : geste refusé', {
    code: error instanceof DomainError ? error.code : 'inconnu',
  });
  return 'Ce changement n’a pas pu être enregistré. Réessaie dans un instant.';
}

async function run(
  form: FormData,
  invalid: string,
  gesture: (
    context: ReturnType<typeof assistanceContext>,
    participantRaceId: string,
  ) => Promise<unknown>,
): Promise<ActionState> {
  const participantRaceId = field(form, 'participantRaceId');
  const session = await requireSession(pathOf(participantRaceId));

  try {
    await gesture(assistanceContext(session), participantRaceId);
  } catch (error) {
    return { error: messageOf(error, invalid) };
  }

  revalidatePath(pathOf(participantRaceId));
  return {};
}

export async function setStatusAction(_previous: ActionState, form: FormData) {
  return run(form, 'Choix inconnu.', (context, participantRaceId) =>
    setAssistanceStatus(context, { participantRaceId, status: field(form, 'status') }),
  );
}

const PERSON_INVALID =
  'Indique au moins un prénom, et un numéro de téléphone valide si tu en mets un.';

export async function addAssistantAction(_previous: ActionState, form: FormData) {
  return run(form, PERSON_INVALID, (context, participantRaceId) =>
    addAssistant(context, {
      participantRaceId,
      firstName: field(form, 'firstName'),
      lastName: field(form, 'lastName'),
      phone: field(form, 'phone'),
    }),
  );
}

export async function updateAssistantAction(_previous: ActionState, form: FormData) {
  return run(form, PERSON_INVALID, (context, participantRaceId) =>
    updateAssistant(context, {
      participantRaceId,
      assistantId: field(form, 'assistantId'),
      firstName: field(form, 'firstName'),
      lastName: field(form, 'lastName'),
      phone: field(form, 'phone'),
    }),
  );
}

export async function removeAssistantAction(_previous: ActionState, form: FormData) {
  return run(form, 'Personne introuvable.', (context, participantRaceId) =>
    removeAssistant(context, { participantRaceId, assistantId: field(form, 'assistantId') }),
  );
}

export async function addRendezvousAction(_previous: ActionState, form: FormData) {
  return run(
    form,
    'Choisis un point où l’organisation autorise l’assistance.',
    (context, participantRaceId) =>
      addRendezvous(context, {
        participantRaceId,
        assistantId: field(form, 'assistantId'),
        pointId: field(form, 'pointId'),
      }),
  );
}

export async function removeRendezvousAction(_previous: ActionState, form: FormData) {
  return run(form, 'Rendez-vous introuvable.', (context, participantRaceId) =>
    removeRendezvous(context, { participantRaceId, rendezvousId: field(form, 'rendezvousId') }),
  );
}

export async function setInstructionsAction(_previous: ActionState, form: FormData) {
  return run(
    form,
    'Consignes trop longues : 1000 caractères au plus.',
    (context, participantRaceId) =>
      setRendezvousInstructions(context, {
        participantRaceId,
        rendezvousId: field(form, 'rendezvousId'),
        instructions: field(form, 'instructions'),
      }),
  );
}

export async function addItemAction(_previous: ActionState, form: FormData) {
  return run(
    form,
    'Écris ce qu’il faut te donner : 120 caractères au plus.',
    (context, participantRaceId) =>
      addRendezvousItems(context, {
        participantRaceId,
        rendezvousId: field(form, 'rendezvousId'),
        labels: [field(form, 'label')],
      }),
  );
}

export async function removeItemAction(_previous: ActionState, form: FormData) {
  return run(form, 'Élément introuvable.', (context, participantRaceId) =>
    removeRendezvousItem(context, { participantRaceId, itemId: field(form, 'itemId') }),
  );
}

export interface LinkActionState {
  readonly error?: string;
  /** Le lien en clair, montré une seule fois après sa création. */
  readonly link?: string;
}

/**
 * Crée (ou régénère) le lien privé d'une personne. Le jeton en clair ne
 * revient qu'ici, une fois : la base n'en garde que l'empreinte (0100).
 */
export async function createLinkAction(
  _previous: LinkActionState,
  form: FormData,
): Promise<LinkActionState> {
  const participantRaceId = field(form, 'participantRaceId');
  const session = await requireSession(pathOf(participantRaceId));

  try {
    const { token } = await createAssistantLink(assistanceContext(session), {
      participantRaceId,
      assistantId: field(form, 'assistantId'),
    });
    revalidatePath(pathOf(participantRaceId));
    return { link: new URL(`/a/${token}`, publicEnv().NEXT_PUBLIC_APP_URL).toString() };
  } catch (error) {
    if (error instanceof EntitlementError) {
      return { error: 'Le lien privé pour tes accompagnants fait partie du Race Pass.' };
    }
    return { error: messageOf(error, 'Personne introuvable.') };
  }
}

export async function revokeLinkAction(_previous: ActionState, form: FormData) {
  return run(form, 'Personne introuvable.', (context, participantRaceId) =>
    revokeAssistantLink(context, { participantRaceId, assistantId: field(form, 'assistantId') }),
  );
}
