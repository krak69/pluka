/**
 * Informations légales de PLUKA — une seule source pour les pages légales.
 *
 * Décisions du 2026-11-09 : pendant la bêta, PLUKA est édité par une personne
 * physique, sans société ; une adresse dédiée reçoit les demandes sur les
 * données ; durées de conservation selon les usages de la CNIL ; service
 * réservé aux 15 ans et plus. Ces choix restent à faire valider
 * (docs/legal/RGPD_AUTO_EVALUATION.md).
 *
 * Tant qu'une valeur est nulle, la page affiche « à compléter » et n'est pas
 * indexée : une politique de confidentialité sans responsable identifiable ne
 * doit pas être présentée comme définitive.
 */
export const LEGAL = {
  /** Nom de l'éditeur, personne physique tant qu'aucune société n'existe. */
  editorName: null as string | null,
  /** Adresse dédiée aux demandes sur les données personnelles. */
  privacyEmail: null as string | null,
  /** Date de la dernière mise à jour, affichée en tête de page. */
  updatedOn: '2026-11-09',
} as const;

export function legalComplete(): boolean {
  return LEGAL.editorName !== null && LEGAL.privacyEmail !== null;
}
