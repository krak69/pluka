import type { PlanPointView, PlanProfileSample } from '@pluka/domain';
import { MicroLabel } from '@pluka/ui';

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
}

export function AltitudeProfile({ profile, points, timezone, anchored }: AltitudeProfileProps) {
  const passages = points.map((point) => ({
    name: point.name,
    clock: formatClock(point.plannedArrivalAt, timezone),
  }));

  if (profile.length < 2) {
    // Sans parcours prétraité, pas de courbe — mais les passages restent
    // lisibles. §51 : le texte n'est pas un repli, c'est la source.
    return (
      <PassageList passages={passages} note="Le profil du parcours n’est pas encore disponible." />
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

  return (
    <section>
      <MicroLabel>Profil du parcours</MicroLabel>

      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label={`Profil du parcours, ${formatDistance(box.totalDistanceKm)} kilomètres`}
        style={{ width: '100%', height: 'auto', display: 'block', marginTop: 'var(--space-3)' }}
      >
        <path d={area} fill="var(--pk-glacier-bg)" />
        <path d={line} fill="none" stroke="var(--pk-forest)" strokeWidth={2} />

        {markers.map(({ point, position, isFinish }) =>
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
              fill="var(--pk-surface)"
              stroke="var(--pk-forest)"
              strokeWidth={2}
            />
          ),
        )}
      </svg>

      <PassageList
        passages={passages}
        {...(anchored
          ? {}
          : {
              note: 'Altitudes relatives au départ : aucune altitude officielle n’est renseignée.',
            })}
      />
    </section>
  );
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
}: {
  readonly passages: readonly { readonly name: string; readonly clock: string }[];
  readonly note?: string;
}) {
  return (
    <div style={{ marginTop: 'var(--space-3)' }}>
      <MicroLabel>Passages estimés</MicroLabel>
      <ul
        className="pk-body"
        style={{ listStyle: 'none', padding: 0, margin: 'var(--space-2) 0 0' }}
      >
        {passages.map((passage) => (
          <li key={`${passage.name}-${passage.clock}`}>
            {passage.name} — {passage.clock}
          </li>
        ))}
      </ul>

      {note === undefined ? null : (
        <p
          className="pk-body"
          style={{ color: 'var(--pk-text-muted)', marginTop: 'var(--space-2)' }}
        >
          {note}
        </p>
      )}
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
