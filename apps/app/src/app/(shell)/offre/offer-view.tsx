import {
  getPlusOffer,
  getRacePassOffer,
  type OwnParticipationSummary,
  type PlusOffer,
  type RacePassOffer,
} from '@pluka/domain';
import { Button } from '@pluka/ui';
import Link from 'next/link';

import { startRacePassCheckoutAction } from '@/app/(shell)/offre/actions';
import { Icon } from '@/components/icon';
import { activeBetaAccess } from '@/lib/beta';
import { billingContext } from '@/lib/billing';
import { listMyRaces } from '@/lib/participations';
import { requireSession } from '@/lib/session';

/**
 * Choix de l'offre — `05_ROUTES_FLOWS.md` §5.3, §12.8 ; 00_PRODUCT_SPEC §6.
 *
 * Le prototype (écran `offre`) : trois formules côte à côte pour la course
 * préparée. Free y est réellement utile (§6.6), le Race Pass s'achète, PLUKA+
 * se montre sans s'acheter — il n'est pas encore en vente (§12.8).
 *
 * Tous les prix viennent de la base (0088, 0090). Le tarif inscrit se dit de
 * façon factuelle — « Tarif inscrit jusqu'au 14 mars » —, sans compte à
 * rebours ni fausse urgence (§6.5.2, 04 §116).
 *
 * Une seule action dominante (AGENTS §43) : le Race Pass, seul achetable.
 */
/** Ce que chaque formule apporte : 00_PRODUCT_SPEC §6.1, §6.2, §6.3. */
const FREE_LINES = [
  'Informations officielles et sources',
  'Alertes de l’organisation',
  'Matériel obligatoire',
  'Plan initial et temps de passage',
  'Barrières et marges correspondantes',
] as const;

const RACE_PASS_LINES = [
  'Plan complet et éditable',
  'Nutrition',
  'Conditions point par point dès J-14',
  'Préparation, sacs et assistance',
  'Après-course',
  '2 sorties de préparation liées',
] as const;

const PLUS_LINES = [
  'Toutes tes courses',
  'Tout le Race Pass inclus',
  'Conditions sur tes courses et sorties',
  'Sorties personnelles illimitées',
  'Stratégies et modèles réutilisables',
  'Mémoire de saison',
] as const;

const COVERAGE_LABELS = {
  race_pass: 'Formule actuelle',
  organizer_included: 'Offerte par l’organisation',
  plus: 'Incluse dans ton PLUKA+',
} as const;

function day(instant: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(new Date(instant));
}

/** Un jour civil « 2026-03-16 » → « 16 mars » : aucun fuseau à appliquer. */
function civilDay(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

function price(minor: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(minor / 100);
}

function Lines({ lines }: { readonly lines: readonly string[] }) {
  return (
    <ul className="of-lines">
      {lines.map((line) => (
        <li key={line}>
          <Icon name="Check" size={16} />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

function FreeCard({
  participantRaceId,
  covered,
}: {
  readonly participantRaceId: string;
  readonly covered: boolean;
}) {
  return (
    <li className="of-card">
      <div className="of-head">
        <h2 id="of-free" className="of-name">
          PLUKA Free
        </h2>
        <p className="of-price">
          <span className="of-amount">0&nbsp;€</span>
        </p>
        <p className="of-tagline">Pour découvrir PLUKA, sans limite de temps.</p>
      </div>
      <Lines lines={FREE_LINES} />
      <div className="of-foot">
        {covered ? (
          <p className="of-note">Déjà inclus dans ta formule.</p>
        ) : (
          <Link
            href={`/courses/${participantRaceId}/plan`}
            className="pk-btn pk-button-secondary of-cta"
          >
            Continuer gratuitement
          </Link>
        )}
      </div>
    </li>
  );
}

function RacePassCard({
  race,
  offer,
  payable,
}: {
  readonly race: OwnParticipationSummary;
  readonly offer: RacePassOffer;
  readonly payable: boolean;
}) {
  const current = offer.state === 'covered' && offer.coverage === 'race_pass';

  return (
    <li className={current ? 'of-card of-card-current' : 'of-card'}>
      <div className="of-head">
        {offer.state === 'covered' ? (
          <p className="of-tag of-tag-current">{COVERAGE_LABELS[offer.coverage]}</p>
        ) : null}
        <h2 id="of-race-pass" className="of-name">
          Race Pass
        </h2>
        {offer.state === 'available' ? (
          <>
            <p className="of-price">
              <span className="of-amount">{price(offer.amountMinor, offer.currency)}</span>
              {offer.earlyBirdLastDay === null ? null : (
                <s className="of-was">
                  <span className="pk-visually-hidden">au lieu de </span>
                  {price(offer.standardAmountMinor, offer.currency)}
                </s>
              )}
              <span className="of-per">pour cette course</span>
            </p>
            {offer.earlyBirdLastDay === null ? null : (
              <p className="of-early">Tarif inscrit jusqu’au {civilDay(offer.earlyBirdLastDay)}</p>
            )}
          </>
        ) : null}
        <p className="of-tagline">La préparation complète de {race.name}.</p>
      </div>
      <Lines lines={RACE_PASS_LINES} />
      <div className="of-foot">
        {offer.state === 'covered' ? (
          <Link
            href={`/courses/${race.participantRaceId}/plan`}
            className="pk-btn pk-button-secondary of-cta"
          >
            Aller à ma préparation
          </Link>
        ) : offer.state === 'unavailable' ? (
          <p className="of-note">Le Race Pass n’est pas en vente pour l’instant.</p>
        ) : payable ? (
          <form action={startRacePassCheckoutAction}>
            <input type="hidden" name="participantRaceId" value={race.participantRaceId} />
            <Button type="submit" variant="primary" className="of-cta">
              {offer.pendingPurchaseId === null ? 'Choisir Race Pass' : 'Reprendre le paiement'}
            </Button>
          </form>
        ) : (
          <p className="of-note">Le paiement en ligne n’est pas encore ouvert.</p>
        )}
      </div>
    </li>
  );
}

function PlusCard({ offer }: { readonly offer: PlusOffer }) {
  return (
    <li className="of-card of-card-plus">
      <div className="of-head">
        <p className={offer.state === 'active' ? 'of-tag of-tag-current' : 'of-tag'}>
          {offer.state === 'active' ? 'Formule actuelle' : 'Pour toute ta saison'}
        </p>
        <h2 id="of-plus" className="of-name">
          PLUKA+
        </h2>
        {offer.state === 'soon' ? (
          <p className="of-price">
            <span className="of-amount">{price(offer.amountMinor, offer.currency)}</span>
            <span className="of-per">par an</span>
          </p>
        ) : null}
        <p className="of-tagline">Toute ta saison avec toi.</p>
      </div>
      <Lines lines={PLUS_LINES} />
      <div className="of-foot">
        {offer.state === 'active' ? (
          <p className="of-note">Toutes tes courses sont couvertes.</p>
        ) : (
          <p className="of-soon">Bientôt disponible</p>
        )}
      </div>
    </li>
  );
}

/**
 * Le contenu de l'offre : la page `/offre` et le tiroir qui s'ouvre par-dessus
 * l'écran en cours (prototype, `tiersOpen`) partagent exactement le même.
 */
export async function OfferView({
  course,
  refus,
  inDrawer = false,
}: {
  readonly course: string | undefined;
  readonly refus: string | undefined;
  readonly inDrawer?: boolean;
}) {
  const session = await requireSession(course === undefined ? '/offre' : `/offre?course=${course}`);
  const beta = await activeBetaAccess(session);
  const context = billingContext(session);
  const now = new Date().toISOString();

  const races = (await listMyRaces(session)).filter((race) => race.status === 'active');
  const selected =
    races.find((race) => race.participantRaceId === course) ??
    (races.length === 1 ? races[0] : undefined);

  const [offer, plus] = await Promise.all([
    selected === undefined
      ? Promise.resolve(null)
      : getRacePassOffer(context, { participantRaceId: selected.participantRaceId }, now),
    getPlusOffer(context),
  ]);

  const Title = inDrawer ? 'h2' : 'h1';

  return (
    <>
      <header className="of-intro">
        <p className="pk-label of-eyebrow">
          {selected === undefined ? 'Mon offre' : selected.name}
        </p>
        <Title id="of-title" className="of-title">
          {selected === undefined
            ? 'Choisis comment préparer tes courses.'
            : 'Comment veux-tu préparer cette course ?'}
        </Title>
        <p className="of-sub">
          Tu peux commencer gratuitement et changer d’avis à tout moment. Les informations
          officielles restent toujours gratuites.
        </p>
      </header>

      {beta === null ? null : (
        <section className="of-banner" aria-labelledby="beta-title">
          <h2 id="beta-title" className="of-banner-title">
            Accès bêta ouvert
          </h2>
          <p>
            Tu fais partie des testeurs : tout PLUKA est ouvert, sur toutes tes courses
            {beta.endsAt === null ? '' : `, jusqu’au ${day(beta.endsAt)}`}. Ensuite, ton compte
            revient à l’accès gratuit, et ta préparation reste la tienne.
          </p>
        </section>
      )}

      {refus === undefined ? null : (
        <p className="of-alert" role="alert">
          {refus === 'conflict'
            ? 'Cette course est déjà couverte : rien à payer.'
            : 'Le paiement n’a pas pu commencer. Réessaie dans un instant.'}
        </p>
      )}

      {races.length === 0 ? (
        <section className="of-empty" aria-labelledby="of-empty-title">
          <h2 id="of-empty-title" className="of-banner-title">
            Ajoute d’abord la course que tu prépares
          </h2>
          <p>Ton offre se choisit course par course.</p>
          <Link href="/recherche" className="pk-btn pk-button-primary">
            Trouver ma course
          </Link>
        </section>
      ) : selected === undefined || offer === null ? (
        <section aria-labelledby="of-pick-title">
          <h2 id="of-pick-title" className="of-pick-title">
            Pour quelle course&nbsp;?
          </h2>
          <ul className="or-cards">
            {races.map((race) => (
              <li key={race.participantRaceId}>
                <Link href={`/offre?course=${race.participantRaceId}`} className="or-card-link">
                  <span className="or-card-name">{race.name}</span>
                  <span className="or-card-go">Voir les formules</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          <ul className="of-grid">
            <FreeCard
              participantRaceId={selected.participantRaceId}
              covered={offer.state === 'covered'}
            />
            <RacePassCard race={selected} offer={offer} payable={context.provider !== null} />
            <PlusCard offer={plus} />
          </ul>
          {races.length > 1 ? (
            <p className="of-switch">
              <Link href="/offre" className="pk-link">
                Choisir une autre course
              </Link>
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
