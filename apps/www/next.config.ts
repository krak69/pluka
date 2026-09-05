import type { NextConfig } from 'next';

/**
 * Site public — 01_ARCHITECTURE.md §4.1, §6.
 *
 * Indexable, SSR / SSG / ISR selon le besoin, aucune donnée privée. C'est la
 * seule des trois surfaces qui doit être trouvée par un moteur de recherche.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // §127 de 03_PRIVACY_RLS : les en-têtes de sécurité s'appliquent
          // aussi au site public. L'indexation, elle, reste ouverte.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
