import type { AttachmentVerdict } from '../participation/invariants.js';
import { hasPaceSignal, type TrailProfileShape } from '../profile/invariants.js';
import {
  ORGANIZER_REGISTRATION_SOURCES,
  stepsForFlow,
  type OnboardingFlow,
  type OnboardingStep,
} from './steps.js';

/**
 * Avancement de l'onboarding — 00_PRODUCT_SPEC §7.
 *
 * Fonctions pures : mêmes entrées, mêmes sorties, aucune I/O, aucune horloge.
 *
 * L'ONBOARDING N'A PAS D'ÉTAT À LUI
 *
 * Aucune table ne suit l'avancement, et c'est délibéré. L'état se recalcule à
 * chaque fois à partir de ce que les commandes du lot ont écrit — le Profil
 * trailer, la participation, l'objectif. Une ligne « onboarding » serait une
 * seconde source de vérité : elle pourrait dire « profil fait » alors que le
 * profil est vide, et il faudrait alors décider laquelle des deux a raison.
 *
 * La reprise en découle sans mécanisme : un coureur qui ferme son navigateur
 * au milieu du parcours n'a rien à reprendre, il a seulement des choses déjà
 * enregistrées. §7.2 le suppose explicitement — « éviter de reposer
 * systématiquement toutes les questions » n'est possible que si les réponses
 * survivent à l'interruption.
 */

/** Ce que le domaine sait du coureur au moment de calculer son avancement. */
export interface OnboardingSnapshot {
  /** `null` pour un compte qui n'a encore rien renseigné. */
  readonly profile: TrailProfileShape | null;
  /**
   * Participation du coureur sur la course visée, ou son absence.
   *
   * Une participation importée mais non réclamée n'apparaît pas ici : elle
   * n'est trouvable que par son identifiant tant qu'aucun `user_id` ne la
   * relie (01_ARCHITECTURE §10.2). Le parcours §7.3 commence donc, du point de
   * vue du domaine, une fois la réclamation faite.
   */
  readonly participation: {
    readonly registrationSource: string;
  } | null;
  /** Objectif du coureur sur cette course (§9.1), nul tant qu'il n'a pas choisi. */
  readonly targetDurationSeconds: number | null;
  /**
   * Verdict de rattachement, quand il n'y a pas encore de participation.
   *
   * Consulté uniquement dans ce cas : une participation existante n'est jamais
   * remise en cause par l'état de l'épreuve (§4.1).
   */
  readonly attachment: AttachmentVerdict;
}

export type OnboardingStepStatus = 'done' | 'todo';

export interface OnboardingStepState {
  readonly step: OnboardingStep;
  readonly status: OnboardingStepStatus;
}

/**
 * Ce qui empêche l'étape courante d'aboutir.
 *
 * Repris tel quel de `checkRaceAttachment` : une course annulée n'accepte
 * aucune nouvelle participation (02_DATA_MODEL §9.4). Sans ce champ, l'appelant
 * afficherait « prochaine étape : rejoindre cette course » sur une commande qui
 * échouera.
 */
export type OnboardingBlocker = 'race_cancelled' | 'race_not_open';

export interface OnboardingState {
  readonly flow: OnboardingFlow;
  readonly steps: readonly OnboardingStepState[];
  /** Première étape à faire, ou `null` quand il n'en reste aucune. */
  readonly nextStep: OnboardingStep | null;
  readonly complete: boolean;
  readonly blocker: OnboardingBlocker | null;
}

/**
 * Parcours applicable — §7.1, §7.2, §7.3.
 *
 * L'ordre des tests est celui de la spécificité. §7.3 se reconnaît à son point
 * d'entrée : le coureur n'a pas choisi cette course, une organisation l'y a
 * inscrit. Cette condition l'emporte sur celle de §7.2, car un invité qui a
 * déjà un profil arrive quand même par l'invitation, avec les informations
 * préremplies que §7.3 lui fait vérifier.
 *
 * §7.2 vient ensuite, à sa condition littérale : « si le profil existe déjà ».
 * Un profil incomplet compte — il existe, et ses réponses déjà données ne
 * doivent pas être reposées.
 */
export function resolveOnboardingFlow(snapshot: OnboardingSnapshot): OnboardingFlow {
  const source = snapshot.participation?.registrationSource;

  if (
    source !== undefined &&
    (ORGANIZER_REGISTRATION_SOURCES as readonly string[]).includes(source)
  ) {
    return 'organizer_invitation';
  }

  return snapshot.profile === null ? 'new_runner' : 'returning_runner';
}

function statusOf(step: OnboardingStep, snapshot: OnboardingSnapshot): OnboardingStepStatus {
  if (step === 'trail_profile') {
    // §8.1 : un profil est fait quand il porte un signal d'allure — effort
    // représentatif complet, ou allure de repli. Un profil à moitié rempli
    // reste à faire, ce qui est exactement ce qui permet de le reprendre.
    return snapshot.profile !== null && hasPaceSignal(snapshot.profile) ? 'done' : 'todo';
  }

  if (step === 'race_attachment') return snapshot.participation === null ? 'todo' : 'done';

  return snapshot.targetDurationSeconds === null ? 'todo' : 'done';
}

/**
 * Ce qui bloque, s'il y a lieu.
 *
 * Seul le rattachement peut être bloqué par l'extérieur. Le profil et
 * l'objectif n'appartiennent qu'au coureur, et §4.1 garantit qu'aucun état de
 * course ne les verrouille.
 */
function blockerFor(
  nextStep: OnboardingStep | null,
  snapshot: OnboardingSnapshot,
): OnboardingBlocker | null {
  if (nextStep !== 'race_attachment') return null;
  if (snapshot.attachment.ok) return null;

  // `race_unreachable` ne remonte pas jusqu'ici : le use case répond
  // « introuvable » avant de calculer quoi que ce soit (03_PRIVACY_RLS §120).
  return snapshot.attachment.reason === 'race_cancelled' ? 'race_cancelled' : 'race_not_open';
}

/**
 * Avancement complet, à partir d'un instantané.
 *
 * `nextStep` est la première étape non faite, dans l'ordre du parcours. Une
 * étape déjà faite n'est jamais reproposée : c'est la traduction directe de
 * « éviter de reposer systématiquement toutes les questions » (§7.2).
 *
 * L'ordre n'est pas une obligation d'exécution — rien n'empêche un coureur de
 * choisir son objectif avant de compléter son profil, et le domaine accepte
 * les commandes dans n'importe quel ordre. Il dit seulement par quoi continuer.
 */
export function computeOnboarding(snapshot: OnboardingSnapshot): OnboardingState {
  const flow = resolveOnboardingFlow(snapshot);

  const steps = stepsForFlow(flow).map((step) => ({ step, status: statusOf(step, snapshot) }));
  const nextStep = steps.find((state) => state.status === 'todo')?.step ?? null;

  return {
    flow,
    steps,
    nextStep,
    complete: nextStep === null,
    blocker: blockerFor(nextStep, snapshot),
  };
}
