'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';

import { Icon } from '@/components/icon';

/**
 * Tiroir ouvert par une route interceptée — prototype, `tiersOpen` : il glisse
 * de la droite par-dessus l'écran en cours, et devient une feuille montante sur
 * mobile.
 *
 * Il a une adresse : fermer, c'est revenir à l'écran d'où il a été ouvert.
 * Échap, le voile et la croix ferment ; le focus entre dans le tiroir à
 * l'ouverture et la page derrière ne défile plus (WCAG 2.4.3, 2.1.2).
 */
export function SideDrawer({
  labelledBy,
  children,
}: {
  readonly labelledBy: string;
  readonly children: ReactNode;
}) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') router.back();
      if (event.key !== 'Tab' || panel.current === null) return;
      // Le focus reste dans le tiroir tant qu'il est ouvert.
      const focusables = panel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([type="hidden"]), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [router]);

  return (
    <div className="sd-layer">
      <div className="sd-scrim" aria-hidden="true" onClick={() => router.back()} />
      <div
        ref={panel}
        className="sd-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        <button
          type="button"
          className="ap-drawer-close sd-close"
          aria-label="Fermer"
          onClick={() => router.back()}
        >
          <Icon name="X" size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}
