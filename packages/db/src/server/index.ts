/**
 * Point d'entrée **serveur** de `@pluka/db`.
 *
 * Importé par les Server Components, Server Actions, Route Handlers et le
 * worker. Contient la création du client de service : ce module ne doit jamais
 * être importé depuis du code navigateur (01_ARCHITECTURE §9).
 *
 * La séparation n'est pas qu'une convention de nommage — `tests/import-graph`
 * la vérifie en construisant le graphe des imports.
 */

export {
  createServerClient,
  createServiceRoleClient,
  type ServerClientConfig,
  type ServiceRoleClientConfig,
} from './client.js';
export { buildServerClientOptions } from './options.js';
