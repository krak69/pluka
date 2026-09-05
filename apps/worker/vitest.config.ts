import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Les suites de bout en bout partagent une seule base locale et les mêmes
    // files pgmq. Exécutées de front, elles se volent leurs messages : un tour
    // de boucle consomme tout ce qui traîne, sans savoir qui l'a enfilé. Les
    // sérialiser coûte quelques secondes et rend le résultat lisible.
    fileParallelism: false,
  },
});
