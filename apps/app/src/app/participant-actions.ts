'use server';

import {
  DomainError,
  commitParticipantImport,
  createParticipantImport,
  discardParticipantImport,
  getOrganizerCourse,
  validateParticipantImport,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { sessionEventSiteContext } from '@/lib/event-site-editing';
import { participantImportContext } from '@/lib/organizer-course';
import { requireSession } from '@/lib/session';

/**
 * Participants · Import — 00_PRODUCT_SPEC §29.1. Une intention, et la base qui
 * revérifie le rôle à chaque geste (0060). Aucune donnée de participant dans les
 * journaux : seul le nom de l'erreur y va (AGENTS §62).
 */

export interface ParticipantActionState {
  readonly error?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEARCH = /^[a-z0-9=&-]*$/iu;

function text(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === 'string' ? value : '';
}

function pagePath(form: FormData): string {
  const organizationId = text(form, 'organizationId');
  return UUID.test(organizationId) ? `/org/${organizationId}/participants` : '/org';
}

function selectionOf(form: FormData): string {
  const selection = text(form, 'selection');
  return SEARCH.test(selection) ? selection : '';
}

function failure(error: unknown): ParticipantActionState {
  if (error instanceof DomainError) {
    if (error.code === 'forbidden') {
      return { error: 'Seuls un propriétaire ou un administrateur importent des participants.' };
    }
    if (error.code === 'validation') {
      const detail = Object.values(error.details)[0];
      if (typeof detail === 'string') return { error: detail };
    }
    if (error.code === 'invalid_state') return { error: 'Cet import est déjà terminé.' };
    if (error.code === 'not_found') return { error: 'Cet import n’existe plus.' };
  }

  console.error('participants : erreur non traduite', {
    name: error instanceof Error ? error.name : 'inconnu',
  });
  return { error: 'Une erreur est survenue. Réessayez dans un instant.' };
}

export async function createImportAction(
  _previous: ParticipantActionState,
  form: FormData,
): Promise<ParticipantActionState> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choisissez un fichier.' };

  let importId: string;
  try {
    const session = await requireSession(pagePath(form));
    ({ importId } = await createParticipantImport(participantImportContext(session), {
      editionId: text(form, 'editionId'),
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    }));
  } catch (error) {
    return failure(error);
  }

  const selection = selectionOf(form);
  redirect(`${pagePath(form)}?${selection === '' ? '' : `${selection}&`}import=${importId}`);
}

export async function validateImportAction(
  _previous: ParticipantActionState,
  form: FormData,
): Promise<ParticipantActionState> {
  const organizationId = text(form, 'organizationId');
  const importId = text(form, 'importId');
  const columns = Object.fromEntries(
    [...form.entries()].flatMap(([key, value]) =>
      key.startsWith('column.') && typeof value === 'string' && value !== ''
        ? [[key.slice('column.'.length), value]]
        : [],
    ),
  );

  try {
    const session = await requireSession(pagePath(form));
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
    const eventSlug = text(form, 'eventSlug');
    // Les épreuves viennent de la base : un formulaire ne désigne pas celles d'une autre édition.
    const course = await getOrganizerCourse(sessionEventSiteContext(session), {
      organizationId,
      today,
      ...(eventSlug === '' ? {} : { eventSlug }),
      year: Number(text(form, 'year')),
    });
    await validateParticipantImport(participantImportContext(session), {
      importId,
      columns,
      races: course.races.map((race) => ({ id: race.id, name: race.name, slug: race.slug })),
    });
  } catch (error) {
    return failure(error);
  }

  revalidatePath(pagePath(form));
  return {};
}

export async function commitImportAction(
  _previous: ParticipantActionState,
  form: FormData,
): Promise<ParticipantActionState> {
  let result: { created: number; skipped: number };
  try {
    result = await commitParticipantImport(
      participantImportContext(await requireSession(pagePath(form))),
      { importId: text(form, 'importId') },
    );
  } catch (error) {
    return failure(error);
  }

  revalidatePath(pagePath(form));
  const selection = selectionOf(form);
  redirect(
    `${pagePath(form)}?${selection === '' ? '' : `${selection}&`}importes=${String(result.created)}&ignores=${String(result.skipped)}`,
  );
}

export async function discardImportAction(
  _previous: ParticipantActionState,
  form: FormData,
): Promise<ParticipantActionState> {
  try {
    await discardParticipantImport(
      participantImportContext(await requireSession(pagePath(form))),
      { importId: text(form, 'importId') },
    );
  } catch (error) {
    return failure(error);
  }

  const selection = selectionOf(form);
  redirect(`${pagePath(form)}${selection === '' ? '' : `?${selection}`}`);
}
