'use client';

import type { StatusTransition, TransitionAuthority } from '@pluka/domain';
import { useActionState } from 'react';

import type { ActionState } from '@/app/actions';

const INITIAL: ActionState = {};

/**
 * Libellés d'autorité — 00_PRODUCT_SPEC §4.1, colonne « Autorisé ».
 *
 * Affichage seulement. La règle est portée par les tables du domaine et
 * appliquée par les use cases ; ce libellé dit à l'administrateur ce qu'il
 * faut être, il ne le vérifie pas.
 */
const AUTHORITY_LABEL: Readonly<Record<TransitionAuthority, string>> = {
  organization_editor: 'éditeur de l’organisation, ou pluka_admin',
  organization_admin: 'admin de l’organisation, ou pluka_admin',
  platform_admin: 'pluka_admin uniquement',
};

/**
 * Transitions de statut, pour les trois niveaux de la chaîne.
 *
 * Un seul composant parce qu'un seul geste : Event, Edition et Race
 * proposent la même liste de boutons, adossée à la même colonne « Autorisé »
 * de §4.1. Ce qui change d'un niveau à l'autre — l'action appelée, le nom du
 * champ qui porte l'identifiant — est passé en props.
 *
 * L'écran ne connaît aucune transition de son côté : elles viennent des tables
 * pures du domaine (`allowedEventTransitions`, `allowedEditionTransitions`,
 * `allowedRaceTransitions`), et il ne peut donc pas en inventer une. Il
 * n'autorise rien non plus : le use case refuse si l'acteur n'a pas
 * l'autorité annoncée.
 */
export function StatusPanel({
  action,
  idField,
  id,
  status,
  transitions,
  subject,
}: {
  readonly action: (previous: ActionState, form: FormData) => Promise<ActionState>;
  /** Nom du champ qui porte l'identifiant — `eventId`, `editionId`, `raceId`. */
  readonly idField: string;
  readonly id: string;
  readonly status: string;
  readonly transitions: readonly StatusTransition<string>[];
  /** Nommé dans la phrase d'absence de transition : « cet événement », etc. */
  readonly subject: string;
}) {
  const [state, submit, pending] = useActionState(action, INITIAL);

  if (transitions.length === 0) {
    return (
      <p className="pk-body" style={{ color: 'var(--pk-text-muted)' }}>
        Aucune transition possible pour {subject} depuis <strong>{status}</strong>.
      </p>
    );
  }

  return (
    <>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {transitions.map((transition) => (
          <li
            key={transition.to}
            style={{
              display: 'flex',
              gap: 'var(--space-4)',
              alignItems: 'center',
              padding: 'var(--space-3) 0',
              borderTop: '1px solid var(--pk-hairline)',
            }}
          >
            <form action={submit}>
              <input type="hidden" name={idField} value={id} />
              <input type="hidden" name="status" value={transition.to} />
              <button
                type="submit"
                className="pk-btn pk-button-secondary"
                disabled={pending}
                style={{ minHeight: '44px' }}
              >
                Passer en {transition.to}
              </button>
            </form>

            <span className="pk-label">{AUTHORITY_LABEL[transition.authority]}</span>
          </li>
        ))}
      </ul>

      {state.error === undefined ? null : (
        <p className="pk-field-error" role="alert" style={{ marginTop: 'var(--space-4)' }}>
          {state.error}
        </p>
      )}
    </>
  );
}
