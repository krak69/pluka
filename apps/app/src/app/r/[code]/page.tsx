import { resolveReferralCode } from '@pluka/domain';
import { MicroLabel, SectionHeader } from '@pluka/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { referralContext } from '@/lib/referral';

/**
 * Le lien que l'organisation colle dans sa confirmation d'inscription — canal A
 * (00_PRODUCT_SPEC §6.5.4, 0087).
 *
 * Il mène aux épreuves de l'édition ; le code suit le coureur dans l'adresse
 * jusqu'à la validation de sa course (décision du 2026-11-12). Aucun cookie :
 * l'attribution n'est posée qu'au moment où le coureur ajoute sa course, et
 * le prix ne dépend jamais du canal.
 *
 * Non indexée : l'en-tête de `next.config.ts` couvre tout ce qui n'est pas
 * `/epreuves`.
 */
export const metadata: Metadata = { title: 'Prépare ta course' };

/** Le jour du départ, dans le fuseau de l'épreuve. */
function formatStart(instant: string | null, timeZone: string): string | null {
  if (instant === null) return null;
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone }).format(date);
}

export default async function ReferralPage({
  params,
}: {
  readonly params: Promise<{ readonly code: string }>;
}) {
  const { code } = await params;
  const resolved = await resolveReferralCode(referralContext(null), { code });

  if (resolved === null) {
    return (
      <main className="rp-page">
        <SectionHeader eyebrow="PLUKA" title="Ce lien n’est plus actif" />
        <p className="pk-body rp-measure">
          Le lien de ta confirmation d’inscription ne mène plus nulle part. Tu peux retrouver ta
          course depuis l’accueil de PLUKA.
        </p>
        <p className="pk-body">
          <Link href="/" className="pk-link">
            Aller à l’accueil
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="rp-page">
      <SectionHeader
        eyebrow={`${resolved.eventName} · ${String(resolved.editionYear)}`}
        title="Tu es inscrit. Maintenant, prépare ta course."
      />
      <p className="pk-body rp-measure">
        PLUKA construit ton plan à partir du parcours réel et des informations officielles de ta
        course : temps de passage, barrières horaires, ravitos, nutrition, assistance. Choisis ton
        épreuve.
      </p>

      {resolved.races.length === 0 ? (
        <p className="pk-field-hint">
          Les épreuves de cette édition ne sont pas encore ouvertes sur PLUKA. Reviens bientôt.
        </p>
      ) : (
        <ul className="cr-facts" aria-label="Épreuves de l’édition">
          {resolved.races.map((race) => {
            const start = formatStart(race.startDatetime, race.timezone);
            return (
              <li key={race.slug} className="cr-fact">
                <Link
                  href={`/epreuves/${resolved.eventSlug}/${resolved.editionSlug}/${race.slug}?code=${resolved.code}`}
                  className="pk-link cr-fact-value"
                >
                  {race.name}
                </Link>
                <span className="or-row-meta">
                  <MicroLabel>
                    {[race.distanceKm === null ? null : `${String(race.distanceKm)} km`, start]
                      .filter((part) => part !== null)
                      .join(' · ')}
                  </MicroLabel>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
