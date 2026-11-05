'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Relit l'écran toutes les cinq secondes tant qu'une analyse court, dix minutes au plus. */
export function AutoRefresh({ active }: { readonly active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 10 * 60_000) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [active, router]);

  return null;
}
