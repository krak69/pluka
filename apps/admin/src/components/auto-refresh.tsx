'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Rafraîchit l'écran tant qu'un traitement court — lecture du site, analyse
 * des documents. Pas d'animation : un texte qui dit ce qui se passe, et la
 * page qui se relit toutes les trois secondes, cinq minutes au plus.
 */
export function AutoRefresh({ active }: { readonly active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 5 * 60_000) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [active, router]);

  return null;
}
