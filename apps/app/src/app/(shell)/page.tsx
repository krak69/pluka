import { DomainError, getPlanOverview, type PlanOverview } from '@pluka/domain';
import Link from 'next/link';

import { signOut } from '@/app/actions';
import { Icon } from '@/components/icon';
import { listMyRaces } from '@/lib/participations';
import { planContext } from '@/lib/plan';
import { formatClock, formatDistance, formatDuration } from '@/lib/plan-format';
import { requireSession } from '@/lib/session';

/**
 * Accueil coureur — `05_ROUTES_FLOWS.md` §5.1, prototype `tab: 'accueil'`.
 *
 * La bannière de la course qu'on prépare, et tout ce qu'elle affiche existe
 * déjà : la course (date, lieux, distance, dénivelé) et son Plan (objectif,
 * arrivée estimée, marge la plus courte, §64 du moteur).
 *
 * Ce que le prototype y ajoute — jauges de matériel et de sacs, « À faire
 * maintenant » — dépend de la Préparation, qui n'est pas encore branchée.
 * L'écran ne les simule pas (AGENTS §38) : les entrées vers ces espaces le
 * disent, et les jauges apparaîtront avec eux.
 */
export const metadata = { title: 'Accueil' };

function daysUntil(startsAt: string, now: Date): number {
  const midnight = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((midnight(new Date(startsAt)) - midnight(now)) / 86_400_000);
}

function countdown(days: number): string {
  if (days === 0) return 'c’est aujourd’hui';
  if (days === 1) return 'demain';
  if (days < 0) return 'course passée';
  return `dans ${String(days)} jours`;
}

function startDay(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone }).format(
    new Date(instant),
  );
}

function thousands(value: number): string {
  return new Intl.NumberFormat('fr-FR').format(value);
}

export default async function HomePage() {
  const session = await requireSession('/');
  const races = (await listMyRaces(session)).filter((race) => race.status === 'active');
  const now = new Date();

  // La course qu'on prépare : la prochaine à venir, sinon la plus récente.
  const upcoming = races.filter((race) => daysUntil(race.startsAt, now) >= 0);
  const current = upcoming[0] ?? races[races.length - 1] ?? null;

  if (current === null) {
    return (
      <div className="ap-page hm-page">
        <section className="hm-hero" aria-labelledby="hm-title">
          <p className="hm-eyebrow">Bienvenue</p>
          <h1 id="hm-title" className="hm-title">
            Quelle course prépares-tu&nbsp;?
          </h1>
          <p className="hm-lead">
            Règlement, parcours, barrières horaires, matériel obligatoire : PLUKA part des
            informations officielles et construit ton plan de course.
          </p>
          <Link href="/recherche" className="pk-btn pk-button-primary hm-hero-cta">
            Trouver ma course
          </Link>
        </section>
        <SignOut />
      </div>
    );
  }

  const context = planContext(session);
  const participation = await context.repositories.participantRaces.findById(
    current.participantRaceId,
  );
  const race =
    participation === null ? null : await context.repositories.races.findById(participation.raceId);
  const overview: PlanOverview | null = await getPlanOverview(context, {
    participantRaceId: current.participantRaceId,
  }).catch((error: unknown) => {
    if (error instanceof DomainError) return null;
    throw error;
  });

  const timeZone = race?.timezone ?? overview?.timezone ?? 'Europe/Paris';
  const days = daysUntil(current.startsAt, now);
  const base = `/courses/${current.participantRaceId}`;
  const tight = overview?.tightestCutoff ?? null;
  const tightAlarm = tight !== null && tight.status !== 'comfortable';

  return (
    <div className="ap-page hm-page">
      <section className="hm-hero" aria-labelledby="hm-title">
        <p className="hm-eyebrow">Ma course</p>
        <h1 id="hm-title" className="hm-title">
          {current.name} <span className="hm-when">{countdown(days)}</span>
        </h1>
        <p className="hm-meta">
          <span>
            {startDay(current.startsAt, timeZone)} · {formatClock(current.startsAt, timeZone)}
            {race?.startLocationName ? ` · ${race.startLocationName}` : ''}
            {race?.finishLocationName && race.finishLocationName !== race.startLocationName
              ? ` → ${race.finishLocationName}`
              : ''}
          </span>
          {race === null ? null : (
            <span>
              {formatDistance(race.distanceKm)} km
              {race.elevationGainM === null ? '' : ` · D+ ${thousands(race.elevationGainM)} m`}
            </span>
          )}
        </p>

        {overview === null ? (
          <div className="hm-noplan">
            <p>Fixe ton objectif : PLUKA construit ton plan sur le parcours officiel.</p>
            <Link href={`${base}/objectif`} className="pk-btn pk-button-primary">
              Fixer mon objectif
            </Link>
          </div>
        ) : (
          <dl className="hm-stats">
            <div>
              <dt>Objectif</dt>
              <dd>{formatDuration(overview.targetDurationSeconds)}</dd>
            </div>
            <div>
              <dt>Arrivée estimée</dt>
              <dd className="hm-stat-lichen">
                {formatClock(
                  overview.points[overview.points.length - 1]?.plannedArrivalAt ?? overview.startAt,
                  overview.timezone,
                )}
              </dd>
            </div>
            {tight === null ? null : (
              <div>
                <dt>Marge la plus courte</dt>
                <dd className={tightAlarm ? 'hm-stat-dawn' : 'hm-stat-lichen'}>
                  {tight.marginSeconds < 0
                    ? `${formatDuration(-tight.marginSeconds)} de retard`
                    : formatDuration(tight.marginSeconds)}{' '}
                  <span className="hm-stat-where">à {tight.waypointName}</span>
                </dd>
              </div>
            )}
          </dl>
        )}
      </section>

      <ul className="hm-tiles">
        <Tile
          href={`${base}/plan`}
          label="Plan"
          action="Ouvrir"
          value={
            overview === null ? 'À construire' : formatDuration(overview.targetDurationSeconds)
          }
          detail={
            overview === null
              ? 'Ton objectif, puis tes temps de passage.'
              : `Départ ${formatClock(overview.startAt, overview.timezone)} · ${String(
                  overview.points.length,
                )} points de passage`
          }
        />
        <Tile
          href={`${base}/course`}
          label="La course"
          action="Ouvrir"
          value="Infos officielles"
          detail="Règlement, matériel obligatoire, ravitaillements, sources."
        />
        <Tile
          href={`${base}/preparation`}
          label="Préparation"
          action="Voir"
          value="Bientôt"
          detail="Matériel, sacs et liste à faire avant le départ."
          soon
        />
        <Tile
          href={`${base}/assistance`}
          label="Assistance"
          action="Voir"
          value="Bientôt"
          detail="Tes rendez-vous avec tes proches, et leur lien privé."
          soon
        />
      </ul>

      <section className="hm-season" aria-labelledby="hm-season-title">
        <div>
          <p className="hm-eyebrow">Ma saison</p>
          <p id="hm-season-title" className="hm-season-line">
            {races.length === 1
              ? '1 course en préparation'
              : `${String(races.length)} courses en préparation`}
          </p>
        </div>
        <Link href="/recherche" className="hm-season-cta">
          Ajouter une course
          <Icon name="MagnifyingGlass" size={16} />
        </Link>
      </section>

      <SignOut />
    </div>
  );
}

function Tile({
  href,
  label,
  action,
  value,
  detail,
  soon = false,
}: {
  readonly href: string;
  readonly label: string;
  readonly action: string;
  readonly value: string;
  readonly detail: string;
  readonly soon?: boolean;
}) {
  return (
    <li>
      <Link href={href} className={soon ? 'hm-tile hm-tile-soon' : 'hm-tile'}>
        <span className="hm-tile-head">
          <span className="pk-label">{label}</span>
          <span className="hm-tile-action">{action}</span>
        </span>
        <span className="hm-tile-value">{value}</span>
        <span className="hm-tile-detail">{detail}</span>
      </Link>
    </li>
  );
}

function SignOut() {
  return (
    <form action={signOut} className="hm-signout">
      <button type="submit" className="hm-signout-button">
        Se déconnecter
      </button>
    </form>
  );
}
