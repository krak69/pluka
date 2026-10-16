import type { NextConfig } from 'next';

/**
 * Application authentifiée — 01_ARCHITECTURE.md §4.2, §6.
 *
 * Jamais indexée, et `Referrer-Policy: no-referrer` pour ne pas laisser fuir
 * une URL applicative vers un tiers : les routes tokenisées — Assistance,
 * Brief — reposent sur cette règle (03_PRIVACY_RLS §128).
 *
 * Une seule exception, et elle est nommée : la fiche épreuve publique de
 * `05_ROUTES_FLOWS.md` §4.3. `01_ARCHITECTURE.md` §4.1 enregistre pourquoi elle
 * vit ici plutôt que dans `apps/www`.
 *
 * Le défaut reste `noindex` et il n'est levé que sur ce préfixe. L'inverse —
 * indexer par défaut et exclure au cas par cas — rendrait indexable toute
 * nouvelle route par simple omission, ce qui est exactement l'accident que
 * cette en-tête existe pour empêcher.
 */

/** Préfixe de la seule zone indexable de l'application. */
const PUBLIC_RACE_PREFIX = '/epreuves';

/*
 * Les sites d'événement — EVENT_SITE §7. Ils vivent sur `{slug}.{racine}`,
 * la racine étant l'hôte de l'app sans son `app.` : `pluka.run` en
 * production, `localhost` en local. Ils sont indexables et ont leurs propres
 * en-têtes ; le proxy les réécrit ensuite vers `/site/{slug}`.
 *
 * Les en-têtes se décident sur l'hôte et non sur le chemin : Next les
 * applique avant la réécriture du proxy, quand le chemin est encore `/`.
 */
const APP_URL = new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001');
const SITE_ROOT = APP_URL.hostname.startsWith('app.')
  ? APP_URL.hostname.slice(4)
  : APP_URL.hostname;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const SITE_HOST = `(?!app\\.)[a-z0-9-]+\\.${escapeRegExp(SITE_ROOT)}(?::\\d+)?`;
const IS_DEV = process.env.NODE_ENV !== 'production';
const SUPABASE_ORIGIN = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321')
  .origin;

/*
 * §7.2 : les sites partagent le site navigateur de l'app. Aucun contenu
 * d'organisateur n'y exécute de script ; la politique le redit au navigateur.
 * Les images viennent du stockage public (logo, couverture) ou des sites des
 * partenaires.
 */
const SITE_CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${IS_DEV ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: https: ${SUPABASE_ORIGIN}`,
  "font-src 'self'",
  `connect-src 'self'${IS_DEV ? ' ws: wss:' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // En local, un site se sert sur `{slug}.localhost` : le serveur de dev doit
  // accepter ces hôtes pour ses ressources de rechargement.
  allowedDevOrigins: ['*.localhost'],
  experimental: {
    serverActions: {
      // Le logo et la couverture d'un site se déposent jusqu'à 8 Mo, réencodés
      // ensuite (EVENT_SITE §4) ; la marge couvre l'enveloppe multipart.
      bodySizeLimit: '9mb',
    },
  },

  async headers() {
    return [
      {
        /*
         * Tout sauf `/epreuves` : la négation est dans le `source` plutôt que
         * dans un second bloc qui écraserait le premier, parce que Next
         * concatène les en-têtes de tous les blocs correspondants au lieu de
         * laisser le dernier gagner. Deux blocs produiraient deux
         * `X-Robots-Tag` contradictoires sur la même réponse.
         */
        source: '/:path((?!epreuves(?:/|$)).*)',
        missing: [{ type: 'host', value: SITE_HOST }],
        headers: [
          // L'en-tête couvre aussi les Route Handlers, que la métadonnée
          // `robots` du layout n'atteint pas.
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          ...SECURITY_HEADERS,
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
      {
        source: `${PUBLIC_RACE_PREFIX}/:path*`,
        missing: [{ type: 'host', value: SITE_HOST }],
        headers: [
          ...SECURITY_HEADERS,
          /*
           * La fiche publique est indexable, donc partagée : `no-referrer`
           * n'a plus de raison d'être et casserait les liens entrants. On
           * garde la politique du site public.
           */
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        // Un site d'événement : indexable, partagé, sous politique de contenu stricte.
        source: '/:path*',
        has: [{ type: 'host', value: SITE_HOST }],
        headers: [
          ...SECURITY_HEADERS,
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: SITE_CSP },
        ],
      },
    ];
  },
};

export default nextConfig;
