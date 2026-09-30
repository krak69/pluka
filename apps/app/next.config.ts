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

const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

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
    ];
  },
};

export default nextConfig;
