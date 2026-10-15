'use client';

import { Input } from '@pluka/ui';
import { useState } from 'react';

import type { ActionState } from '@/app/actions';
import {
  REQUIREMENT_OPTIONS,
  type Requirement,
} from '@/app/courses/[raceId]/equipment-requirements';

/**
 * Les champs d'un matériel — migrations 0045, 0046, 0047. Partagés par
 * l'écran événement (ajout, modification) et la revue d'un candidat extrait.
 *
 * Pas de catalogue : le nom est celui du règlement. Trois exigences décrites
 * (SOURCES_EXTRACTION §82) ; la condition n'est demandée que pour un
 * conditionnel, et c'est le domaine qui la rend obligatoire. Aucune règle
 * ici : l'autorité, la preuve et le journal sont en base.
 */

export function TrustSelect({ id, defaultValue }: { readonly id: string; readonly defaultValue: string }) {
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

/** Ce qu'un formulaire de matériel préremplit : un élément publié, ou un candidat extrait. */
export interface EquipmentDraft {
  readonly label: string;
  readonly requirement: Requirement | null;
  readonly condition: string | null;
  readonly detail: string | null;
}

/**
 * Nom, exigence, condition, précision : les champs communs à l'ajout, à la
 * correction et à la revue d'un candidat extrait.
 */
export function EquipmentFields({
  prefix,
  errors,
  initial,
  allowUnstated = false,
}: {
  readonly prefix: string;
  readonly errors: Readonly<Record<string, string>>;
  readonly initial?: EquipmentDraft;
  /**
   * En revue, la source peut ne pas dire l'exigence (§82) : le relecteur peut
   * alors publier le matériel « À préciser » plutôt que de choisir à sa place.
   */
  readonly allowUnstated?: boolean;
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
              required={!allowUnstated}
              checked={requirement === option.value}
              onChange={() => setRequirement(option.value)}
            />
            <span className="ad-role-choice-text">
              <span className="ad-role-choice-label">{option.label}</span>
              <span className="ad-role-choice-description">{option.description}</span>
            </span>
          </label>
        ))}
        {allowUnstated ? (
          <label className="ad-role-choice" htmlFor={`${prefix}-unstated`}>
            <input
              id={`${prefix}-unstated`}
              type="radio"
              name="requirement"
              value=""
              checked={requirement === ''}
              onChange={() => setRequirement('')}
            />
            <span className="ad-role-choice-text">
              <span className="ad-role-choice-label">Non précisée par la source</span>
              <span className="ad-role-choice-description">
                Publié « À préciser » : les coureurs lisent que la source ne dit pas l’exigence.
              </span>
            </span>
          </label>
        ) : null}
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

export function Failure({ state }: { readonly state: ActionState }) {
  if (state.error === undefined) return null;
  return (
    <p className="pk-field-error" role="alert">
      {state.error}
    </p>
  );
}
