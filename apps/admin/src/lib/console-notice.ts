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
    case 'archive':
      return 'Fiche archivée : elle n’est plus proposée aux coureurs.';
    default:
      return null;
  }
}
