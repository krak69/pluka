/**
 * Point d'entrée **navigateur** de `@pluka/db`.
 *
 * Rien de ce qui est atteignable depuis ce module ne mène à `../server/` :
 * aucune clé de service, aucune option serveur. `tests/import-graph` le
 * prouve en parcourant le graphe des imports plutôt qu'en s'en remettant à la
 * discipline de revue.
 */

export { createBrowserClient, type BrowserClientConfig } from './client.js';
export { buildBrowserClientOptions } from './options.js';
