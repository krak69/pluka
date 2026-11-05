import {
  createCourseRepositories,
  createEventDiscoveryRepositories,
  createFactEditingRepositories,
  createFactRepositories,
  createGpxRepositories,
  participantImportRepository,
} from '@pluka/db';
import type {
  CourseContext,
  EventDiscoveryContext,
  FactEditingContext,
  FactReviewContext,
  GpxImportContext,
  ParticipantImportContext,
} from '@pluka/domain';

import type { Session } from '@/lib/session';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Ma course — 00_PRODUCT_SPEC §28. Tout passe sous la session du membre :
 * l'autorité, le journal et le signal d'impact sont en base (0012, 0043).
 */
export function factEditingContext(session: Session): FactEditingContext {
  return {
    repositories: createFactEditingRepositories({ client: createDataClient(session.accessToken) }),
    actor: { userId: session.userId },
  };
}

export function factReviewContext(session: Session): FactReviewContext {
  return {
    repositories: createFactRepositories({ client: createDataClient(session.accessToken) }),
    actor: { userId: session.userId },
  };
}

export function courseContext(session: Session): CourseContext {
  return {
    repositories: createCourseRepositories({ client: createDataClient(session.accessToken) }),
    actor: { userId: session.userId },
  };
}

export function gpxImportContext(session: Session): GpxImportContext {
  return {
    repositories: createGpxRepositories({ client: createDataClient(session.accessToken) }),
    actor: { userId: session.userId },
  };
}

export function participantImportContext(session: Session): ParticipantImportContext {
  return {
    repositories: {
      participantImports: participantImportRepository({
        client: createDataClient(session.accessToken),
      }),
    },
  };
}

export function courseDocumentsContext(session: Session): EventDiscoveryContext {
  return {
    repositories: createEventDiscoveryRepositories({
      client: createDataClient(session.accessToken),
    }),
    actor: { userId: session.userId },
  };
}

export interface CourseSelection {
  readonly event?: string | undefined;
  readonly year?: number | undefined;
  readonly race?: string | undefined;
}

/** L'adresse d'un écran : l'édition choisie se partage par lien (05_ROUTES §12.1). */
export function courseHref(
  organizationId: string,
  screen: string,
  selection: CourseSelection,
  section: 'course' | 'participants' = 'course',
): string {
  const query = new URLSearchParams();
  if (selection.event !== undefined) query.set('evenement', selection.event);
  if (selection.year !== undefined) query.set('edition', String(selection.year));
  if (selection.race !== undefined) query.set('epreuve', selection.race);

  const search = query.toString();
  const path =
    section === 'course' ? `/org/${organizationId}/course/${screen}` : `/org/${organizationId}/participants`;
  return `${path}${search === '' ? '' : `?${search}`}`;
}

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  general: 'Général',
  start: 'Départ',
  bib: 'Dossard',
  course: 'Parcours',
  gpx: 'Trace GPX',
  aid: 'Ravitaillement',
  cutoff: 'Barrières horaires',
  equipment: 'Matériel',
  assistance: 'Assistance',
  bag: 'Sacs',
  transport: 'Transport',
  safety: 'Sécurité',
  withdrawal: 'Abandon',
  rules: 'Règlement',
  contact: 'Contact',
  weather: 'Météo',
  other: 'Autres informations',
};

export function factCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

/** Une valeur d'information, telle qu'on la lit : texte, puis nombre et unité. */
export function factValue(fact: {
  readonly valueText: string | null;
  readonly valueNumber: number | null;
  readonly unit: string | null;
}): string {
  const number =
    fact.valueNumber === null
      ? null
      : `${fact.valueNumber.toLocaleString('fr-FR')}${fact.unit === null ? '' : ` ${fact.unit}`}`;
  return [fact.valueText, number].filter((part) => part !== null).join(' · ') || '—';
}
