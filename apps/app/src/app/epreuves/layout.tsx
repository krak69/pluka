import type { ReactNode } from 'react';

/**
 * Zone publique de l'épreuve — `05_ROUTES_FLOWS.md` §4.3.
 *
 * Aucun shell : la page se lit sans session, et une navigation authentifiée
 * autour d'elle n'aurait pas de sens. C'est pour cela qu'elle vit hors du
 * groupe `(shell)`.
 *
 * C'est aussi la seule zone indexable de l'application. L'exemption de
 * `X-Robots-Tag` est posée dans `next.config.ts` ; le `noindex` d'une course
 * `unlisted` est décidé par la page, qui seule connaît sa visibilité.
 */
export default function EpreuvesLayout({ children }: { readonly children: ReactNode }) {
  return <div className="rp-public">{children}</div>;
}
