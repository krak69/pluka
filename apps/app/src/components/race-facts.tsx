import type { PublishedRaceFactRecord, RaceCutoffRecord, RaceWaypointRecord } from '@pluka/db';
import { Divider, EmptyState, MicroLabel, SourceDrawer, TrustBadge } from '@pluka/ui';

/**
 * L'information officielle d'une course — 06_DESIGN_SYSTEM.md §85, §86.
 *
 * Partagé par la fiche épreuve publique et l'onglet « La course » du coureur :
 * c'est le même contenu, lu par le même use case.
 *
 * Chaque fact porte son niveau de confiance et sa provenance. §85 : « chaque
 * information importante doit pouvoir répondre : d'où vient-elle ». Le tiroir
 * de source en donne le document, la page, l'article et un extrait — §86 : « un
 * extrait, pas le document ».
 *
 * Un fact sans source principale existe : une saisie organisateur directe n'en
 * a pas. L'écran le dit au lieu de laisser croire à une provenance.
 */

/* Libellés du référentiel `waypoint_type` — 02_DATA_MODEL §6.6. */
const WAYPOINT_LABELS: Readonly<Record<RaceWaypointRecord['waypointType'], string>> = {
  start: 'Départ',
  aid_station: 'Ravitaillement',
  water: 'Point d’eau',
  checkpoint: 'Point de contrôle',
  cutoff: 'Barrière',
  assistance: 'Zone d’assistance',
  summit: 'Sommet',
  pass: 'Col',
  finish: 'Arrivée',
  other: 'Point de passage',
};

const CUTOFF_LABELS: Readonly<Record<RaceCutoffRecord['cutoffType'], string>> = {
  hard: 'Stricte',
  soft: 'Indicative',
};

/* Libellés du référentiel `source_type`. Le tiroir affiche un mot, pas un enum. */
const SOURCE_TYPE_LABELS: Readonly<
  Record<NonNullable<PublishedRaceFactRecord['source']>['sourceType'], string>
> = {
  url: 'Site officiel',
  pdf: 'Document PDF',
  gpx: 'Trace GPX',
  file: 'Fichier',
  manual: 'Relevé PLUKA',
  organizer_input: 'Saisie de l’organisation',
};

/* Libellés du référentiel `fact_category`, au complet. */
const CATEGORY_LABELS: Readonly<Record<PublishedRaceFactRecord['category'], string>> = {
  general: 'Général',
  start: 'Départ',
  bib: 'Dossard',
  course: 'Parcours',
  gpx: 'Trace GPX',
  aid: 'Ravitaillement',
  cutoff: 'Barrières horaires',
  equipment: 'Matériel obligatoire',
  assistance: 'Assistance',
  bag: 'Sacs',
  transport: 'Transport',
  safety: 'Sécurité',
  withdrawal: 'Abandon',
  rules: 'Règlement',
  contact: 'Contact',
  weather: 'Météo',
  other: 'Autres informations',
};

/**
 * Ordre d'affichage : ce qu'un coureur cherche en premier.
 *
 * Les barrières et le matériel obligatoire d'abord — ce sont les deux
 * informations qui peuvent l'empêcher de partir.
 */
const CATEGORY_ORDER: readonly PublishedRaceFactRecord['category'][] = [
  'cutoff',
  'equipment',
  'start',
  'assistance',
  'aid',
  'bag',
  'course',
  'gpx',
  'bib',
  'transport',
  'safety',
  'withdrawal',
  'weather',
  'rules',
  'contact',
  'general',
  'other',
];

/** Valeur affichable d'un fact. Aucune n'est reformulée ni arrondie. */
function factValue(fact: PublishedRaceFactRecord): string {
  if (fact.valueText !== null) return fact.valueText;

  if (fact.valueNumber !== null) {
    return fact.unit === null
      ? String(fact.valueNumber)
      : `${String(fact.valueNumber)} ${fact.unit}`;
  }

  // Un `value_json` est une structure : l'écran ne la met pas en forme au
  // hasard. Il dit qu'elle est détaillée et laisse la source parler.
  return 'valeur détaillée';
}

function pageLabel(fact: PublishedRaceFactRecord): string | undefined {
  const source = fact.source;
  if (source === null || source.pageStart === null) return undefined;

  return source.pageEnd === null || source.pageEnd === source.pageStart
    ? `page ${String(source.pageStart)}`
    : `pages ${String(source.pageStart)} à ${String(source.pageEnd)}`;
}

function FactRow({ fact }: { readonly fact: PublishedRaceFactRecord }) {
  const source = fact.source;
  const page = pageLabel(fact);

  return (
    <div className="rp-fact-row">
      <div className="rp-fact-row-head">
        <span className="rp-fact-row-key">{fact.factKey}</span>
        <TrustBadge level={fact.trustLevel} />
      </div>

      <p className="rp-fact-row-value">{factValue(fact)}</p>

      {source === null ? (
        <p className="rp-fact-row-nosource">
          Information fournie directement par l’organisation, sans document de référence.
        </p>
      ) : (
        <SourceDrawer
          type={SOURCE_TYPE_LABELS[source.sourceType]}
          {...(source.title === null ? {} : { title: source.title })}
          {...(page === undefined ? {} : { pageLabel: page })}
          {...(source.articleLabel === null
            ? source.sectionLabel === null
              ? {}
              : { sectionLabel: source.sectionLabel }
            : { sectionLabel: source.articleLabel })}
          {...(source.excerpt === null ? {} : { excerpt: source.excerpt })}
          {...(source.declaredPublishedAt === null
            ? {}
            : { date: source.declaredPublishedAt.slice(0, 10) })}
          {...(source.url === null ? {} : { href: source.url })}
          trustLevel={fact.trustLevel}
        />
      )}
    </div>
  );
}

export interface RaceFactsProps {
  readonly facts: readonly PublishedRaceFactRecord[];
  readonly cutoffs: readonly RaceCutoffRecord[];
  readonly waypoints: readonly RaceWaypointRecord[];
  readonly timezone: string;
}

export function RaceFacts({ facts, cutoffs, waypoints, timezone }: RaceFactsProps) {
  const byWaypointId = new Map(waypoints.map((waypoint) => [waypoint.id, waypoint]));

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    entries: facts.filter((fact) => fact.category === category),
  })).filter((group) => group.entries.length > 0);

  return (
    <div className="rp-information">
      <section>
        <MicroLabel>Points de passage</MicroLabel>

        {waypoints.length === 0 ? (
          <EmptyState
            title="Aucun point de passage publié."
            detail="Le parcours de cette épreuve n’a pas encore été importé ni saisi par l’organisation."
          >
            <p>
              Les ravitaillements, bases de vie et points de contrôle apparaîtront ici avec leur
              kilométrage.
            </p>
          </EmptyState>
        ) : (
          <ol className="rp-waypoints">
            {waypoints.map((waypoint) => (
              <li key={waypoint.id} className="rp-waypoint">
                <span className="rp-waypoint-km">{waypoint.distanceKm.toFixed(1)} km</span>
                <span className="rp-waypoint-name">{waypoint.name}</span>
                <span className="rp-waypoint-type">{WAYPOINT_LABELS[waypoint.waypointType]}</span>
                <span className="rp-waypoint-alt">
                  {waypoint.altitudeM === null ? '—' : `${String(waypoint.altitudeM)} m`}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <Divider spaced />

      <section>
        <MicroLabel>Barrières horaires</MicroLabel>

        {cutoffs.length === 0 ? (
          <EmptyState
            title="Aucune barrière horaire publiée."
            detail="Les barrières de cette épreuve n’ont pas encore été validées par l’organisation."
          >
            <p>
              Une barrière publiée ici porte l’heure officielle et le point auquel elle s’applique.
            </p>
          </EmptyState>
        ) : (
          <ul className="rp-cutoffs">
            {cutoffs.map((cutoff) => {
              const waypoint = byWaypointId.get(cutoff.raceWaypointId);

              return (
                <li key={cutoff.id} className="rp-cutoff">
                  <span className="rp-cutoff-where">{waypoint?.name ?? 'Point inconnu'}</span>
                  <span className="rp-cutoff-when">
                    {new Intl.DateTimeFormat('fr-FR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                      timeZone: timezone,
                    }).format(new Date(cutoff.cutoffDatetime))}
                  </span>
                  <span className="rp-cutoff-type">{CUTOFF_LABELS[cutoff.cutoffType]}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Divider spaced />

      <section>
        <MicroLabel>Informations officielles</MicroLabel>

        {grouped.length === 0 ? (
          <EmptyState
            title="Aucune information publiée."
            detail="Les documents de cette épreuve n’ont pas encore été analysés, ou leurs informations attendent la validation de l’organisation."
          >
            <p>
              Chaque information publiée ici portera son niveau de confiance et le document dont
              elle vient, page et article compris.
            </p>
          </EmptyState>
        ) : (
          grouped.map((group) => (
            <div key={group.category} className="rp-fact-group">
              <h3 className="pk-h2 rp-fact-group-title">{CATEGORY_LABELS[group.category]}</h3>

              <div className="rp-fact-list">
                {group.entries.map((fact) => (
                  <FactRow key={fact.factId} fact={fact} />
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
