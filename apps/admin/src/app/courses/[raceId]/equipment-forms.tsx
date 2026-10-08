'use client';

import type { RaceEquipmentItem } from '@pluka/domain';
import { Input } from '@pluka/ui';
import { useActionState, useId, useState } from 'react';

import type { ActionState } from '@/app/actions';
import { addEquipmentAction, reviseEquipmentAction } from '@/app/fact-actions';

const INITIAL: ActionState = {};

/**
 * Saisie du matériel d'une épreuve — migration 0045.
 *
 * Pas de catalogue : le nom est celui du règlement. Trois exigences décrites
 * (SOURCES_EXTRACTION §82) ; la condition n'est demandée que pour un
 * conditionnel, et c'est le domaine qui la rend obligatoire. Aucune règle
 * ici : l'autorité, la preuve « Saisie manuelle » et le journal sont en base.
 */

export const REQUIREMENT_OPTIONS = [
  {
    value: 'mandatory',
    label: 'Obligatoire',
    description: 'Exigé au départ ou contrôlé en course.',
  },
  {
    value: 'conditional',
    label: 'Conditionnel',
    description: 'Exigé selon une condition annoncée — météo, horaire, décision de l’organisation.',
  },
  {
    value: 'recommended',
    label: 'Recommandé',
    description: 'Conseillé par l’organisation, jamais exigé.',
  },
] as const;

type Requirement = (typeof REQUIREMENT_OPTIONS)[number]['value'];

export interface SiblingRace {
  readonly id: string;
  readonly name: string;
}

function TrustSelect({ id, defaultValue }: { readonly id: string; readonly defaultValue: string }) {
  return (
    <div className="pk-field">
      <label className="pk-field-label" htmlFor={id}>
        Niveau de confiance
      </label>
      <select id={id} name="trustLevel" className="pk-input" defaultValue={defaultValue}>
        <option value="pluka_validated">Validée PLUKA</option>
        <option value="official">Officielle — réservé à un éditeur de l’organisation</option>
      </select>
    </div>
  );
}

/** Nom, exigence, condition, précision : les champs communs à l'ajout et à la correction. */
function EquipmentFields({
  prefix,
  errors,
  initial,
}: {
  readonly prefix: string;
  readonly errors: Readonly<Record<string, string>>;
  readonly initial?: RaceEquipmentItem;
}) {
  const [requirement, setRequirement] = useState<Requirement | ''>(initial?.requirement ?? '');

  return (
    <>
      <Input
        id={`${prefix}-label`}
        name="label"
        label="Nom, tel que le règlement l’écrit"
        placeholder="Ex. Veste imperméable avec capuche"
        required
        autoComplete="off"
        defaultValue={initial?.label ?? ''}
        error={errors['label']}
      />

      <fieldset className="ad-role-choices ad-equipment-requirements">
        <legend className="pk-field-label">Exigence</legend>
        {REQUIREMENT_OPTIONS.map((option) => (
          <label
            key={option.value}
            className="ad-role-choice"
            htmlFor={`${prefix}-${option.value}`}
          >
            <input
              id={`${prefix}-${option.value}`}
              type="radio"
              name="requirement"
              value={option.value}
              required
              checked={requirement === option.value}
              onChange={() => setRequirement(option.value)}
            />
            <span className="ad-role-choice-text">
              <span className="ad-role-choice-label">{option.label}</span>
              <span className="ad-role-choice-description">{option.description}</span>
            </span>
          </label>
        ))}
        {errors['requirement'] === undefined ? null : (
          <p className="pk-field-error">{errors['requirement']}</p>
        )}
      </fieldset>

      <div className="ad-form-grid">
        <Input
          id={`${prefix}-condition`}
          name="condition"
          label={requirement === 'conditional' ? 'Condition' : 'Condition (si conditionnel)'}
          placeholder="Ex. si température prévue < 5 °C"
          required={requirement === 'conditional'}
          autoComplete="off"
          defaultValue={initial?.condition ?? ''}
          error={errors['condition']}
        />
        <Input
          id={`${prefix}-detail`}
          name="detail"
          label="Précision (facultative)"
          placeholder="Ex. membrane 10 000 mm, coutures étanchées"
          autoComplete="off"
          defaultValue={initial?.detail ?? ''}
          error={errors['detail']}
        />
      </div>
    </>
  );
}

function Failure({ state }: { readonly state: ActionState }) {
  if (state.error === undefined) return null;
  return (
    <p className="pk-field-error" role="alert">
      {state.error}
    </p>
  );
}

export function AddEquipmentForm({
  raceId,
  raceName,
  siblings,
}: {
  readonly raceId: string;
  readonly raceName: string;
  /** Les autres épreuves de l'édition : le matériel d'un règlement vaut souvent pour toutes. */
  readonly siblings: readonly SiblingRace[];
}) {
  const [state, action, pending] = useActionState(addEquipmentAction, INITIAL);
  const id = useId();
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="ad-equipment-form">
      <input type="hidden" name="raceId" value={raceId} />
      {/* L'épreuve de la fiche est toujours visée. */}
      <input type="hidden" name="raceIds" value={raceId} />

      <EquipmentFields prefix={`${id}-add`} errors={errors} />

      {siblings.length === 0 ? null : (
        <fieldset className="ad-equipment-scope">
          <legend className="pk-field-label">Ajouter aussi à</legend>
          <p className="ad-org-panel-lede">
            Pour {raceName}, et pour les épreuves cochées. Une épreuve qui l’a déjà est laissée
            telle quelle.
          </p>
          {siblings.map((sibling) => (
            <label key={sibling.id} className="ad-confirm" htmlFor={`${id}-race-${sibling.id}`}>
              <input
                id={`${id}-race-${sibling.id}`}
                type="checkbox"
                name="raceIds"
                value={sibling.id}
              />
              <span>{sibling.name}</span>
            </label>
          ))}
        </fieldset>
      )}

      <TrustSelect id={`${id}-trust`} defaultValue="pluka_validated" />

      <div className="ad-form-actions">
        <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
          {pending ? 'Ajout…' : 'Ajouter le matériel'}
        </button>
      </div>
      <Failure state={state} />
    </form>
  );
}

export function ReviseEquipmentForm({
  raceId,
  item,
}: {
  readonly raceId: string;
  readonly item: RaceEquipmentItem;
}) {
  const [state, action, pending] = useActionState(reviseEquipmentAction, INITIAL);
  const id = useId();

  return (
    <form action={action} className="ad-equipment-form">
      <input type="hidden" name="raceId" value={raceId} />
      <input type="hidden" name="factId" value={item.factId} />

      <EquipmentFields prefix={`${id}-revise`} errors={state.fieldErrors ?? {}} initial={item} />

      <TrustSelect
        id={`${id}-trust`}
        defaultValue={item.trustLevel === 'official' ? 'official' : 'pluka_validated'}
      />
      <Input
        id={`${id}-note`}
        name="note"
        label="Motif de la correction (facultatif)"
        placeholder="Ex. règlement 2026, article 7"
        autoComplete="off"
      />

      <div className="ad-form-actions">
        <button type="submit" className="pk-btn pk-button-secondary" disabled={pending}>
          {pending ? 'Enregistrement…' : 'Publier la correction'}
        </button>
      </div>
      <Failure state={state} />
    </form>
  );
}
