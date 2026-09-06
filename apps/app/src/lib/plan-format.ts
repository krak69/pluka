/**
 * Mise en forme des valeurs du Plan — 06_DESIGN_SYSTEM.md §16, §54 ;
 * PLAN_ENGINE §5.1, §5.3, §65.
 *
 * Module séparé de `plan.ts` parce qu'un composant client l'importe. `plan.ts`
 * câble des repositories Supabase et lit les cookies de la requête : le tirer
 * dans un bundle navigateur ferait entrer la session dans le client.
 *
 * Ces fonctions ne calculent rien du Plan. Elles traduisent en texte des
 * nombres que `getPlanOverview` a déjà résolus : c'est la seule arithmétique
 * qui vive côté navigateur, et elle ne produit aucune information nouvelle.
 */

/**
 * Durée en `HH:MM` — 06_DESIGN_SYSTEM.md §65 du moteur, « heure prévue ».
 *
 * Les heures dépassent 24 sans repasser à zéro : un ultra de trente heures se
 * lit `30:12`, pas `06:12`. C'est la traduction directe de §5.1, « des
 * secondes écoulées depuis le départ effectif ».
 */
export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Durée signée, pour une dérive ou une marge : `+12:00`, `−04:30`. */
export function formatSigned(seconds: number): string {
  const sign = seconds < 0 ? '−' : '+';

  return `${sign}${formatElapsed(Math.abs(seconds))}`;
}

/**
 * Durée en minutes entières, pour un champ d'arrêt.
 *
 * Le Plan stocke des secondes (§5.1) ; un arrêt se saisit en minutes. La
 * conversion vit ici, avec les autres mises en forme, plutôt que dans l'écran :
 * §45 veut que rien ne se calcule dans le navigateur, et la seule façon de le
 * tenir est de n'y laisser aucune arithmétique du tout.
 */
export function formatMinutes(seconds: number): string {
  return String(Math.round(Math.max(0, seconds) / 60));
}

/**
 * Distance en kilomètres, décimale française.
 *
 * Le séparateur décimal d'une interface française est la virgule. Le point
 * ferait lire `5.0` comme un identifiant plutôt que comme une distance.
 */
export function formatDistance(kilometers: number): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(kilometers);
}

/** Allure en `MM:SS` par kilomètre. Nulle quand la distance ne permet rien de dire. */
export function formatPace(secondsPerKm: number | null): string {
  if (secondsPerKm === null) return '—';

  const total = Math.max(0, Math.round(secondsPerKm));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Heure calendaire d'un instant ISO, dans le fuseau de la course.
 *
 * Les heures affichées sont celles de la course, pas celles du navigateur :
 * §5.3 dérive les dates du départ effectif, et un coureur qui prépare depuis
 * un autre fuseau doit lire l'heure du terrain.
 */
export function formatClock(isoInstant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(isoInstant));
}
