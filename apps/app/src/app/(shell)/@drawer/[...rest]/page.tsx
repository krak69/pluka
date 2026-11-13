/**
 * Toute autre adresse ferme le tiroir. Sans cette route, une navigation depuis
 * le tiroir (vers le plan, par exemple) garderait l'emplacement parallèle dans
 * son dernier état, et le tiroir resterait ouvert par-dessus la nouvelle page.
 */
export default function CloseDrawer() {
  return null;
}
