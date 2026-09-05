import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
  /*
   * `tsconfig.json` fixe `jsx: preserve`, parce que c'est Next qui compile
   * l'application. Les tests n'ont pas ce compilateur : ils demandent donc
   * eux-mêmes la transformation automatique, sans changer la configuration
   * de production.
   */
  esbuild: { jsx: 'automatic' },
  // Les tests rendent des composants d'écran : ils empruntent le même alias
  // que l'application, pour tester le module réellement livré.
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
});
