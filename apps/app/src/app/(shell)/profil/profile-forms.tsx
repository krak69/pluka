'use client';

import type { TrailProfileRecord } from '@pluka/db';
import { Button, Input, MicroLabel } from '@pluka/ui';
import { useActionState, useState } from 'react';

import type { ActionState } from '@/app/actions';
import { saveEffortAction, saveTrainingAction } from '@/app/profile-actions';

/**
 * Les deux écrans du Profil trailer — 00_PRODUCT_SPEC §8.1.
 *
 * L'étape courante est un état, pas une route : `05_ROUTES_FLOWS.md` §1.2 range
 * les étapes de formulaire du côté de l'état. Chaque étape s'enregistre seule,
 * donc rien n'est perdu si le coureur s'arrête entre les deux.
 *
 * Aucune des deux n'est obligatoire, et aucun champ n'est marqué requis : §7.2
 * veut qu'un profil partiel s'enregistre. Ce que l'écran ne fait pas non plus,
 * c'est suggérer une valeur — §46 note que le Repère PLUKA n'est ni spécifié ni
 * calibré, et proposer un chrono sans modèle validé serait une fausse
 * confiance.
 */

const INITIAL: ActionState = {};

/** Secondes → `HH:MM`, pour repeupler un champ déjà renseigné. */
function toClock(seconds: number | null): string {
  if (seconds === null) return '';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return `${String(hours)}:${String(minutes).padStart(2, '0')}`;
}

/** Secondes par kilomètre → `MM:SS`. */
function toPace(seconds: number | null): string {
  if (seconds === null) return '';

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;

  return `${String(minutes)}:${String(rest).padStart(2, '0')}`;
}

function numberValue(value: number | null): string {
  return value === null ? '' : String(value);
}

const COMFORT_OPTIONS = [
  { value: '', label: 'Sans réponse' },
  { value: 'high', label: 'À l’aise' },
  { value: 'medium', label: 'Normal' },
  { value: 'low', label: 'Je perds du temps' },
];

const EXPERIENCE_OPTIONS = [
  { value: '', label: 'Sans réponse' },
  { value: 'none', label: 'Je débute' },
  { value: 'up_to_30k', label: 'Jusqu’à 30 km' },
  { value: '30_60k', label: '30 à 60 km' },
  { value: '60_100k', label: '60 à 100 km' },
  { value: '100k_plus', label: 'Plus de 100 km' },
];

function Refusal({ state }: { readonly state: ActionState }) {
  if (state.error === undefined) return null;

  return (
    <p className="rp-refusal" role="alert">
      {state.error}
    </p>
  );
}

export function ProfileForms({ profile }: { readonly profile: TrailProfileRecord | null }) {
  const [step, setStep] = useState<'effort' | 'training'>('effort');
  const [effortState, saveEffort] = useActionState(saveEffortAction, INITIAL);
  const [trainingState, saveTraining] = useActionState(saveTrainingAction, INITIAL);

  return (
    <div className="rp-profile">
      {/*
        Les deux étapes sont un état, pas des routes — `05_ROUTES_FLOWS.md` §1.2
        range les étapes de formulaire du côté de l'état. Ce sont donc des
        boutons, et ils ne reprennent pas `pk-tab`, qui est l'affordance d'un
        onglet-lien dans `NavTabs`.
      */}
      <div role="group" aria-label="Étapes du profil" className="rp-steps">
        <button
          type="button"
          onClick={() => setStep('effort')}
          aria-pressed={step === 'effort'}
          className={step === 'effort' ? 'rp-step rp-step-current' : 'rp-step'}
        >
          Effort de référence
        </button>
        <button
          type="button"
          onClick={() => setStep('training')}
          aria-pressed={step === 'training'}
          className={step === 'training' ? 'rp-step rp-step-current' : 'rp-step'}
        >
          Volume et terrain
        </button>
      </div>

      {step === 'effort' ? (
        <form action={saveEffort} className="rp-form">
          <MicroLabel>Un effort que tu connais bien</MicroLabel>

          <p className="pk-body rp-measure">
            Une course ou une sortie longue dont tu te souviens du chrono. À défaut, renseigne
            seulement ton allure de confort plus bas.
          </p>

          <Input
            id="effort-label"
            name="representativeEffortLabel"
            label="Quel effort"
            hint="Course ou sortie longue."
            placeholder="SaintéLyon 2025"
            defaultValue={profile?.representativeEffortLabel ?? ''}
          />

          <Input
            id="effort-date"
            name="representativeEffortDate"
            type="date"
            label="Quand"
            hint="Facultatif."
            defaultValue={profile?.representativeEffortDate ?? ''}
          />

          <div className="rp-form-row">
            <Input
              id="effort-distance"
              name="representativeDistanceKm"
              label="Distance"
              hint="En kilomètres."
              inputMode="decimal"
              placeholder="72"
              defaultValue={numberValue(profile?.representativeDistanceKm ?? null)}
            />
            <Input
              id="effort-elevation"
              name="representativeElevationGainM"
              label="Dénivelé positif"
              hint="En mètres."
              inputMode="numeric"
              placeholder="4600"
              defaultValue={numberValue(profile?.representativeElevationGainM ?? null)}
            />
          </div>

          <Input
            id="effort-duration"
            name="representativeDurationSeconds"
            label="Durée"
            hint="Format HH:MM."
            placeholder="12:30"
            defaultValue={toClock(profile?.representativeDurationSeconds ?? null)}
          />

          <Input
            id="effort-pace"
            name="fallbackTrailPaceSecondsPerKm"
            label="Allure de confort en trail"
            hint="Format MM:SS par kilomètre. Sert si tu n’as pas d’effort de référence."
            placeholder="7:30"
            defaultValue={toPace(profile?.fallbackTrailPaceSecondsPerKm ?? null)}
          />

          <div className="rp-form-actions">
            <Button type="submit" variant="primary">
              Enregistrer
            </Button>
            <Button type="button" variant="secondary" onClick={() => setStep('training')}>
              Volume et terrain
            </Button>
          </div>

          <Refusal state={effortState} />
        </form>
      ) : (
        <form action={saveTraining} className="rp-form">
          <MicroLabel>Ton entraînement habituel</MicroLabel>

          <p className="pk-body rp-measure">
            Ce que tu fais en moyenne sur une semaine, et comment tu te sens sur le relief. Toutes
            ces réponses sont facultatives.
          </p>

          <div className="rp-form-row">
            <Input
              id="weekly-distance"
              name="weeklyDistanceKm"
              label="Volume hebdomadaire"
              hint="En kilomètres."
              inputMode="decimal"
              placeholder="60"
              defaultValue={numberValue(profile?.weeklyDistanceKm ?? null)}
            />
            <Input
              id="weekly-elevation"
              name="weeklyElevationGainM"
              label="Dénivelé hebdomadaire"
              hint="En mètres."
              inputMode="numeric"
              placeholder="1500"
              defaultValue={numberValue(profile?.weeklyElevationGainM ?? null)}
            />
          </div>

          <div className="rp-form-row">
            <div className="pk-field">
              <label className="pk-field-label" htmlFor="climb-comfort">
                En montée
              </label>
              <select
                id="climb-comfort"
                name="climbComfort"
                className="pk-input"
                defaultValue={profile?.climbComfort ?? ''}
              >
                {COMFORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="pk-field">
              <label className="pk-field-label" htmlFor="descent-comfort">
                En descente
              </label>
              <select
                id="descent-comfort"
                name="descentComfort"
                className="pk-input"
                defaultValue={profile?.descentComfort ?? ''}
              >
                {COMFORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="pk-field">
            <label className="pk-field-label" htmlFor="experience">
              Ta plus longue distance
            </label>
            <select
              id="experience"
              name="longDistanceExperience"
              className="pk-input"
              defaultValue={profile?.longDistanceExperience ?? ''}
            >
              {EXPERIENCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="rp-form-actions">
            <Button type="submit" variant="primary">
              Enregistrer
            </Button>
            <Button type="button" variant="secondary" onClick={() => setStep('effort')}>
              Effort de référence
            </Button>
          </div>

          <Refusal state={trainingState} />
        </form>
      )}
    </div>
  );
}
