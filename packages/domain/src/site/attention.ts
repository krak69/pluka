import type { EventSiteEditor } from './editing.js';

/**
 * L'accueil organisateur — 00_PRODUCT_SPEC §26, 06_DESIGN_SYSTEM §125.
 *
 * « Qu'est-ce qui mérite mon attention aujourd'hui ? » Trois ou quatre sujets au
 * plus, classés À faire, À vérifier, À savoir, et jamais une alerte par
 * observation : les manques du site tiennent en un seul sujet.
 *
 * Seul ce que PLUKA connaît déjà s'y trouve. Les sujets de §26.1 qui demandent
 * l'analyse du peloton ou les questions des participants arriveront avec eux.
 */

export type SiteEditorTab = 'identite' | 'presentation' | 'infos' | 'galerie' | 'liens' | 'contact';

export interface EventSiteChecklistItem {
  readonly tab: SiteEditorTab;
  readonly label: string;
  readonly done: boolean;
}

/** Ce qui fait un site complet. Rien ici n'empêche de le mettre en ligne. */
export function eventSiteChecklist(editor: EventSiteEditor): readonly EventSiteChecklistItem[] {
  const { site, sections, gallery, edition } = editor;

  return [
    { tab: 'identite', label: 'Logo', done: site?.logoPath != null },
    { tab: 'identite', label: 'Couverture', done: site?.coverPath != null },
    { tab: 'presentation', label: 'Présentation', done: site?.presentation != null },
    { tab: 'infos', label: 'Infos pratiques', done: sections.length > 0 },
    { tab: 'galerie', label: 'Photos', done: gallery.length > 0 },
    { tab: 'liens', label: 'Lien d’inscription', done: edition?.registrationUrl != null },
    { tab: 'contact', label: 'Adresse de contact', done: site?.contactEmail != null },
  ];
}

export type AttentionKind = 'todo' | 'check' | 'know';

export type AttentionTarget =
  | { readonly screen: 'site'; readonly tab: SiteEditorTab }
  | { readonly screen: 'team' }
  | { readonly screen: 'live' };

export interface AttentionItem {
  readonly key: string;
  readonly kind: AttentionKind;
  readonly title: string;
  readonly text: string;
  /** Nul : l'organisation n'a pas de geste à faire ici. */
  readonly action: { readonly label: string; readonly target: AttentionTarget } | null;
}

export interface TeamInvitationsSummary {
  readonly failed: number;
  readonly expired: number;
}

export const MAX_ATTENTION_ITEMS = 4;

const KIND_ORDER: readonly AttentionKind[] = ['todo', 'check', 'know'];

const BLOCKER_TEXT = {
  event_not_published: {
    title: 'L’événement n’est pas publié',
    text: 'Le site restera hors ligne tant qu’il ne l’est pas. La publication se fait avec PLUKA.',
  },
  slug_not_subdomain: {
    title: 'L’adresse du site n’est pas utilisable',
    text: 'L’adresse courte de l’événement ne peut pas servir d’adresse de site. Demandez à PLUKA de la changer.',
  },
  no_public_race: {
    title: 'Aucune épreuve publique',
    text: 'Le site ne montrera aucune épreuve tant qu’aucune n’est publiée.',
  },
} as const;

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

function editionItem(edition: NonNullable<EventSiteEditor['edition']>, today: string): AttentionItem {
  const label = `L’édition ${String(edition.year)}`;
  const days = daysBetween(today, edition.startDate);

  if (days < 0 && (edition.endDate ?? edition.startDate) < today) {
    return {
      key: 'edition',
      kind: 'know',
      title: `${label} est passée`,
      text: 'Le site continue de la montrer tant qu’aucune nouvelle édition n’est publiée.',
      action: null,
    };
  }

  const when =
    days <= 0 ? 'C’est aujourd’hui' : days === 1 ? 'C’est demain' : `Dans ${String(days)} jours`;
  return { key: 'edition', kind: 'know', title: `${label} approche`, text: `${when}.`, action: null };
}

/** Pur : `today` est passé par l'appelant, en date civile (AGENTS §35). */
export function organizerAttention(
  editor: EventSiteEditor,
  invitations: TeamInvitationsSummary | null,
  today: string,
): readonly AttentionItem[] {
  const { event, site, permissions, edition, blockers } = editor;
  if (event === null) return [];

  const items: AttentionItem[] = [];
  const isLive = site?.status === 'published' && blockers.length === 0;

  if (site?.status === 'suspended') {
    items.push({
      key: 'suspended',
      kind: 'check',
      title: 'Votre site est suspendu par PLUKA',
      text: 'Il ne répond plus. Contactez PLUKA pour en savoir plus.',
      action: null,
    });
  } else if (blockers[0] !== undefined) {
    items.push({
      key: 'blocker',
      kind: 'check',
      ...BLOCKER_TEXT[blockers[0]],
      action: null,
    });
  }

  const missing = eventSiteChecklist(editor).filter((item) => !item.done);
  if (permissions.canEdit && missing[0] !== undefined) {
    items.push({
      key: 'complete',
      kind: 'todo',
      title: 'Complétez votre site',
      text: `Il manque : ${missing.map((item) => item.label.toLowerCase()).join(', ')}.`,
      action: { label: 'Compléter', target: { screen: 'site', tab: missing[0].tab } },
    });
  }

  if (permissions.canPublish && !isLive && blockers.length === 0 && site?.status !== 'suspended') {
    items.push({
      key: 'publish',
      kind: 'todo',
      title: 'Votre site n’est pas en ligne',
      text: 'Son adresse ne répond pas encore : personne ne peut le voir.',
      action: { label: 'Ouvrir le site', target: { screen: 'site', tab: 'identite' } },
    });
  }

  if (invitations !== null && invitations.failed + invitations.expired > 0) {
    const count = invitations.failed + invitations.expired;
    items.push({
      key: 'invitations',
      kind: 'check',
      title: count === 1 ? 'Une invitation n’a pas abouti' : `${String(count)} invitations n’ont pas abouti`,
      text: 'L’e-mail n’est pas parti, ou le lien a expiré. Renvoyez-la depuis l’équipe.',
      action: { label: 'Voir l’équipe', target: { screen: 'team' } },
    });
  }

  if (isLive) {
    items.push({
      key: 'live',
      kind: 'know',
      title: 'Votre site est en ligne',
      text: 'Coureurs et accompagnants y trouvent vos informations.',
      action: { label: 'Voir le site', target: { screen: 'live' } },
    });
  }

  if (edition !== null) items.push(editionItem(edition, today));

  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        KIND_ORDER.indexOf(left.item.kind) - KIND_ORDER.indexOf(right.item.kind) ||
        left.index - right.index,
    )
    .map(({ item }) => item)
    .slice(0, MAX_ATTENTION_ITEMS);
}
