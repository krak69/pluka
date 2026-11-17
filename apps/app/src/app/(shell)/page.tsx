import {
  DomainError,
  getBags,
  getAssistance,
  getEquipmentChecklist,
  getPlanOverview,
  getTasks,
  nextActions,
  type AssistanceOverview,
  type NextAction,
} from '@pluka/domain';
import Link from 'next/link';

import { signOut } from '@/app/actions';
import { Icon, type IconName } from '@/components/icon';
import { dueCalendarDay, dueDelay } from '@/lib/due-day';
import { listMyRaces } from '@/lib/participations';
import { planContext } from '@/lib/plan';
import { formatClock, formatDistance, formatDuration } from '@/lib/plan-format';
import { assistanceContext } from '@/lib/assistance';
import { bagsContext, preparationContext, tasksContext } from '@/lib/preparation';
import { requireSession } from '@/lib/session';

/**
 * Accueil coureur — `05_ROUTES_FLOWS.md` §5.1, prototype `tab: 'accueil'`.
 *
 * La bannière de la course qu'on prépare : la course (date, lieux, distance,
 * dénivelé), son Plan (objectif, arrivée estimée, marge la plus courte, §64 du
 * moteur) et trois jauges de Préparation — matériel obligatoire, sacs, « Mes
 * tâches ». Dessous, « À faire maintenant » : cinq lignes au plus, rangées par
 * `nextActions` (décisions produit du 2026-11-17). Tout se lit sans Race Pass.
 */
export const metadata = { title: 'Accueil' };

const SHOWN_ACTIONS = 5;

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

/**
 * Une lecture refusée par le domaine (participation introuvable, course non
 * publiée) retire sa section, pas l'Accueil (AGENTS §37).
 */
async function orNull<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof DomainError) return null;
    throw error;
  }
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
  const input = { participantRaceId: current.participantRaceId };
  const participation = await context.repositories.participantRaces.findById(
    current.participantRaceId,
  );
  const [race, overview, equipment, bags, tasks, assistance] = await Promise.all([
    participation === null ? null : context.repositories.races.findById(participation.raceId),
    orNull(getPlanOverview(context, input)),
    orNull(getEquipmentChecklist(preparationContext(session), input)),
    orNull(getBags(bagsContext(session), input)),
    orNull(getTasks(tasksContext(session), input)),
    orNull(getAssistance(assistanceContext(session), input)),
  ]);
  const actions = nextActions({
    mandatory: equipment?.mandatory ?? null,
    bags: bags?.bags ?? [],
    tasks: tasks?.mine ?? [],
  });

  const timeZone = race?.timezone ?? overview?.timezone ?? 'Europe/Paris';
  const days = daysUntil(current.startsAt, now);
  const base = `/courses/${current.participantRaceId}`;
  const tight = overview?.tightestCutoff ?? null;
  const tightAlarm = tight !== null && tight.status !== 'comfortable';
  const gauges = [
    equipment === null
      ? null
      : {
          label: 'Matériel obligatoire',
          ...equipment.mandatory,
          value:
            equipment.mandatory.total === 0
              ? 'Aucun publié'
              : `${String(equipment.mandatory.ready)} / ${String(equipment.mandatory.total)} prêts`,
        },
    bags === null
      ? null
      : {
          label: 'Sacs',
          ...bags.ready,
          value:
            bags.ready.total === 0
              ? 'Aucun sac'
              : `${String(bags.ready.ready)} / ${String(bags.ready.total)} prêts`,
        },
    tasks === null
      ? null
      : {
          label: 'À faire',
          ready: tasks.progress.done,
          total: tasks.progress.total,
          value:
            tasks.progress.total === 0
              ? 'Aucune tâche'
              : `${String(tasks.progress.done)} / ${String(tasks.progress.total)} terminées`,
        },
  ].filter((gauge) => gauge !== null);
  const preparationRead = equipment !== null || bags !== null || tasks !== null;

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

        {gauges.length === 0 ? null : (
          <ul className="hm-gauges" aria-label="Préparation">
            {gauges.map((gauge) => (
              <li key={gauge.label} className="hm-gauge">
                <span className="hm-gauge-head">
                  <span className="hm-gauge-label">{gauge.label}</span>
                  <span className="hm-gauge-value">{gauge.value}</span>
                </span>
                {/* Décorative : le chiffre ci-dessus dit déjà la même chose (§172). */}
                <span className="hm-gauge-track" aria-hidden="true">
                  <span
                    className="hm-gauge-fill"
                    style={{
                      width: `${String(
                        gauge.total === 0 ? 0 : Math.round((gauge.ready / gauge.total) * 100),
                      )}%`,
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {preparationRead ? <NextActions actions={actions} base={base} /> : null}

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
          action="Ouvrir"
          value={actions.length === 0 ? 'À jour' : plural(actions.length, 'action', 'actions')}
          detail="Matériel obligatoire, sacs et liste à faire avant le départ."
        />
        <Tile
          href={`${base}/assistance`}
          label="Assistance"
          action={assistance?.status === 'enabled' ? 'Voir' : 'Configurer'}
          value={assistanceValue(assistance)}
          detail={assistanceDetail(assistance)}
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

/** La case Assistance — prototype, `assistHeadline` / `assistSub`. */
function assistanceValue(assistance: AssistanceOverview | null): string {
  if (assistance === null || assistance.status === 'to_define') return 'À définir';
  if (assistance.status === 'autonomous') return 'Autonome';
  return assistance.people.length === 0
    ? 'Avec assistance'
    : assistance.people.map((person) => person.firstName).join(', ');
}

function assistanceDetail(assistance: AssistanceOverview | null): string {
  if (assistance === null || assistance.status === 'to_define') {
    return 'Dis si quelqu’un pourra te retrouver pendant la course.';
  }
  if (assistance.status === 'autonomous') return 'Aucune assistance prévue pour cette course.';
  const points = [
    ...new Set(
      assistance.people.flatMap((person) =>
        person.rendezvous.flatMap((rendezvous) =>
          rendezvous.point === null ? [] : [rendezvous.point.name],
        ),
      ),
    ),
  ];
  return points.length === 0 ? 'Ajoute tes rendez-vous.' : points.join(' · ');
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count > 1 ? many : one}`;
}

/** Une ligne de « À faire maintenant » : icône, titre, raison, destination (DS §165). */
function describe(
  action: NextAction,
  base: string,
): {
  key: string;
  icon: IconName;
  title: string;
  reason: string | null;
  late: boolean;
  href: string;
} {
  switch (action.kind) {
    case 'task':
      return {
        key: `task:${action.id}`,
        icon: 'ListChecks',
        title: action.title,
        reason:
          action.dueDay === null || action.daysLeft === null
            ? null
            : `${dueCalendarDay(action.dueDay, action.daysLeft)} · ${dueDelay(action.daysLeft)}`,
        late: action.daysLeft !== null && action.daysLeft < 0,
        href: `${base}/preparation/todo`,
      };
    case 'mandatory_equipment':
      return {
        key: 'mandatory_equipment',
        icon: 'TShirt',
        title: 'Rassembler le matériel obligatoire',
        reason: `${plural(action.missing, 'pièce manquante', 'pièces manquantes')} sur ${String(action.total)}`,
        late: false,
        href: `${base}/preparation/materiel`,
      };
    case 'bag':
      return {
        key: `bag:${action.id}`,
        icon: 'Backpack',
        title: `Préparer : ${action.name}`,
        reason:
          action.total === 0
            ? 'Vide pour l’instant'
            : `${String(action.checked)} / ${String(action.total)} cochés`,
        late: false,
        href: `${base}/preparation/sacs#bag-${action.id}`,
      };
  }
}

function NextActions({
  actions,
  base,
}: {
  readonly actions: readonly NextAction[];
  readonly base: string;
}) {
  const shown = actions.slice(0, SHOWN_ACTIONS);

  return (
    <section className="hm-todo" aria-labelledby="hm-todo-title">
      <header className="hm-todo-head">
        <h2 id="hm-todo-title" className="hm-todo-title">
          À faire maintenant
        </h2>
        <span className="hm-todo-count">
          {actions.length > SHOWN_ACTIONS
            ? `${String(SHOWN_ACTIONS)} sur ${String(actions.length)}`
            : plural(actions.length, 'élément', 'éléments')}
        </span>
      </header>
      {shown.length === 0 ? (
        <p className="hm-todo-empty">Tout est à jour. Rien d’urgent dans ta préparation.</p>
      ) : (
        <ul className="hm-todo-list">
          {shown.map((action) => {
            const line = describe(action, base);
            return (
              <li key={line.key}>
                <Link href={line.href} className="hm-todo-row">
                  <span className="hm-todo-icon" aria-hidden="true">
                    <Icon name={line.icon} />
                  </span>
                  <span className="hm-todo-text">
                    <span className="hm-todo-label">{line.title}</span>
                    {line.reason === null ? null : (
                      <span
                        className={line.late ? 'hm-todo-reason hm-todo-late' : 'hm-todo-reason'}
                      >
                        {line.reason}
                      </span>
                    )}
                  </span>
                  <span className="hm-todo-arrow" aria-hidden="true">
                    <Icon name="ArrowRight" size={16} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {actions.length > SHOWN_ACTIONS ? (
        <Link href={`${base}/preparation`} className="hm-todo-more">
          Tout voir dans Préparation
        </Link>
      ) : null}
    </section>
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
