import { getAssistantPage, type AssistantPageRendezvous } from '@pluka/domain';
import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { assistantPageContext } from '@/lib/assistance';
import { formatClock, formatDistance } from '@/lib/plan-format';
import { underRateLimit } from '@/lib/rate-limit';

/**
 * Page de l'accompagnant — `/a/[token]` ; 05_ROUTES_FLOWS §1.5, §4.1 ;
 * 03_PRIVACY_RLS §44 à §47, §128, §129 ; 06_DESIGN_SYSTEM §124.
 *
 * Aucune session, aucun compte. Le jeton ne quitte pas le serveur : il est
 * haché ici, et la base ne rend qu'une projection sûre (§46). Mobile d'abord,
 * sans navigation PLUKA : le prochain rendez-vous, son heure et sa fenêtre, le
 * lieu, ce qu'il faut apporter, puis les rendez-vous suivants.
 *
 * Jamais indexée et sans referrer (en-têtes de `next.config.ts`), sans aucun
 * script tiers. Rendue à chaque demande : un lien révoqué ne sert plus rien,
 * aucun cache ne garde la page (§47).
 */
export const metadata: Metadata = {
  title: 'Assistance',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const dynamic = 'force-dynamic';

/** 60 ouvertures par tranche de 5 minutes et par adresse : large pour un accompagnant. */
const LIMIT = 60;
const WINDOW_MS = 5 * 60 * 1000;

function dayAndTime(instant: string, timeZone: string): string {
  const day = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(new Date(instant));
  return `${day} · ${formatClock(instant, timeZone)}`;
}

function Shell({ children }: { readonly children: React.ReactNode }) {
  return <main className="ax-page">{children}</main>;
}

function Closed({ title, text }: { readonly title: string; readonly text: string }) {
  return (
    <Shell>
      <section className="ax-closed" aria-labelledby="ax-closed-title">
        <p className="ax-eyebrow">Lien privé PLUKA</p>
        <h1 id="ax-closed-title" className="ax-title">
          {title}
        </h1>
        <p className="ax-text">{text}</p>
      </section>
    </Shell>
  );
}

export default async function AssistantPage({
  params,
}: {
  readonly params: Promise<{ readonly token: string }>;
}) {
  const { token } = await params;
  const forwarded = (await headers()).get('x-forwarded-for') ?? '';
  const address = forwarded.split(',')[0]?.trim() || 'inconnue';

  if (!underRateLimit(`assistant:${address}`, LIMIT, WINDOW_MS)) {
    return (
      <Closed
        title="Trop de demandes"
        text="Ce lien a été ouvert trop souvent d’un coup. Réessaie dans quelques minutes."
      />
    );
  }

  const page = await getAssistantPage(assistantPageContext(), token);

  if (page.state === 'expired') {
    return (
      <Closed
        title="Ce lien a expiré"
        text="La course est terminée depuis plus de trois jours. Si tu en as encore besoin, demande un nouveau lien au coureur."
      />
    );
  }
  if (page.state !== 'valid') {
    return (
      <Closed
        title="Ce lien n’est plus valable"
        text="Il a peut-être été remplacé par un nouveau. Demande au coureur de te renvoyer son lien."
      />
    );
  }

  // Un compte sans prénom : la page parle « du coureur », sans inventer de nom.
  const runner = page.runnerFirstName ?? 'le coureur';
  const title =
    page.runnerFirstName === null ? 'Ton espace d’assistance' : `Assistance de ${runner}`;
  // Une épreuve qui porte le nom de l'événement ne se répète pas.
  const where =
    page.eventName === null || page.eventName === page.raceName
      ? page.raceName
      : `${page.eventName} · ${page.raceName}`;
  const freshness =
    page.planUpdatedAt === null
      ? `Heures estimées d’après le plan de course de ${runner}.`
      : `Heures estimées d’après le plan de course de ${runner}, mis à jour le ${dayAndTime(page.planUpdatedAt, page.timezone)}.`;
  const next = page.nextIndex === null ? null : page.rendezvous[page.nextIndex];
  const others = page.rendezvous.filter((_, index) => index !== page.nextIndex);

  return (
    <Shell>
      <header className="ax-head">
        <p className="ax-eyebrow">Lien privé · Assistance</p>
        <h1 className="ax-title">{title}</h1>
        <p className="ax-text">{where}</p>
      </header>

      {next === null || next === undefined ? (
        <section className="ax-card">
          <h2 className="ax-point">Aucun rendez-vous pour l’instant</h2>
          <p className="ax-text">
            {page.runnerFirstName ?? 'Le coureur'} n’a pas encore indiqué où le retrouver. Le lien
            reste le même : reviens plus tard.
          </p>
        </section>
      ) : (
        <Rendezvous rendezvous={next} timezone={page.timezone} label="Prochain rendez-vous" first />
      )}

      {others.length === 0 ? null : (
        <section aria-labelledby="ax-others-title" className="ax-others">
          <h2 id="ax-others-title" className="ax-eyebrow">
            Tes autres rendez-vous
          </h2>
          {others.map((entry) => (
            <Rendezvous
              key={`${entry.pointName}-${String(entry.distanceKm)}`}
              rendezvous={entry}
              timezone={page.timezone}
            />
          ))}
        </section>
      )}

      <footer className="ax-foot">
        <p>
          {freshness} Ce n’est pas un suivi en direct : la fenêtre est une marge de planification.
        </p>
      </footer>
    </Shell>
  );
}

function Rendezvous({
  rendezvous,
  timezone,
  label,
  first = false,
}: {
  readonly rendezvous: AssistantPageRendezvous;
  readonly timezone: string;
  readonly label?: string;
  readonly first?: boolean;
}) {
  const passage = rendezvous.passage;

  return (
    <section className={first ? 'ax-card ax-card-next' : 'ax-card'}>
      {label === undefined ? null : <p className="ax-eyebrow ax-eyebrow-next">{label}</p>}
      <h2 className="ax-point">{rendezvous.pointName}</h2>
      <p className="ax-km">km {formatDistance(rendezvous.distanceKm)}</p>

      {passage === null ? (
        <p className="ax-text">L’heure de passage n’est pas encore estimée.</p>
      ) : (
        <dl className="ax-times">
          <div>
            <dt>Passage estimé</dt>
            <dd className="ax-time">{formatClock(passage.at, timezone)}</dd>
            <dd className="ax-day">{dayAndTime(passage.at, timezone).split(' · ')[0]}</dd>
          </div>
          <div>
            <dt>Fenêtre probable</dt>
            <dd className="ax-time">
              {formatClock(passage.windowStart, timezone)} –{' '}
              {formatClock(passage.windowEnd, timezone)}
            </dd>
            <dd className="ax-day">Sois sur place avant le début de la fenêtre.</dd>
          </div>
        </dl>
      )}

      <h3 className="ax-sub">À apporter</h3>
      {rendezvous.items.length === 0 ? (
        <p className="ax-text">Rien de particulier.</p>
      ) : (
        <ul className="ax-items">
          {rendezvous.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}

      {rendezvous.instructions === null ? null : (
        <>
          <h3 className="ax-sub">Consignes</h3>
          <p className="ax-text ax-instructions">{rendezvous.instructions}</p>
        </>
      )}
    </section>
  );
}
