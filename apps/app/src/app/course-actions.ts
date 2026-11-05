'use server';

import {
  DomainError,
  decideFactCandidate,
  publishFactCandidate,
  restoreRaceFact,
  retireRaceFact,
  reviseRaceFact,
} from '@pluka/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { factEditingContext, factReviewContext } from '@/lib/organizer-course';
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

function pagePath(form: FormData): string {
  const organizationId = text(form, 'organizationId');
  if (!UUID.test(organizationId)) return '/org';

  const base = `/org/${organizationId}/course/informations`;
  // La sélection de l'écran revient telle quelle : des slugs et une année, pas une adresse.
  const search = text(form, 'selection');
  return SEARCH.test(search) && search !== '' ? `${base}?${search}` : base;
}

function done(form: FormData, notice: string): never {
  const path = pagePath(form);
  revalidatePath(`/org/${text(form, 'organizationId')}/course/informations`);
  redirect(`${path}${path.includes('?') ? '&' : '?'}fait=${notice}`);
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

  done(form, 'retiree');
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

  done(form, 'restauree');
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
