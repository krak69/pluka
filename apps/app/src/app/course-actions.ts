'use server';

import {
  DomainError,
  addEditionDocuments,
  addRaceEquipment,
  addEditionFile,
  changeEditionStatus,
  changeRaceStatus,
  civilToInstant,
  decideFactCandidate,
  duplicateEdition,
  getRaceOverview,
  importRaceGpx,
  publishRace,
  publishFactCandidate,
  restoreRaceFact,
  reviseRaceEquipment,
  setRaceWaypoints,
  retireRaceFact,
  reviseRaceFact,
  updateRace,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { sessionEventSiteContext } from '@/lib/event-site-editing';
import {
  courseContext,
  courseDocumentsContext,
  factEditingContext,
  factReviewContext,
  gpxImportContext,
} from '@/lib/organizer-course';
import { requireSession } from '@/lib/session';

/**
 * Ma course · Informations — 00_PRODUCT_SPEC §28.1.
 *
 * Ces actions transmettent une intention. La base lit l'acteur dans le jeton,
 * revérifie son autorité sur la course et journalise (0012, 0043). Une
 * organisation publie au niveau « Officielle » : c'est son information.
 */

export interface CourseActionState {
  readonly error?: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEARCH = /^[a-z0-9=&-]*$/iu;

function text(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === 'string' ? value : '';
}

function pagePath(form: FormData, screen = 'informations'): string {
  const organizationId = text(form, 'organizationId');
  if (!UUID.test(organizationId)) return '/org';

  const base = `/org/${organizationId}/course/${screen}`;
  // La sélection de l'écran revient telle quelle : des slugs et une année, pas une adresse.
  const search = text(form, 'selection');
  return SEARCH.test(search) && search !== '' ? `${base}?${search}` : base;
}

function done(form: FormData, notice: string, screen = 'informations'): never {
  const path = pagePath(form, screen);
  revalidatePath(`/org/${text(form, 'organizationId')}/course/${screen}`);
  redirect(`${path}${path.includes('?') ? '&' : '?'}fait=${notice}`);
}

/** L'écran du geste : une valeur connue, jamais une adresse postée. */
function screenOf(form: FormData): string {
  return text(form, 'screen') === 'epreuves' ? 'epreuves' : 'informations';
}

function texts(form: FormData, field: string): string[] {
  return form.getAll(field).map((value) => (typeof value === 'string' ? value : ''));
}

function failure(error: unknown): CourseActionState {
  if (error instanceof DomainError) {
    if (error.code === 'forbidden') {
      return { error: 'Votre rôle permet de voir ces informations, pas de les modifier.' };
    }
    if (error.code === 'validation' && Object.keys(error.details).length > 0) {
      return { error: 'À corriger.', fieldErrors: error.details as Record<string, string> };
    }
    if (error.details['reason'] === 'FACT_SOURCE_MISSING') {
      return { error: 'Cette information n’a pas de source : elle ne peut pas être publiée.' };
    }

    const message = error.message.replace(/^\[[^\]]+\]\s*\w+\s*:\s*/u, '');
    return { error: message.charAt(0).toUpperCase() + message.slice(1) + '.' };
  }

  console.error('ma course : erreur non traduite', {
    name: error instanceof Error ? error.name : 'inconnu',
  });
  return { error: 'Une erreur est survenue. Réessayez dans un instant.' };
}

export async function reviseFactAction(
  _previous: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  const rawNumber = text(form, 'valueNumber').trim();

  // Publier fait passer l'information au niveau « Officielle » : une valeur
  // inchangée ne doit pas le faire en silence. Ce n'est pas une correction.
  if (
    text(form, 'valueText').trim() === text(form, 'originalText').trim() &&
    rawNumber === text(form, 'originalNumber').trim() &&
    text(form, 'unit').trim() === text(form, 'originalUnit').trim()
  ) {
    const message = 'La valeur est identique à celle publiée.';
    return {
      error: message,
      fieldErrors: { valueText: message, valueNumber: message },
    };
  }

  try {
    await reviseRaceFact(factEditingContext(await requireSession(pagePath(form))), {
      factId: text(form, 'factId'),
      valueText: text(form, 'valueText'),
      valueNumber: rawNumber === '' ? null : Number(rawNumber.replace(',', '.')),
      unit: text(form, 'unit'),
      trustLevel: 'official',
      note: null,
    });
  } catch (error) {
    return failure(error);
  }

  done(form, 'corrigee');
}

export async function retireFactAction(
  _previous: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  try {
    await retireRaceFact(factEditingContext(await requireSession(pagePath(form))), {
      factId: text(form, 'factId'),
      note: null,
    });
  } catch (error) {
    return failure(error);
  }

  done(form, 'retiree', screenOf(form));
}

export async function restoreFactAction(
  _previous: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  try {
    await restoreRaceFact(factEditingContext(await requireSession(pagePath(form))), {
      factId: text(form, 'factId'),
      note: null,
    });
  } catch (error) {
    return failure(error);
  }

  done(form, 'restauree', screenOf(form));
}

export async function publishCandidateAction(
  _previous: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  try {
    await publishFactCandidate(factReviewContext(await requireSession(pagePath(form))), {
      candidateId: text(form, 'candidateId'),
      trustLevel: 'official',
      // Le bouton qui remplace une valeur le dit : PLUKA ne choisit pas à sa place.
      resolveConflict: text(form, 'resolveConflict') === 'true',
    });
  } catch (error) {
    return failure(error);
  }

  done(form, 'publiee');
}

export async function rejectCandidateAction(
  _previous: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  try {
    await decideFactCandidate(factReviewContext(await requireSession(pagePath(form))), {
      candidateId: text(form, 'candidateId'),
      decision: 'reject',
    });
  } catch (error) {
    return failure(error);
  }

  done(form, 'ecartee');
}

/** Un fichier passe par l'action : au-delà, il faudrait un dépôt direct depuis le navigateur. */
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export async function addDocumentFileAction(
  _previous: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choisissez un fichier PDF.' };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { error: 'Ce fichier dépasse 25 Mo.' };
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    await addEditionFile(courseDocumentsContext(await requireSession(pagePath(form, 'sources'))), {
      editionId: text(form, 'editionId'),
      fileName: file.name,
      bytes,
      contentHash: [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
      raceId: text(form, 'raceId') === '' ? null : text(form, 'raceId'),
    });
  } catch (error) {
    const result = failure(error);
    return result.fieldErrors?.['file'] === undefined
      ? result
      : { error: result.fieldErrors['file'] };
  }

  done(form, 'document', 'sources');
}

export async function addDocumentLinkAction(
  _previous: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  const url = text(form, 'url').trim();
  if (url === '') return { error: 'Collez l’adresse de la page.' };

  let created;
  try {
    ({ created } = await addEditionDocuments(
      courseDocumentsContext(await requireSession(pagePath(form, 'sources'))),
      {
        editionId: text(form, 'editionId'),
        documents: [
          {
            url,
            title: url,
            kind: /\.pdf(?:[?#].*)?$/iu.test(url) ? 'pdf' : 'page',
            raceId: text(form, 'raceId') === '' ? null : text(form, 'raceId'),
          },
        ],
      },
    ));
  } catch (error) {
    const result = failure(error);
    return result.fieldErrors === undefined
      ? result
      : { error: 'Cette adresse n’est pas valide. Elle doit commencer par https://.' };
  }

  done(form, created === 0 ? 'deja-ajoute' : 'document', 'sources');
}

export async function updateRaceAction(
  _previous: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  const distance = Number(text(form, 'distanceKm').replace(',', '.'));
  const gain = text(form, 'elevationGainM').trim();
  const location = text(form, 'startLocationName').trim();
  const day = text(form, 'day');
  const time = text(form, 'time');

  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day) || !/^\d{2}:\d{2}$/u.test(time)) {
    return { error: 'Indiquez le jour et l’heure du départ.' };
  }
  if (!Number.isFinite(distance) || distance <= 0) {
    return { error: 'La distance doit être un nombre positif.' };
  }
  if (gain !== '' && !/^\d+$/u.test(gain)) {
    return { error: 'Le dénivelé doit être un nombre entier de mètres.' };
  }

  try {
    await updateRace(courseContext(await requireSession(pagePath(form, 'epreuves'))), {
      raceId: text(form, 'raceId'),
      name: text(form, 'name'),
      distanceKm: distance,
      elevationGainM: gain === '' ? null : Number(gain),
      startDatetime: civilToInstant(day, time, text(form, 'timezone')),
      startLocationName: location === '' ? null : location,
    });
  } catch (error) {
    return failure(error);
  }

  done(form, 'epreuve-modifiee', 'epreuves');
}

export async function publishRaceAction(
  _previous: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  try {
    await publishRace(courseContext(await requireSession(pagePath(form, 'epreuves'))), {
      raceId: text(form, 'raceId'),
    });
  } catch (error) {
    return failure(error);
  }

  done(form, 'epreuve-publiee', 'epreuves');
}

export async function publishEditionAction(
  _previous: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  try {
    await changeEditionStatus(courseContext(await requireSession(pagePath(form, 'epreuves'))), {
      editionId: text(form, 'editionId'),
      status: 'published',
    });
  } catch (error) {
    return failure(error);
  }

  done(form, 'edition-publiee', 'epreuves');
}

export async function duplicateEditionAction(
  _previous: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  const year = text(form, 'year').trim();

  try {
    await duplicateEdition(sessionEventSiteContext(await requireSession(pagePath(form, 'epreuves'))), {
      organizationId: text(form, 'organizationId'),
      eventId: text(form, 'eventId'),
      sourceEditionId: text(form, 'sourceEditionId'),
      year,
      startDate: text(form, 'startDate'),
      endDate: text(form, 'endDate'),
    });
  } catch (error) {
    return failure(error);
  }

  // On arrive sur la nouvelle édition : c'est elle qui est à relire.
  form.set('selection', `evenement=${text(form, 'eventSlug')}&edition=${year}`);
  done(form, 'edition-creee', 'epreuves');
}

/** Un fichier passe par l'action : même limite que les documents. */
const MAX_GPX_BYTES = 25 * 1024 * 1024;

export async function importGpxAction(
  _previous: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  const file = form.get('gpx');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choisissez un fichier GPX.' };
  if (file.size > MAX_GPX_BYTES) return { error: 'Ce fichier dépasse 25 Mo.' };

  try {
    const content = await file.text();
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(content),
    );
    await importRaceGpx(gpxImportContext(await requireSession(pagePath(form, 'epreuves'))), {
      raceId: text(form, 'raceId'),
      fileName: file.name,
      content,
      contentHash: [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
    });
  } catch (error) {
    const result = failure(error);
    return result.fieldErrors === undefined
      ? result
      : { error: 'Ce fichier n’est pas un GPX lisible.' };
  }

  done(form, 'trace-ajoutee', 'epreuves');
}

export async function saveWaypointsAction(
  _previous: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  const ids = texts(form, 'waypointId');
  const types = texts(form, 'waypointType');
  const distances = texts(form, 'distanceKm');
  const cutoffs = texts(form, 'cutoffAt');
  const raceId = text(form, 'raceId');

  try {
    const context = courseContext(await requireSession(pagePath(form, 'epreuves')));
    // Le fuseau qui fait foi est celui de l'épreuve en base, pas une valeur postée.
    const { race } = await getRaceOverview(context, { raceId });

    await setRaceWaypoints(context, {
      raceId,
      waypoints: texts(form, 'name').map((name, index) => {
        const [day, time] = (cutoffs[index] ?? '').split('T');
        const distance = Number((distances[index] ?? '').replace(',', '.'));
        return {
          ...(ids[index] === undefined || ids[index] === '' ? {} : { id: ids[index] }),
          name,
          waypointType: types[index],
          distanceKm: (distances[index] ?? '').trim() === '' ? undefined : distance,
          cutoffAt:
            day === undefined || day === '' || time === undefined
              ? null
              : civilToInstant(day, time, race.timezone),
        };
      }),
    });
  } catch (error) {
    const result = failure(error);
    const whole = result.fieldErrors?.['waypoints'];
    return whole === undefined ? result : { ...result, error: whole };
  }

  done(form, 'points-enregistres', 'epreuves');
}

function equipmentFields(form: FormData) {
  return {
    label: text(form, 'label'),
    requirement: text(form, 'requirement'),
    condition: text(form, 'condition'),
    detail: text(form, 'detail'),
    trustLevel: 'official',
    note: null,
  };
}

export async function addEquipmentAction(
  _previous: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  try {
    await addRaceEquipment(factEditingContext(await requireSession(pagePath(form, 'epreuves'))), {
      raceIds: [text(form, 'raceId')],
      ...equipmentFields(form),
    });
  } catch (error) {
    return failure(error);
  }

  done(form, 'materiel-ajoute', 'epreuves');
}

export async function reviseEquipmentAction(
  _previous: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  try {
    await reviseRaceEquipment(factEditingContext(await requireSession(pagePath(form, 'epreuves'))), {
      factId: text(form, 'factId'),
      ...equipmentFields(form),
    });
  } catch (error) {
    return failure(error);
  }

  done(form, 'materiel-corrige', 'epreuves');
}

/** Annuler demande le rang `admin` : `changeRaceStatus` le sait seul (§4.1). */
export async function cancelRaceAction(
  _previous: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  try {
    await changeRaceStatus(courseContext(await requireSession(pagePath(form, 'epreuves'))), {
      raceId: text(form, 'raceId'),
      status: 'cancelled',
    });
  } catch (error) {
    return error instanceof DomainError && error.code === 'forbidden'
      ? { error: 'Seuls un propriétaire ou un administrateur annulent une épreuve.' }
      : failure(error);
  }

  done(form, 'epreuve-annulee', 'epreuves');
}
