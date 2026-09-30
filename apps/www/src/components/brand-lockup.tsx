/**
 * Lockup PLUKA.
 *
 * 06_DESIGN_SYSTEM.md §143 : « Le SVG doit être importé / rendu comme asset de
 * marque. Ne pas redessiner le logo manuellement en CSS. » Le SVG n'est pas
 * dans le dépôt — le prototype le tire d'un sprite `pluka-logo-sprite.js` qui
 * n'a pas été versionné avec `reference/prototype/`.
 *
 * Le nom est donc composé dans Archivo, la police de titre de la Charte, à la
 * largeur variable haute du lockup. Ce n'est pas un dessin du logo : c'est le
 * mot, dans la police de la marque, en attendant l'asset. Voir
 * `public/brand/README.md` — ce composant est le seul point à remplacer.
 *
 * Le mot reste dans l'arbre d'accessibilité : il donne son nom au lien du
 * logo, que le prototype laisse sans intitulé. Quand le SVG le remplacera, il
 * devra porter un `<title>` ou un `aria-label` équivalent.
 */
export function BrandLockup() {
  return <span className="lp-wordmark">PLUKA</span>;
}
