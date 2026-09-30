import { redirect } from 'next/navigation';

/**
 * `/evenements` — redirection vers l'index.
 *
 * La liste des événements vit à `/` depuis les premiers lots, et le prototype
 * ouvre l'administration sur la Vue d'ensemble : les deux adresses se disputent
 * la racine. C'est le cas ouvert §12.5 de `05_ROUTES_FLOWS.md`, et il n'est pas
 * tranché ici.
 *
 * En attendant, l'adresse de l'arborescence répond au lieu de rendre un 404 :
 * un lien écrit d'après le document ne doit pas casser parce que
 * l'implémentation a gardé l'ancienne racine.
 */
export default function EventsIndexRedirect() {
  redirect('/');
}
