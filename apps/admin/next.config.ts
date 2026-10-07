import type { NextConfig } from 'next';

/**
 * Application authentifiée — 01_ARCHITECTURE.md §4.2, §6.
 *
 * Jamais indexée, et `Referrer-Policy: no-referrer` pour ne pas laisser fuir
 * une URL applicative vers un tiers : les routes tokenisées à venir —
 * Assistance, Brief — reposent sur cette règle (03_PRIVACY_RLS §128).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Documents de course déposés depuis un poste (0040) : un règlement ou un
  // guide coureur pèse souvent plusieurs Mo. Même borne que le bucket
  // `race-sources` (50 Mo, 0008). Le proxy de session lit aussi le corps : sa
  // limite suit, sans quoi il le tronquerait avant l'action.
  experimental: {
    serverActions: { bodySizeLimit: '50mb' },
    proxyClientMaxBodySize: '50mb',
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // L'en-tête couvre aussi les Route Handlers, que la métadonnée
          // `robots` du layout n'atteint pas.
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },
};

export default nextConfig;
