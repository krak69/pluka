'use client';

import { Input, TerrainBand } from '@pluka/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';

import type { ActionState } from '@/app/actions';
import { createEventWithEditionAction } from '@/app/discovery-actions';
import { AdminIcon } from '@/components/admin-icon';
import { CreationStepper } from '@/components/creation-stepper';
import { slugify } from '@/lib/slug';

/**
 * Créer un événement — un écran par étape (décisions produit du 2026-10-07) :
 *
 *   1. l'événement ;
 *   2. l'édition ;
 *   3. les épreuves ;
 *   4. la vérification, puis la création ;
 *   5. les documents — sur la fiche créée, `/evenements/[id]/documents`.
 *
 * Chaque étape a son adresse (`?etape=2`) : le bouton Précédent du navigateur
 * revient à l'étape d'avant, et l'écran ne montre que ce qu'elle demande.
 * L'adresse ne porte aucune saisie : un rechargement repart de l'étape 1
 * plutôt que d'afficher une étape aux champs vides.
 *
 * Les quatre premières étapes restent un seul formulaire, découpé à l'écran :
 * tout part ensemble à la création, en une transaction, et rien n'est écrit
 * avant « Créer l'événement ». « Continuer » ne vérifie que ce que le
 * navigateur sait vérifier ; les règles sont dans le domaine, et un refus
 * ramène à l'étape du champ fautif.
 *
 * Les champs portent le chemin de la commande (`event.name`,
 * `races.0.startTime`) : c'est aussi la clé des refus du domaine.
 */

const INITIAL: ActionState = {};

/** Les étapes saisies ici ; la cinquième — documents — suit la création. */
export const FORM_STEPS = 4;

/** Un conseil par étape, dans le bandeau : ce qu'on n'a pas à faire, surtout. */
const TIPS = [
  'Le site officiel est facultatif, mais il fait gagner du temps : PLUKA y repère le règlement et les roadbooks.',
  'Un événement sur plusieurs jours ? Renseigne aussi le dernier jour : les épreuves s’y répartiront.',
  'Barrières, ravitaillements, matériel : inutile de les saisir. Ils viendront des documents, à l’étape 5.',
  'Rien n’est encore enregistré. Tu peux tout modifier avant de créer l’événement.',
] as const;

function stepOfField(field: string): number {
  if (field.startsWith('event.')) return 1;
  if (field.startsWith('edition.')) return 2;
  return 3;
}

/** Un nom et son slug : le slug suit le nom tant qu'on ne l'a pas touché. */
function useNamedSlug(): {
  readonly name: string;
  readonly slug: string;
  readonly setName: (value: string) => void;
  readonly setSlug: (value: string) => void;
} {
  const [name, setNameValue] = useState('');
  const [slug, setSlugValue] = useState('');
  const [touched, setTouched] = useState(false);

  return {
    name,
    slug,
    setName(value) {
      setNameValue(value);
      if (!touched) setSlugValue(slugify(value));
    },
    setSlug(value) {
      setTouched(true);
      setSlugValue(value);
    },
  };
}

/** En-tête d'une étape : où l'on en est, ce qu'on demande, pourquoi. */
function StepHeading({
  number,
  title,
  children,
}: {
  readonly number: number;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <header className="ad-step-head">
      <p className="ad-step-count">
        Étape {number} sur {FORM_STEPS + 1}
      </p>
      <h2 className="ad-step-title" tabIndex={-1}>
        {title}
      </h2>
      <p className="ad-step-lede">{children}</p>
    </header>
  );
}

interface RaceRowProps {
  readonly index: number;
  readonly rowKey: number;
  readonly defaultDate: string;
  readonly errors: Readonly<Record<string, string>>;
  readonly removable: boolean;
  readonly onRemove: () => void;
}

function RaceRow({ index, rowKey, defaultDate, errors, removable, onRemove }: RaceRowProps) {
  const named = useNamedSlug();
  const field = (name: string) => `races.${index}.${name}`;

  return (
    <li className="ad-race-card">
      <div className="ad-review-race-head">
        <span className="ad-row-title">Épreuve {index + 1}</span>
        {removable ? (
          <button
            type="button"
            className="pk-btn pk-button-secondary ad-review-race-remove"
            onClick={onRemove}
            aria-label={`Retirer l’épreuve ${index + 1}`}
          >
            Retirer
          </button>
        ) : null}
      </div>
      <div className="ad-form-grid">
        <Input
          id={`race-${rowKey}-name`}
          name={field('name')}
          label="Nom"
          placeholder="Ex. Grand Trail"
          required
          autoComplete="off"
          value={named.name}
          onChange={(event) => named.setName(event.target.value)}
          error={errors[field('name')]}
        />
        <Input
          id={`race-${rowKey}-distance`}
          name={field('distanceKm')}
          label="Distance (km)"
          inputMode="decimal"
          required
          autoComplete="off"
          error={errors[field('distanceKm')]}
        />
        <Input
          id={`race-${rowKey}-gain`}
          name={field('elevationGainM')}
          label="D+ (m, facultatif)"
          inputMode="numeric"
          autoComplete="off"
          error={errors[field('elevationGainM')]}
        />
        <Input
          id={`race-${rowKey}-date`}
          name={field('startDate')}
          type="date"
          label="Date de départ"
          required
          defaultValue={defaultDate}
          error={errors[field('startDate')]}
        />
        <Input
          id={`race-${rowKey}-time`}
          name={field('startTime')}
          type="time"
          label="Heure de départ"
          required
          error={errors[field('startTime')]}
        />
      </div>
      <details className="ad-advanced">
        <summary>Réglages avancés — slug, fuseau horaire</summary>
        <div className="ad-form-grid">
          <Input
            id={`race-${rowKey}-slug`}
            name={field('slug')}
            label="Slug"
            required
            autoComplete="off"
            value={named.slug}
            onChange={(event) => named.setSlug(event.target.value)}
            error={errors[field('slug')]}
          />
          <Input
            id={`race-${rowKey}-timezone`}
            name={field('timezone')}
            label="Fuseau horaire"
            required
            autoComplete="off"
            defaultValue="Europe/Paris"
            hint="Fuseau IANA de la ligne de départ."
            error={errors[field('timezone')]}
          />
        </div>
      </details>
    </li>
  );
}

/** Ce qui sera créé, relu dans le formulaire tel qu'il partira. */
interface Summary {
  readonly event: readonly [string, string][];
  readonly edition: readonly [string, string][];
  readonly races: readonly string[];
}

function summarize(
  form: HTMLFormElement,
  organizations: readonly { id: string; name: string }[],
): Summary {
  const data = new FormData(form);
  const value = (name: string) => {
    const raw = data.get(name);
    return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
  };
  const organizationId = value('event.organizationId');
  const organization =
    organizationId === null
      ? 'Aucune — maintenu par PLUKA'
      : (organizations.find((candidate) => candidate.id === organizationId)?.name ?? '—');

  const races: string[] = [];
  for (const key of data.keys()) {
    const match = /^races\.(\d+)\.name$/.exec(key);
    if (match === null) continue;
    const index = match[1];
    const gain = value(`races.${index}.elevationGainM`);
    races.push(
      [
        value(`races.${index}.name`) ?? 'Sans nom',
        `${value(`races.${index}.distanceKm`) ?? '?'} km`,
        gain === null ? null : `${gain} m D+`,
        `départ ${value(`races.${index}.startDate`) ?? '?'} à ${value(`races.${index}.startTime`) ?? '?'}`,
      ]
        .filter((part) => part !== null)
        .join(' · '),
    );
  }

  const end = value('edition.endDate');
  return {
    event: [
      ['Nom', value('event.name') ?? '—'],
      ['Adresse', `/${value('event.slug') ?? ''}`],
      ['Ville', value('event.city') ?? '—'],
      ['Organisation', organization],
      ['Site officiel', value('event.officialWebsiteUrl') ?? 'Aucun'],
    ],
    edition: [
      ['Année', value('edition.year') ?? '—'],
      ['Dates', `${value('edition.startDate') ?? '—'}${end === null ? '' : ` → ${end}`}`],
    ],
    races,
  };
}

export function EventWizard({
  step,
  organizations,
}: {
  /** Étape demandée par l'adresse, 1 à 4. */
  readonly step: number;
  readonly organizations: readonly { readonly id: string; readonly name: string }[];
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createEventWithEditionAction, INITIAL);
  const [reached, setReached] = useState(1);
  const [rows, setRows] = useState<readonly number[]>([1]);
  const [startDate, setStartDate] = useState('');
  const [year, setYear] = useState('');
  const [editionSlug, setEditionSlug] = useState('');
  const [editionSlugTouched, setEditionSlugTouched] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const event = useNamedSlug();
  const form = useRef<HTMLFormElement>(null);
  const sections = useRef<(HTMLElement | null)[]>([]);
  const errors = state.fieldErrors ?? {};

  // On n'atteint une étape qu'en passant par les précédentes : une adresse
  // tapée à la main, ou un rechargement, ramène à la dernière étape atteinte.
  const current = Math.min(Math.max(step, 1), reached);

  function goTo(target: number, replace = false): void {
    const href = `/evenements/nouveau?etape=${target}`;
    if (replace) router.replace(href, { scroll: true });
    else router.push(href, { scroll: true });
  }

  useEffect(() => {
    if (step !== current) goTo(current, true);
    // `goTo` ne dépend que du routeur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, current]);

  // Un refus du domaine ramène à l'étape de son premier champ.
  useEffect(() => {
    const first = Object.keys(state.fieldErrors ?? {})[0];
    if (first !== undefined) goTo(stepOfField(first));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    sections.current[current]?.querySelector<HTMLElement>('h2')?.focus();
    if (current === 4 && form.current !== null) setSummary(summarize(form.current, organizations));
  }, [current, organizations]);

  /** Vérifie l'étape affichée avec ce que le navigateur sait vérifier. */
  function stepIsValid(): boolean {
    const section = sections.current[current];
    const fields = section?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select');
    for (const field of fields ?? []) {
      if (field.checkValidity()) continue;
      // Un champ fautif dans des réglages repliés : on les ouvre pour le montrer.
      const details = field.closest('details');
      if (details !== null) details.open = true;
      field.reportValidity();
      return false;
    }
    return true;
  }

  function next(): void {
    if (!stepIsValid()) return;
    const target = Math.min(current + 1, FORM_STEPS);
    setReached((value) => Math.max(value, target));
    goTo(target);
  }

  function changeYear(value: string): void {
    setYear(value);
    if (!editionSlugTouched) setEditionSlug(value);
  }

  function changeStartDate(value: string): void {
    setStartDate(value);
    if (year === '' && /^\d{4}-/.test(value)) changeYear(value.slice(0, 4));
  }

  const section = (index: number) => ({
    ref: (element: HTMLElement | null) => {
      sections.current[index] = element;
    },
    className: 'ad-step',
    hidden: current !== index,
  });

  // Ce que le bandeau dit de l'événement en cours de saisie : il se compose
  // sous les yeux, et rien de ce qui n'est pas saisi n'y apparaît.
  const subtitle = [
    year === '' ? null : `Édition ${year}`,
    // Le compte des épreuves n'a de sens qu'une fois qu'on les saisit.
    current < 3 || rows.length === 0 ? null : `${rows.length} épreuve${rows.length > 1 ? 's' : ''}`,
  ]
    .filter((part) => part !== null)
    .join(' · ');

  return (
    <div className="ad-wizard">
      {/*
        Le bandeau de terrain, en tête : le nom qui se compose, puis le fil
        des étapes, couché, au-dessus du formulaire. Le conseil de l'étape et
        la sortie ferment le bandeau.
      */}
      <TerrainBand
        tone="dark"
        topo
        level={1}
        className="ad-wizard-band"
        eyebrow="Créer un événement"
        title={event.name.trim() === '' ? 'Nouvel événement' : event.name}
        body={
          <div className="ad-wizard-band-body">
            {subtitle === '' ? null : <p className="ad-wizard-sub">{subtitle}</p>}
            <CreationStepper
              tone="dark"
              current={current}
              reached={reached}
              onSelect={(target) => goTo(target)}
            />
          </div>
        }
        footer={
          <p className="ad-wizard-tip">
            <span className="pk-label">Bon à savoir</span> {TIPS[current - 1]}
          </p>
        }
        secondaryAction={
          <Link href="/" className="ad-wizard-exit">
            <AdminIcon name="XCircle" size={16} />
            Quitter
          </Link>
        }
      />

      {/*
        `noValidate` : un champ d'une étape masquée ne peut pas recevoir le
        focus d'un refus natif. Chaque étape se vérifie à « Continuer », et le
        domaine revérifie tout à la création.
      */}
      <div className="ad-wizard-main">
        <form ref={form} action={action} noValidate className="ad-wizard-card">
          <section {...section(1)} aria-labelledby="step-1">
            <StepHeading number={1} title="L’événement">
              Le nom sous lequel les coureurs le connaissent, et qui l’organise.
            </StepHeading>
            <div className="ad-step-fields">
              <Input
                id="wizard-name"
                name="event.name"
                label="Nom de l’événement"
                placeholder="Ex. Trail des Crêtes"
                required
                autoComplete="off"
                value={event.name}
                onChange={(change) => event.setName(change.target.value)}
                error={errors['event.name']}
              />
              <div className="ad-form-grid">
                <Input
                  id="wizard-city"
                  name="event.city"
                  label="Ville (facultatif)"
                  autoComplete="off"
                  error={errors['event.city']}
                />
                <div className="pk-field">
                  <label className="pk-field-label" htmlFor="wizard-organization">
                    Organisation gestionnaire
                  </label>
                  <select
                    id="wizard-organization"
                    name="event.organizationId"
                    className="pk-input"
                    defaultValue=""
                  >
                    <option value="">Aucune — maintenu par PLUKA</option>
                    {organizations.map((organization) => (
                      <option key={organization.id} value={organization.id}>
                        {organization.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Input
                id="wizard-website"
                name="event.officialWebsiteUrl"
                type="url"
                label="Site officiel (facultatif)"
                placeholder="https://"
                autoComplete="off"
                hint="PLUKA y relèvera les pages et documents de course — règlement, roadbooks — pour te les proposer à l’étape 5."
                error={errors['event.officialWebsiteUrl']}
              />
              <details className="ad-advanced" open={errors['event.slug'] !== undefined}>
                <summary>Adresse de l’événement : /{event.slug || '…'}</summary>
                <Input
                  id="wizard-slug"
                  name="event.slug"
                  label="Slug"
                  required
                  autoComplete="off"
                  hint="Proposé depuis le nom. Minuscules et tirets."
                  value={event.slug}
                  onChange={(change) => event.setSlug(change.target.value)}
                  error={errors['event.slug']}
                />
              </details>
            </div>
          </section>

          <section {...section(2)} aria-labelledby="step-2">
            <StepHeading number={2} title="L’édition">
              Les dates de l’édition à préparer. L’année en découle.
            </StepHeading>
            <div className="ad-step-fields">
              <div className="ad-form-grid">
                <Input
                  id="wizard-start"
                  name="edition.startDate"
                  type="date"
                  label="Premier jour"
                  required
                  value={startDate}
                  onChange={(change) => changeStartDate(change.target.value)}
                  error={errors['edition.startDate']}
                />
                <Input
                  id="wizard-end"
                  name="edition.endDate"
                  type="date"
                  label="Dernier jour (facultatif)"
                  hint="Pour un événement sur plusieurs jours."
                  error={errors['edition.endDate']}
                />
              </div>
              <details
                className="ad-advanced"
                open={errors['edition.year'] !== undefined || errors['edition.slug'] !== undefined}
              >
                <summary>
                  Édition {year || '…'} · adresse /{editionSlug || '…'}
                </summary>
                <div className="ad-form-grid">
                  <Input
                    id="wizard-year"
                    name="edition.year"
                    label="Année"
                    inputMode="numeric"
                    required
                    autoComplete="off"
                    value={year}
                    onChange={(change) => changeYear(change.target.value)}
                    error={errors['edition.year']}
                  />
                  <Input
                    id="wizard-edition-slug"
                    name="edition.slug"
                    label="Slug de l’édition"
                    required
                    autoComplete="off"
                    value={editionSlug}
                    onChange={(change) => {
                      setEditionSlugTouched(true);
                      setEditionSlug(change.target.value);
                    }}
                    error={errors['edition.slug']}
                  />
                </div>
              </details>
            </div>
          </section>

          <section {...section(3)} aria-labelledby="step-3">
            <StepHeading number={3} title="Les épreuves">
              Une fiche par course : distance, date et heure de départ. Tu pourras en ajouter ou les
              modifier ensuite sur la fiche de l’événement.
            </StepHeading>
            {errors['races.slug'] === undefined ? null : (
              <p className="pk-field-error" role="alert">
                {errors['races.slug']}
              </p>
            )}

            {rows.length === 0 ? (
              <p className="pk-body ad-measure">
                Aucune épreuve : l’événement sera créé sans course, à compléter plus tard.
              </p>
            ) : (
              <ol className="ad-race-cards">
                {rows.map((rowKey, index) => (
                  <RaceRow
                    key={rowKey}
                    index={index}
                    rowKey={rowKey}
                    defaultDate={startDate}
                    errors={errors}
                    removable
                    onRemove={() => setRows((rowsNow) => rowsNow.filter((key) => key !== rowKey))}
                  />
                ))}
              </ol>
            )}

            <div>
              <button
                type="button"
                className="pk-btn pk-button-secondary"
                onClick={() => setRows((rowsNow) => [...rowsNow, Date.now()])}
              >
                <AdminIcon name="Plus" size={16} />
                {rows.length === 0 ? 'Ajouter une épreuve' : 'Ajouter une autre épreuve'}
              </button>
            </div>
          </section>

          <section {...section(4)} aria-labelledby="step-4">
            <StepHeading number={4} title="Vérifier et créer">
              Relis avant de créer. Rien n’est enregistré tant que tu n’as pas cliqué sur « Créer
              l’événement ».
            </StepHeading>

            {summary === null ? null : (
              <div className="ad-recap">
                <div className="ad-recap-block">
                  <div className="ad-recap-head">
                    <h3 className="ad-org-panel-title">L’événement</h3>
                    <button type="button" className="pk-link ad-recap-edit" onClick={() => goTo(1)}>
                      Modifier
                    </button>
                  </div>
                  <dl className="ad-recap-list">
                    {summary.event.map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <div className="ad-recap-block">
                  <div className="ad-recap-head">
                    <h3 className="ad-org-panel-title">L’édition</h3>
                    <button type="button" className="pk-link ad-recap-edit" onClick={() => goTo(2)}>
                      Modifier
                    </button>
                  </div>
                  <dl className="ad-recap-list">
                    {summary.edition.map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <div className="ad-recap-block">
                  <div className="ad-recap-head">
                    <h3 className="ad-org-panel-title">
                      {summary.races.length} épreuve{summary.races.length > 1 ? 's' : ''}
                    </h3>
                    <button type="button" className="pk-link ad-recap-edit" onClick={() => goTo(3)}>
                      Modifier
                    </button>
                  </div>
                  {summary.races.length === 0 ? (
                    <p className="pk-body">Aucune épreuve pour l’instant.</p>
                  ) : (
                    <ul className="ad-similar">
                      {summary.races.map((race, index) => (
                        <li key={`${race}-${index}`}>{race}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </section>

          <div className="ad-step-actions">
            {current === 1 ? null : (
              <button
                type="button"
                className="pk-btn pk-button-secondary"
                onClick={() => goTo(current - 1)}
              >
                Précédent
              </button>
            )}
            {current < FORM_STEPS ? (
              <button type="button" className="pk-btn pk-button-primary" onClick={next}>
                Continuer
              </button>
            ) : (
              <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
                {pending ? 'Création…' : 'Créer l’événement'}
              </button>
            )}
          </div>

          {state.error === undefined ? null : (
            <p className="pk-field-error" role="alert">
              {state.error}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
