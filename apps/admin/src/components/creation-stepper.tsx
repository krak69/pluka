'use client';

import { AdminIcon } from '@/components/admin-icon';

/**
 * Fil des étapes de la création d'un événement — cinq étapes, dont la
 * dernière, les documents, se fait sur la fiche créée. Horizontal, au-dessus
 * du formulaire : une barre par étape, qui se remplit à mesure qu'on avance.
 *
 * Une étape déjà atteinte se rouvre d'un clic tant que l'événement n'est pas
 * créé (`onSelect`) ; après la création, le fil n'est plus qu'un repère.
 * L'étape courante est annoncée (`aria-current="step"`) et porte le repère
 * Aube de la prochaine action (06_DESIGN_SYSTEM, AGENTS §43).
 */

export const CREATION_STEPS = [
  'Événement',
  'Édition',
  'Épreuves',
  'Vérification',
  'Documents',
] as const;

export function CreationStepper({
  current,
  reached = current,
  onSelect,
}: {
  /** Étape affichée, de 1 à 5. */
  readonly current: number;
  /** Dernière étape atteinte : celles d'avant se rouvrent. */
  readonly reached?: number;
  readonly onSelect?: (step: number) => void;
}) {
  return (
    <nav aria-label="Étapes de la création">
      <ol className="ad-stepper">
        {CREATION_STEPS.map((label, index) => {
          const step = index + 1;
          const state =
            step === current ? ' is-current' : step < current || step <= reached ? ' is-done' : '';
          const content = (
            <>
              <span className="ad-stepper-number" aria-hidden="true">
                {step < current ? <AdminIcon name="Check" size={14} /> : step}
              </span>
              <span className="ad-stepper-label">{label}</span>
            </>
          );

          return (
            <li
              key={label}
              className={`ad-stepper-step${state}`}
              aria-current={step === current ? 'step' : undefined}
            >
              {onSelect !== undefined && step !== current && step <= reached ? (
                <button
                  type="button"
                  className="ad-stepper-link"
                  onClick={() => onSelect(step)}
                  aria-label={`Revenir à l’étape ${step} : ${label}`}
                >
                  {content}
                </button>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
