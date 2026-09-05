/**
 * `@pluka/notifications` — gabarits et orchestration des notifications.
 *
 * `01_ARCHITECTURE.md` §4.5 : « templates et orchestration email /
 * notifications ». Le transport n'est pas ici : `EmailProvider` appartient à
 * `packages/contracts`, ce paquet l'importe et n'y définit aucune interface de
 * fournisseur. Il ne connaît le nom d'aucun fournisseur non plus, et l'adapter
 * concret vit hors du paquet — la même frontière que pour `AIProvider`.
 *
 * Le module ne fait aucune I/O : il reçoit de quoi écrire un message et un
 * provider injecté. C'est ce qui rend le contenu testable sans serveur de mail,
 * et vérifiable au caractère près.
 *
 * Ce que ce paquet garantit, et qui n'est pas une consigne de rédaction mais
 * une propriété de ses types : une notification ne porte que son destinataire
 * et de l'information de course. Il n'existe aucun champ par lequel la donnée
 * d'un autre coureur pourrait y entrer, ni aucune copie vers l'organisation
 * (00_PRODUCT_SPEC §37).
 */

export {
  CHANGE_SEVERITIES,
  IMPACTED_MODULES,
  listModules,
  renderChangeImpactNotice,
  type ChangeImpactNotice,
  type ChangeSeverity,
  type ImpactedModule,
  type RenderedNotice,
} from './templates/change-impact.js';

export {
  NOTIFICATION_ERROR_CODES,
  NOTIFICATION_TEMPLATE_VERSION,
  NotificationError,
  isNotificationError,
  sendChangeImpactNotice,
  type ChangeImpactDelivery,
  type NotificationErrorCode,
  type NotificationSent,
} from './send.js';
