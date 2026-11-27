import type { PlanPointView, PlanProfileSample } from '@pluka/domain';
import { MicroLabel } from '@pluka/ui';

import { ProfileLayers } from '@/app/(shell)/courses/[participantRaceId]/plan/profile-layers';
import { Icon } from '@/components/icon';
import type { ProfileWeather, ProfileWeatherMark } from '@/lib/conditions-format';
import type { ProfileIntake } from '@/lib/nutrition-format';
import { formatClock, formatDistance } from '@/lib/plan-format';

/**
 * Profil d'altitude — 06_DESIGN_SYSTEM.md §47, §48, §49, §51.
 *
 * « Le profil devient un composant. Il ne doit pas être traité comme un simple
 * graphique analytique. » Il exprime la progression, la difficulté et les
 * jalons — pas une courbe de plus dans un tableau de bord.
 *
 * TOUT EST CALCULÉ AVANT D'ARRIVER ICI
 *
 * Server Component : la géométrie SVG est construite au rendu serveur, à
 * partir des échantillons que `getPlanOverview` a produits. Le navigateur
 * reçoit un chemin, pas une série à projeter. Aucune allure, aucun horaire,
 * aucune altitude n'est dérivée dans le client.
 *
 * §51 : « toujours fournir une représentation textuelle équivalente. Un SVG /
 * canvas n'est jamais la seule source de l'information. » La liste des
 * passages suit donc le tracé, lisible sans image et sans JavaScript — et
 * c'est elle que la table du Plan détaille ensuite.
 *
 * §49 fixe le langage des jalons : triangle Aube pour la prochaine action,
 * cercle Lichen pour l'étape franchie. Un Plan d'avant-course n'a pas encore
 * de passage franchi ; les jalons y sont donc des points neutres, l'arrivée
 * seule portant le triangle Aube — c'est la prochaine échéance du coureur.
 */

const VIEW_WIDTH = 720;
const VIEW_HEIGHT = 180;
/** Marge basse : le tracé ne colle pas à l'axe, les jalons y respirent. */
const PADDING = 12;

interface Bounds {
  readonly minElevation: number;
  readonly maxElevation: number;
  readonly totalDistanceKm: number;
}

function bounds(profile: readonly PlanProfileSample[]): Bounds {
  const elevations = profile.map((sample) => sample.elevationMeters);

  return {
    minElevation: Math.min(...elevations),
    maxElevation: Math.max(...elevations),
    totalDistanceKm: profile[profile.length - 1]?.distanceKm ?? 0,
  };
}

function project(sample: PlanProfileSample, box: Bounds): { x: number; y: number } {
  const span = box.maxElevation - box.minElevation;
  const x = box.totalDistanceKm === 0 ? 0 : (sample.distanceKm / box.totalDistanceKm) * VIEW_WIDTH;
  // Un profil parfaitement plat n'a pas d'amplitude : le tracer au milieu
  // évite une division par zéro et dit la vérité — il ne monte pas.
  const ratio = span === 0 ? 0.5 : (sample.elevationMeters - box.minElevation) / span;

  return { x, y: VIEW_HEIGHT - PADDING - ratio * (VIEW_HEIGHT - 2 * PADDING) };
}

export interface AltitudeProfileProps {
  readonly profile: readonly PlanProfileSample[];
  readonly points: readonly PlanPointView[];
  readonly timezone: string;
  /** Faux quand aucune altitude officielle n'ancre la courbe (§54, point 8). */
  readonly anchored: boolean;
  /**
   * `dark` : dans la bannière du Plan (prototype) — tracé Lichen sur Ardoise,
   * noms des points sous la courbe, et la liste des passages gardée pour les
   * lecteurs d'écran seulement, la frise du Plan la montrant déjà à tous.
   */
  readonly variant?: 'light' | 'dark';
  /** Les points porteurs d'une barrière, marqués en Aube (§49). */
  readonly cutoffWaypointIds?: readonly string[];
  /**
   * Les prises de la stratégie Nutrition, posées sur la courbe (prototype
   * `planNutMarks`) ; `off` quand la Nutrition n'est pas activée, et la puce
   * « + Nutrition » mène alors au bandeau qui l'active.
   */
  readonly nutrition?:
    | { readonly state: 'ready'; readonly intakes: readonly ProfileIntake[] }
    | { readonly state: 'off' }
    | null;
  /**
   * La météo à chaque point, à l'heure du passage (Conditions J-14), sur le
   * profil sombre seulement ; nulle hors fenêtre ou sans droit. Un picto mène
   * à l'écran Conditions, qui la détaille.
   */
  readonly weather?: (ProfileWeather & { readonly href: string }) | null;
}

export function AltitudeProfile({
  profile,
  points,
  timezone,
  anchored,
  variant = 'light',
  cutoffWaypointIds = [],
  nutrition = null,
  weather = null,
}: AltitudeProfileProps) {
  const dark = variant === 'dark';
  const forecast = dark ? weather : null;
  const weatherByWaypoint = new Map(
    (forecast?.marks ?? []).flatMap((mark) =>
      mark.raceWaypointId === null ? [] : [[mark.raceWaypointId, mark.text] as const],
    ),
  );
  const passages = points.map((point) => ({
    name: point.name,
    clock: formatClock(point.plannedArrivalAt, timezone),
    weather: weatherByWaypoint.get(point.raceWaypointId) ?? null,
  }));

  if (profile.length < 2) {
    // Sans parcours prétraité, pas de courbe — mais les passages restent
    // lisibles. §51 : le texte n'est pas un repli, c'est la source.
    return (
      <PassageList
        passages={passages}
        note="Le profil du parcours n’est pas encore disponible."
        dark={dark}
      />
    );
  }

  const box = bounds(profile);
  const projected = profile.map((sample) => project(sample, box));

  const line = projected
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ');

  const area = `${line} L${VIEW_WIDTH} ${VIEW_HEIGHT} L0 ${VIEW_HEIGHT} Z`;

  const markers = points.map((point, index) => ({
    point,
    position: project(
      { distanceKm: point.distanceKm, elevationMeters: elevationAt(profile, point.distanceKm) },
      box,
    ),
    isFinish: index === points.length - 1,
  }));

  // Noms sous la courbe : départ, arrivée et barrières, sans chevauchement.
  const labels = dark ? profileLabels(markers, cutoffWaypointIds) : [];

  // Le SVG sombre s'étire en largeur (`preserveAspectRatio="none"`) : un cercle
  // y deviendrait une ellipse, un triangle s'y aplatirait. Ses jalons et les
  // prises sont donc posés en HTML au-dessus du tracé, en pourcentage — ils
  // restent ronds à toute largeur, et une prise garde une cible cliquable.
  const percent = (position: { x: number; y: number }) => ({
    left: Math.min(100, Math.max(0, (position.x / VIEW_WIDTH) * 100)),
    top: (position.y / VIEW_HEIGHT) * 100,
  });

  const intakes = (nutrition?.state === 'ready' ? nutrition.intakes : []).map((intake) => ({
    ...intake,
    ...percent(
      project(
        { distanceKm: intake.distanceKm, elevationMeters: elevationAt(profile, intake.distanceKm) },
        box,
      ),
    ),
  }));

  const stations = forecast === null ? [] : weatherStations(forecast.marks, points, profile, box);

  return (
    <section className={dark ? 'pl-profile pl-profile-dark' : 'pl-profile'}>
      <ProfileLayers
        title={
          <MicroLabel className={dark ? 'pl-label-dark' : undefined}>Profil du parcours</MicroLabel>
        }
        nutrition={
          nutrition === null
            ? null
            : nutrition.state === 'off'
              ? 'activate'
              : intakes.length > 0
                ? 'toggle'
                : null
        }
        weather={stations.length > 0}
      >
        <div
          className={stations.length > 0 ? 'pl-profile-plot pl-profile-plot-wx' : 'pl-profile-plot'}
        >
          {stations.length === 0 || forecast === null ? null : (
            // Un raccourci vers Conditions pour la souris et le doigt ; le texte
            // équivalent suit chaque passage, dans la liste plus bas (§51).
            <div className="pl-weather" aria-hidden="true">
              {stations.map((station) => (
                <a
                  key={station.key}
                  href={forecast.href}
                  tabIndex={-1}
                  title={station.text}
                  className={station.compact ? 'pl-wx' : 'pl-wx pl-wx-wide'}
                  style={{
                    // Le départ et l'arrivée tombent au bord : le picto reste dans le cadre.
                    left: `clamp(var(--pl-wx-half), ${station.left.toFixed(2)}%, calc(100% - var(--pl-wx-half)))`,
                  }}
                >
                  {station.icon === null ? null : <Icon name={station.icon} size={20} />}
                  <span className="pl-wx-temp">{station.temperature}</span>
                </a>
              ))}
            </div>
          )}
          <svg
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio={dark ? 'none' : 'xMidYMid meet'}
            role="img"
            aria-label={`Profil du parcours, ${formatDistance(box.totalDistanceKm)} kilomètres`}
            className="pl-profile-svg"
          >
            <path
              d={area}
              fill={
                dark
                  ? 'color-mix(in srgb, var(--pk-lichen) 13%, transparent)'
                  : 'var(--pk-glacier-bg)'
              }
            />
            <path
              d={line}
              fill="none"
              stroke={dark ? 'var(--pk-lichen)' : 'var(--pk-forest)'}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />

            {dark
              ? null
              : markers.map(({ point, position, isFinish }) =>
                  isFinish ? (
                    // §49 : triangle Aube = prochaine action. Avant la course,
                    // l'arrivée est l'échéance qui compte.
                    <polygon
                      key={point.raceWaypointId}
                      points={`${position.x},${position.y - 7} ${position.x - 6},${position.y + 4} ${position.x + 6},${position.y + 4}`}
                      fill="var(--pk-dawn)"
                    />
                  ) : (
                    <circle
                      key={point.raceWaypointId}
                      cx={position.x}
                      cy={position.y}
                      r={4}
                      fill={
                        cutoffWaypointIds.includes(point.raceWaypointId)
                          ? 'var(--pk-dawn)'
                          : 'var(--pk-surface)'
                      }
                      stroke="var(--pk-forest)"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                  ),
                )}
          </svg>

          {stations.length === 0 ? null : (
            // Le fil qui relie un picto à son point, sous les jalons et les prises.
            // Pas au départ ni à l'arrivée : ils longeraient le bord du cadre.
            <div className="pl-wx-stems" aria-hidden="true">
              {stations
                .filter((station) => !station.edge)
                .map((station) => (
                  <span
                    key={station.key}
                    className={station.compact ? 'pl-wx-stem' : 'pl-wx-stem pl-wx-wide'}
                    style={{
                      left: `${station.left.toFixed(2)}%`,
                      height: `max(0px, calc(${station.top.toFixed(2)}% - var(--pl-wx-gap)))`,
                    }}
                  />
                ))}
            </div>
          )}

          {intakes.length === 0 ? null : (
            // Un raccourci pour la souris et le doigt : chaque prise est détaillée,
            // et atteignable au clavier, dans « Ma stratégie » juste dessous (§51).
            <div className="pl-intakes" aria-hidden="true">
              {intakes.map((intake) => (
                <a
                  key={intake.key}
                  href={`#${intake.anchor}`}
                  className="pl-intake"
                  style={{ left: `${intake.left.toFixed(2)}%`, top: `${intake.top.toFixed(2)}%` }}
                  title={intake.label}
                  tabIndex={-1}
                />
              ))}
            </div>
          )}

          {dark ? (
            // Après les prises : un jalon du parcours passe au-dessus. Le texte
            // équivalent est la liste des passages, plus bas (§51).
            <div className="pl-waypoints" aria-hidden="true">
              {markers.map(({ point, position, isFinish }) => {
                const { left, top } = percent(position);
                return (
                  <span
                    key={point.raceWaypointId}
                    className={
                      isFinish
                        ? 'pl-waypoint pl-waypoint-finish'
                        : cutoffWaypointIds.includes(point.raceWaypointId)
                          ? 'pl-waypoint pl-waypoint-cutoff'
                          : 'pl-waypoint'
                    }
                    style={{ left: `${left.toFixed(2)}%`, top: `${top.toFixed(2)}%` }}
                  />
                );
              })}
            </div>
          ) : null}
        </div>

        {labels.length === 0 ? null : (
          <div className="pl-profile-labels" aria-hidden="true">
            {labels.map((label) => (
              <span
                key={label.key}
                className="pl-profile-label"
                style={{ left: `${label.left.toFixed(2)}%`, transform: label.shift }}
              >
                {label.name}
              </span>
            ))}
          </div>
        )}

        {dark ? (
          <p className="pl-profile-legend" aria-hidden="true">
            <span className="pl-legend-dot pl-legend-cutoff" /> Barrière horaire
            <span className="pl-legend-dot pl-legend-point" /> Point de passage
            <span className="pl-legend-tri" /> Arrivée
            {intakes.length === 0 ? null : (
              <span className="pl-legend-intake-item">
                <span className="pl-legend-dot pl-legend-intake" /> Prise nutrition
              </span>
            )}
          </p>
        ) : null}

        {stations.length === 0 || forecast === null ? null : (
          // §53 : une prévision externe, datée, et sa source à côté de la donnée.
          <p className="pl-wx-source">
            Météo à ton passage · prévision externe, mise à jour {forecast.updated} ·{' '}
            <a href={forecast.attribution.url} target="_blank" rel="noreferrer">
              {forecast.attribution.text}
            </a>{' '}
            ·{' '}
            <a href={forecast.attribution.licenceUrl} target="_blank" rel="noreferrer">
              {forecast.attribution.licence}
            </a>
          </p>
        )}

        <PassageList
          passages={passages}
          dark={dark}
          {...(anchored
            ? {}
            : {
                note: 'Altitudes relatives au départ : aucune altitude officielle n’est renseignée.',
              })}
        />
      </ProfileLayers>
    </section>
  );
}

/** Les noms placés sous la courbe, en pourcentage de sa largeur. */
function profileLabels(
  markers: readonly {
    readonly point: PlanPointView;
    readonly position: { readonly x: number };
    readonly isFinish: boolean;
  }[],
  cutoffWaypointIds: readonly string[],
): readonly { key: string; name: string; left: number; shift: string }[] {
  const keep: { key: string; name: string; left: number; shift: string }[] = [];
  const MIN_GAP = 9;
  markers.forEach(({ point, position, isFinish }, index) => {
    const first = index === 0;
    if (!first && !isFinish && !cutoffWaypointIds.includes(point.raceWaypointId)) return;
    const left = (position.x / VIEW_WIDTH) * 100;
    const previous = keep[keep.length - 1];
    if (previous !== undefined && left - previous.left < MIN_GAP) {
      if (!isFinish) return;
      keep.pop();
    }
    keep.push({
      key: point.raceWaypointId,
      name: point.name,
      left,
      shift: first ? 'none' : isFinish ? 'translateX(-100%)' : 'translateX(-50%)',
    });
  });
  return keep;
}

/**
 * Écart minimal entre deux pictos, en pourcentage de la largeur : un picto
 * fait environ 36 px. `compact` tient sur un profil de 340 px (mobile), le
 * reste n'apparaît qu'à partir de 720 px environ.
 */
const WEATHER_GAP_COMPACT = 17;
const WEATHER_GAP_WIDE = 8;

interface WeatherStation {
  readonly key: string;
  readonly icon: ProfileWeatherMark['icon'];
  readonly temperature: string;
  readonly text: string;
  readonly left: number;
  readonly top: number;
  /** Départ ou arrivée : posé au bord, sans fil. */
  readonly edge: boolean;
  /** Assez espacé pour rester affiché sur un profil étroit. */
  readonly compact: boolean;
}

/**
 * Les pictos à poser, sans chevauchement. Le départ et l'arrivée d'abord,
 * puis les points les plus hauts : c'est là que les conditions durcissent.
 * Un point écarté reste détaillé dans Conditions et dans la liste des passages.
 */
function weatherStations(
  marks: readonly ProfileWeatherMark[],
  points: readonly PlanPointView[],
  profile: readonly PlanProfileSample[],
  box: Bounds,
): readonly WeatherStation[] {
  const pointDistance = new Map(points.map((point) => [point.raceWaypointId, point.distanceKm]));

  const candidates = marks.map((mark) => {
    // Sur le jalon du Plan quand il existe : le picto tombe pile au-dessus du point.
    const distanceKm =
      (mark.raceWaypointId === null ? undefined : pointDistance.get(mark.raceWaypointId)) ??
      mark.distanceKm;
    const elevation = elevationAt(profile, distanceKm);
    const position = project({ distanceKm, elevationMeters: elevation }, box);
    const left = Math.min(100, Math.max(0, (position.x / VIEW_WIDTH) * 100));
    return {
      mark,
      distanceKm,
      elevation,
      edge: left < 1 || left > 99,
      left,
      top: (position.y / VIEW_HEIGHT) * 100,
    };
  });

  const ranked = [...candidates].sort(
    (a, b) =>
      Number(b.edge) - Number(a.edge) || b.elevation - a.elevation || a.distanceKm - b.distanceKm,
  );

  const pick = (gap: number, from: readonly (typeof candidates)[number][]) => {
    const kept: (typeof candidates)[number][] = [];
    for (const candidate of ranked) {
      if (!from.includes(candidate)) continue;
      if (kept.every((other) => Math.abs(other.left - candidate.left) >= gap)) kept.push(candidate);
    }
    return kept;
  };

  const wide = pick(WEATHER_GAP_WIDE, candidates);
  const compact = new Set(pick(WEATHER_GAP_COMPACT, wide));

  return wide
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .map((candidate) => ({
      key: candidate.mark.key,
      icon: candidate.mark.icon,
      temperature: candidate.mark.temperature,
      text: candidate.mark.text,
      left: candidate.left,
      top: candidate.top,
      edge: candidate.edge,
      compact: compact.has(candidate),
    }));
}

/**
 * Équivalent textuel — §51.
 *
 * ```text
 * Départ — 07:10
 * Adelboden — 10:48
 * ```
 *
 * Exactement la forme que le document donne en exemple.
 */
function PassageList({
  passages,
  note,
  dark = false,
}: {
  readonly passages: readonly {
    readonly name: string;
    readonly clock: string;
    /** « Ciel dégagé, 3 °C » : la météo prévue au passage, quand elle est connue. */
    readonly weather?: string | null;
  }[];
  readonly note?: string;
  readonly dark?: boolean;
}) {
  return (
    <div className="pl-passages">
      <div className={dark ? 'pk-visually-hidden' : undefined}>
        <MicroLabel>Passages estimés</MicroLabel>
        <ul className="pk-body pl-passage-list">
          {passages.map((passage) => (
            <li key={`${passage.name}-${passage.clock}`}>
              {passage.name} — {passage.clock}
              {passage.weather === undefined || passage.weather === null
                ? null
                : ` · météo prévue : ${passage.weather}`}
            </li>
          ))}
        </ul>
      </div>

      {note === undefined ? null : <p className="pl-profile-note">{note}</p>}
    </div>
  );
}

/** Altitude du profil à une abscisse, par interpolation entre deux échantillons. */
function elevationAt(profile: readonly PlanProfileSample[], distanceKm: number): number {
  const first = profile[0] as PlanProfileSample;
  const last = profile[profile.length - 1] as PlanProfileSample;

  if (distanceKm <= first.distanceKm) return first.elevationMeters;
  if (distanceKm >= last.distanceKm) return last.elevationMeters;

  for (let index = 1; index < profile.length; index += 1) {
    const upper = profile[index] as PlanProfileSample;
    if (upper.distanceKm < distanceKm) continue;

    const lower = profile[index - 1] as PlanProfileSample;
    const span = upper.distanceKm - lower.distanceKm;
    if (span === 0) return lower.elevationMeters;

    const ratio = (distanceKm - lower.distanceKm) / span;

    return lower.elevationMeters + (upper.elevationMeters - lower.elevationMeters) * ratio;
  }

  return last.elevationMeters;
}
