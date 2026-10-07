/**
 * Compte rendu d'un geste de la console — lot 4b.
 *
 * Les Server Actions de `console-actions.ts` redirigent avec `?fait=` après un
 * succès. Seuls les codes de cette table produisent une phrase : un paramètre
 * inconnu, ou forgé, n'affiche rien plutôt que d'afficher ce qu'on lui a passé.
 *
 * Le nombre `n` n'est lu que comme entier positif : il dit combien de
 * signalements un masquage a clos, ou le rang d'une relance.
 */

export type ConsoleNoticeParams = Readonly<Record<string, string | string[] | undefined>>;

function count(params: ConsoleNoticeParams): number | null {
  const raw = params['n'];
  if (typeof raw !== 'string' || !/^\d{1,4}$/.test(raw)) return null;

  const value = Number.parseInt(raw, 10);
  return value > 0 ? value : null;
}

export function consoleNotice(params: ConsoleNoticeParams): string | null {
  const n = count(params);

  switch (params['fait']) {
    case 'masque':
      return n === null || n === 1
        ? 'Contenu masqué. Le signalement est clos.'
        : `Contenu masqué. ${n} signalements sur ce contenu sont clos, sous une seule entrée du journal.`;
    case 'classe':
      return 'Signalement classé sans suite. Le contenu reste publié.';
    case 'relance':
      return n === null || n === 1
        ? 'Traitement remis en file. Le worker le reprendra à son prochain passage.'
        : `Traitement remis en file (relance n° ${n}).`;
    case 'valide':
      return 'Fiche validée : elle est désormais trouvable par tous les coureurs.';
    case 'fiche-creee':
      return 'Fiche créée.';
    case 'fiche-modifiee':
      return 'Fiche enregistrée. Une stratégie déjà confirmée garde ses valeurs.';
    case 'fiche-supprimee':
      return 'Fiche supprimée.';
    case 'information-modifiee':
      return 'Information corrigée : une nouvelle version est publiée, l’ancienne reste dans l’historique. Les plans qui en dépendaient sont signalés à revoir.';
    case 'information-retiree':
      return 'Information retirée : elle n’est plus visible des coureurs. Son historique est conservé ; elle peut être restaurée.';
    case 'information-restauree':
      return 'Information restaurée : elle est de nouveau visible.';
    case 'archive':
      return 'Fiche archivée : elle n’est plus proposée aux coureurs.';
    case 'organisation':
      return 'Organisation créée. Elle n’a encore aucun membre.';
    case 'organisation-modifiee':
      return 'Organisation modifiée.';
    case 'organisation-supprimee':
      return 'Organisation supprimée. Le journal garde la trace de son slug.';
    case 'invitation-envoyee':
      return 'Invitation enregistrée : l’email part dans quelques instants. Le lien est valable 7 jours.';
    case 'invitation-revoquee':
      return 'Invitation révoquée : son lien ne fonctionne plus.';
    case 'role-modifie':
      return 'Rôle modifié. Il s’applique dès la prochaine page ouverte par ce membre.';
    case 'role-inchange':
      return 'Aucune modification : le membre avait déjà ce rôle.';
    case 'acces-admin-retire':
      return 'Membre retiré de l’équipe PLUKA : ses accès à l’administration ont cessé.';
    case 'membre-retire':
      return 'Membre retiré : ses accès à l’organisation ont cessé.';
    case 'organisation-inchangee':
      return 'Aucune modification : la fiche était déjà à jour.';
    default:
      return null;
  }
}
