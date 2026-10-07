/**
 * Une ligne du journal se lit comme une phrase — `adminAuditRows` du
 * prototype : « Jean Dupont a publié la barrière d'Iffigenalp ».
 *
 * Les codes viennent des fonctions SQL qui écrivent `private.audit_logs` :
 * `user.read`, `user.search`, `report.read` (0028), les cinq gestes de 0029,
 * `organization.create` (0030), `organization.update` (0031),
 * `organization.delete` (0032), `organization_member.<geste>` (0033) et
 * `fact.<action>` de 0012. Un code absent d'ici s'affiche tel quel : une
 * action nouvelle doit se voir, pas se taire.
 */
const ACTIONS: Readonly<Record<string, string>> = {
  'user.read': 'a consulté une fiche utilisateur',
  'user.search': 'a recherché des utilisateurs',
  'report.read': 'a ouvert un signalement',
  'report.hide_content': 'a masqué un contenu signalé',
  'report.dismiss': 'a classé un signalement sans suite',
  'job.retry': 'a relancé un traitement',
  'nutrition_product.validate': 'a validé une fiche nutrition',
  'nutrition_product.archive': 'a archivé une fiche nutrition',
  'organization.create': 'a créé une organisation',
  'organization.update': 'a modifié une organisation',
  'organization.delete': 'a supprimé une organisation',
  'organization_member.invite': 'a invité un membre dans une organisation',
  'organization_member.revoke_invitation': 'a révoqué une invitation d’équipe',
  'organization_member.change_role': 'a changé le rôle d’un membre',
  'organization_member.remove': 'a retiré un membre d’une organisation',
  'organization_member.join': 'a rejoint une organisation',
  'fact.publish': 'a publié une information de course',
  'fact.edit_and_publish': 'a corrigé puis publié une information de course',
  'fact.reject': 'a écarté une information extraite',
  'fact.mark_duplicate': 'a marqué une information extraite comme doublon',
  'fact.needs_review': 'a renvoyé une information extraite en revue',
  'fact.revise': 'a corrigé une information publiée',
  'fact.retire': 'a retiré une information publiée',
  'fact.restore': 'a restauré une information retirée',
  'event.create': 'a créé un événement',
  'event_discovery.refresh': 'a relancé la lecture d’un site officiel',
  'edition.add_documents': 'a ajouté des documents à analyser',
  'edition.add_file': 'a déposé un document',
};

export function auditActionLabel(action: string): string {
  return ACTIONS[action] ?? action;
}

/** L'auteur : une action sans session est le fait du système (worker, tâche planifiée). */
export function auditActor(actorEmail: string | null): string {
  return actorEmail ?? 'PLUKA';
}
