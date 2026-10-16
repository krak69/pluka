/**
 * Les routes internes des sites d'événement — EVENT_SITE §7.1.
 *
 * Le proxy réécrit `{slug}.pluka.run/chemin` vers `/site/{slug}/chemin`, et
 * transmet le chemin demandé : une page qui redirige un ancien slug garde
 * ainsi l'adresse que le visiteur avait suivie.
 */
export const SITE_ROUTE_PREFIX = '/site';

export const SITE_PATH_HEADER = 'x-pluka-site-path';
