import type { Metadata } from 'next';
import Link from 'next/link';

import { ContactForm } from '@/app/organisateurs/contact-form';
import { FaqList } from '@/components/faq-list';
import { Icon } from '@/components/icon';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import * as c from '@/content/organisateurs';
import { publicEnv } from '@/lib/env';

/**
 * Page Organisateurs — `reference/prototype/PLUKA Organisateurs.dc.html`.
 *
 * Server Component, aucune donnée privée, aucun client Supabase
 * (01_ARCHITECTURE.md §4.1, §6.1). Quatorze sections de contenu statique.
 *
 * La section `#confidentialite` est reprise mot pour mot : c'est l'engagement
 * public que 03_PRIVACY_RLS.md §5 impose côté produit — Plan, Préparation,
 * Nutrition et Assistance ne sont jamais visibles de l'organisation. Ce texte
 * n'est pas du marketing à reformuler.
 *
 * Deux états seulement, isolés en Client Components : le menu replié et
 * l'entrée de FAQ ouverte, plus la sortie du formulaire de contact.
 */

export const metadata: Metadata = {
  title: 'PLUKA pour les organisateurs de trail — préparation participants et analyse avant-course',
  description:
    'PLUKA analyse vos informations de course et votre liste d’inscrits, détecte les incohérences, anticipe les principaux flux et transforme vos données officielles en préparation personnalisée pour chaque participant.',
  alternates: { canonical: '/organisateurs' },
  openGraph: {
    type: 'website',
    siteName: 'PLUKA',
    url: '/organisateurs',
    title: 'PLUKA pour les organisateurs de trail',
    description:
      'Vous fournissez vos documents et votre liste d’inscrits. PLUKA vérifie la cohérence de la course, analyse le peloton et prépare chaque participant.',
  },
};

/** Données structurées reprises du prototype, URL issues de la configuration. */
function StructuredData({ site }: { readonly site: string }) {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${site}/#org`, name: 'PLUKA', url: `${site}/` },
      {
        '@type': 'WebPage',
        url: `${site}/organisateurs`,
        name: 'PLUKA pour les organisateurs',
        inLanguage: 'fr-FR',
        isPartOf: { '@id': `${site}/#website` },
        about: { '@id': `${site}/#org` },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger -- JSON-LD statique, sans entrée utilisateur.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}

/* `as const` : total sur ses clés, donc pas de `string | undefined` à l'index. */
const PILL_TONE = {
  official: 'lp-pill lp-pill-official',
  check: 'lp-pill lp-pill-check',
  community: 'lp-pill lp-pill-community',
} as const;

export default function OrganisateursPage() {
  const env = publicEnv();
  const site = env.NEXT_PUBLIC_SITE_URL;

  return (
    <div className="lp-shell">
      <StructuredData site={site} />

      <div aria-hidden="true" className="lp-backdrop" />

      <SiteHeader
        audience="organisateur"
        claim={c.claim}
        links={c.navLinks}
        homeHref="/"
        action={{ label: 'Demander une présentation', href: '#contact' }}
        cross={{
          href: '/',
          title: `Vous préparez une course ?`,
          text: 'Voir PLUKA côté coureur',
          audience: 'coureur',
        }}
      />

      <main className="lp-main">
        {/* ═══ HERO ═══ */}
        <section
          className="lp-section-hero"
          style={{ padding: 'clamp(var(--space-10), 7vw, var(--space-20)) var(--space-5) clamp(46px, 6vw, var(--space-20))' }}
        >
          <div className="lp-wrap lp-hero-grid lp-hero-grid-org">
            <div className="lp-enter">
              <p className="pk-label lp-label-forest" style={{ marginBottom: 'var(--space-4)' }}>
                {c.hero.label}
              </p>

              <h1 className="lp-h1 lp-h1-org" style={{ marginBottom: 'var(--space-5)' }}>
                {c.hero.title}
              </h1>

              <p className="lp-lede lp-measure-58" style={{ marginBottom: 'var(--space-8)' }}>
                {c.hero.lede}
              </p>

              <div className="lp-actions" style={{ marginBottom: 'var(--space-4)' }}>
                <a className="pk-btn pk-button-primary" href="#contact">
                  {c.hero.primary}
                  <Icon name="ArrowRight" size={20} />
                </a>
                <a className="pk-btn pk-button-secondary" href="#brief">
                  {c.hero.secondary}
                </a>
              </div>

              <p className="lp-note">{c.hero.note}</p>
            </div>

            <div className="lp-device lp-topo lp-enter-delayed">
              <div className="lp-device-head-sm">
                <p className="pk-label lp-label-lichen" style={{ marginBottom: '11px' }}>
                  {c.hero.briefLabel}
                </p>

                <p
                  className="lp-hd"
                  style={{ fontSize: '26px', fontWeight: 700, fontVariationSettings: "'wdth' 119" }}
                >
                  {c.hero.event}
                </p>

                <p
                  className="lp-data"
                  style={{ fontSize: '11px', color: 'var(--pk-lichen)', marginTop: '7px' }}
                >
                  {c.hero.when}
                </p>

                <p
                  className="lp-data"
                  style={{
                    fontSize: '10.5px',
                    color: 'var(--lp-on-dark-62)',
                    marginTop: 'var(--space-2)',
                  }}
                >
                  {c.hero.simulated}
                </p>

                <div
                  style={{
                    marginTop: '22px',
                    padding: '18px 0 var(--space-5)',
                    borderTop: '1px solid var(--lp-on-dark-16)',
                  }}
                >
                  <p className="pk-label lp-label-on-dark" style={{ marginBottom: '14px' }}>
                    {c.hero.pointsLabel}
                  </p>

                  {c.hero.points.map((point) => (
                    <div
                      key={point.n}
                      style={{
                        display: 'flex',
                        gap: '14px',
                        alignItems: 'flex-start',
                        padding: '9px 0',
                      }}
                    >
                      <span
                        className="lp-data"
                        style={{
                          flex: 'none',
                          fontSize: '12px',
                          color: 'var(--pk-lichen)',
                          paddingTop: '2px',
                        }}
                      >
                        {point.n}
                      </span>
                      <span className="lp-grow" style={{ fontSize: '15px', lineHeight: 1.45 }}>
                        {point.v}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="lp-device-foot" style={{ padding: 'var(--space-4) 22px 18px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 'var(--space-3)',
                    marginBottom: 'var(--space-3)',
                  }}
                >
                  <span className="pk-label lp-label-dawn">{c.hero.conditionsLabel}</span>
                  <span
                    className="lp-data lp-push"
                    style={{ fontSize: '11px', color: 'var(--pk-text-muted)' }}
                  >
                    {c.hero.conditionsWhen}
                  </span>
                </div>

                <p className="lp-hd lp-h3-17">{c.hero.conditionsTitle}</p>

                <p
                  style={{
                    fontSize: '13.5px',
                    color: 'var(--pk-text-muted)',
                    marginTop: 'var(--space-2)',
                  }}
                >
                  {c.hero.conditionsText}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ RACE INTELLIGENCE ═══ */}
        <section id="intelligence" className="lp-section lp-section-surface">
          <div className="lp-wrap">
            <p className="pk-label lp-label-forest" style={{ marginBottom: '14px' }}>
              {c.intelligence.label}
            </p>

            <h2 className="lp-h2 lp-measure-26" style={{ marginBottom: '18px', lineHeight: 1.1 }}>
              {c.intelligence.title}
            </h2>

            <p
              className="lp-p-18 lp-measure-66"
              style={{ color: 'var(--pk-text-secondary)', marginBottom: '14px' }}
            >
              {c.intelligence.lede}
            </p>

            <p
              className="lp-measure-66"
              style={{
                fontSize: '15.5px',
                lineHeight: 1.6,
                color: 'var(--pk-text-muted)',
                margin: '0 0 36px',
              }}
            >
              {c.intelligence.note}
            </p>

            <div className="lp-duo" style={{ marginBottom: '2px' }}>
              {/* PLUKA contrôle */}
              <div className="lp-tile lp-tile-limestone">
                <p className="pk-label" style={{ marginBottom: '14px' }}>
                  {c.controls.label}
                </p>
                <p className="lp-hd lp-h3" style={{ marginBottom: 'var(--space-3)' }}>
                  {c.controls.title}
                </p>
                <p className="lp-tile-body" style={{ marginBottom: '18px' }}>
                  {c.controls.text}
                </p>

                <div className="lp-inset lp-inset-surface">
                  <p className="pk-label" style={{ marginBottom: 'var(--space-3)' }}>
                    {c.controls.insetLabel}
                  </p>

                  {c.controls.rows.map((row) => (
                    <div key={row.k} className="lp-inset-row">
                      <span>{row.k}</span>
                      <span className="lp-data" style={{ color: 'var(--pk-text-muted)' }}>
                        {row.v}
                      </span>
                    </div>
                  ))}

                  <p
                    className="lp-data lp-inset-rule"
                    style={{ fontSize: '11px', color: 'var(--pk-dawn-ink)' }}
                  >
                    {c.controls.verdict}
                  </p>
                </div>
              </div>

              {/* PLUKA analyse */}
              <div className="lp-tile lp-tile-limestone">
                <p className="pk-label" style={{ marginBottom: '14px' }}>
                  {c.analyses.label}
                </p>
                <p className="lp-hd lp-h3" style={{ marginBottom: 'var(--space-3)' }}>
                  {c.analyses.title}
                </p>
                <p className="lp-tile-body" style={{ marginBottom: '18px' }}>
                  {c.analyses.text}
                </p>

                <div className="lp-inset lp-inset-surface">
                  <p className="pk-label" style={{ marginBottom: 'var(--space-3)' }}>
                    {c.analyses.insetLabel}
                  </p>

                  {c.analyses.lines.map((line) => (
                    <p
                      key={line}
                      style={{ fontSize: '13.5px', color: 'var(--pk-ink)', padding: 'var(--space-1) 0' }}
                    >
                      {line}
                    </p>
                  ))}

                  <p className="lp-note-12 lp-inset-rule">{c.analyses.note}</p>
                </div>
              </div>

              {/* PLUKA anticipe */}
              <div className="lp-tile lp-tile-limestone">
                <p className="pk-label" style={{ marginBottom: '14px' }}>
                  {c.anticipates.label}
                </p>
                <p className="lp-hd lp-h3" style={{ marginBottom: 'var(--space-3)' }}>
                  {c.anticipates.title}
                </p>
                <p className="lp-tile-body" style={{ marginBottom: '18px' }}>
                  {c.anticipates.text}
                </p>

                <div className="lp-inset lp-inset-surface">
                  {c.anticipates.rows.map((row) => (
                    <div key={row.k} className="lp-inset-row lp-inset-row-7">
                      <span>{row.k}</span>
                      <span
                        className="lp-data"
                        style={{
                          color:
                            row.tone === 'dawn' ? 'var(--pk-dawn-ink)' : 'var(--pk-text-muted)',
                        }}
                      >
                        {row.v}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* PLUKA écoute */}
              <div className="lp-tile lp-tile-limestone lp-tile-dawn">
                <p className="pk-label" style={{ marginBottom: '14px' }}>
                  {c.listens.label}
                </p>
                <p className="lp-hd lp-h3" style={{ marginBottom: 'var(--space-3)' }}>
                  {c.listens.title}
                </p>

                <div
                  className="lp-inset lp-inset-surface"
                  style={{ marginBottom: 'var(--space-4)' }}
                >
                  <p className="pk-label" style={{ marginBottom: 'var(--space-3)' }}>
                    {c.listens.askedBy}
                  </p>
                  <p style={{ fontSize: '14.5px', lineHeight: 1.45, color: 'var(--pk-ink)' }}>
                    {c.listens.question}
                  </p>
                  <p
                    className="lp-data"
                    style={{
                      fontSize: '11px',
                      color: 'var(--pk-dawn-ink)',
                      marginTop: 'var(--space-3)',
                    }}
                  >
                    {c.listens.missing}
                  </p>
                </div>

                <p className="lp-tile-body">{c.listens.text}</p>
              </div>
            </div>

            <div style={{ background: 'var(--pk-ink)', padding: 'var(--space-5) var(--space-6)' }}>
              <p className="lp-note-14 lp-on-dark-quiet lp-measure-80">{c.intelligence.footer}</p>
            </div>
          </div>
        </section>

        {/* ═══ CONSTAT ═══ */}
        <section
          className="lp-section-surface-both"
          style={{ padding: 'clamp(46px, 6vw, 78px) var(--space-5)' }}
        >
          <div className="lp-wrap-1100">
            <h2 className="lp-h2-40 lp-measure-30" style={{ marginBottom: '18px' }}>
              {c.observation.title}
            </h2>

            <div className="lp-auto-250">
              <div className="lp-stack lp-gap-3">
                {c.observation.pains.map((pain) => (
                  <p key={pain.label} className="lp-scatter-line lp-scatter-line-top">
                    <Icon name={pain.icon} size={18} className="lp-scatter-icon" />
                    {pain.label}
                  </p>
                ))}
              </div>

              <p className="lp-p" style={{ color: 'var(--pk-forest)' }}>
                {c.observation.text}
              </p>
            </div>
          </div>
        </section>

        {/* ═══ COMMENT ═══ */}
        <section
          id="fonctionnement"
          className="lp-section"
          style={{ padding: 'clamp(50px, 7vw, 88px) var(--space-5)' }}
        >
          <div className="lp-wrap">
            <p className="lp-eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
              Fonctionnement
            </p>

            <h2 className="lp-h2 lp-measure-26" style={{ marginBottom: 'var(--space-8)' }}>
              Trois étapes, côté organisation.
            </h2>

            <div className="lp-auto-266" style={{ marginBottom: '26px' }}>
              {c.steps.map((step) => (
                <div key={step.num} className="lp-card">
                  <p className="lp-step-num">{step.num}</p>
                  <h3 className="lp-h3-20" style={{ marginBottom: 'var(--space-2)' }}>
                    {step.title}
                  </h3>
                  <p className="lp-tile-body" style={{ fontSize: '15.5px', lineHeight: 1.55 }}>
                    {step.text}
                  </p>
                </div>
              ))}
            </div>

            <p className="lp-note-14 lp-measure-70">{c.stepsNote}</p>
          </div>
        </section>

        {/* ═══ BACK-OFFICE ═══ */}
        <section
          id="backoffice"
          className="lp-section lp-section-surface"
          style={{ padding: 'clamp(50px, 7vw, 88px) var(--space-5)' }}
        >
          <div className="lp-wrap lp-split lp-split-52">
            <div>
              <h2 className="lp-h2-40" style={{ marginBottom: '18px', lineHeight: 1.12 }}>
                {c.backOffice.title}
              </h2>

              <p className="lp-p" style={{ marginBottom: '22px' }}>
                {c.backOffice.text}
              </p>

              <ul className="lp-ticks" style={{ marginBottom: 'var(--space-6)' }}>
                {c.backOffice.points.map((point) => (
                  <li key={point} className="lp-tick">
                    <Icon name="Check" size={17} className="lp-tick-icon" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>

              <a className="pk-btn pk-button-secondary" href="#contact">
                {c.backOffice.cta}
              </a>
            </div>

            <div className="lp-planbox">
              <div className="lp-actions" style={{ gap: '6px', marginBottom: 'var(--space-4)' }}>
                {c.backOffice.tabs.map((tab) => (
                  <span
                    key={tab.label}
                    className={tab.active ? 'lp-bo-tab lp-bo-tab-on' : 'lp-bo-tab'}
                  >
                    {tab.label}
                  </span>
                ))}
              </div>

              <div className="lp-stack lp-gap-seam">
                {c.backOffice.rows.map((row) => (
                  <div key={row.label} className="lp-bo-row">
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-3)',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span
                        style={{ flex: 1, minWidth: '150px', fontSize: '15px', fontWeight: 500 }}
                      >
                        {row.label}
                      </span>
                      <span className={PILL_TONE[row.tone]}>{row.status}</span>
                    </div>
                    <p
                      style={{
                        fontSize: '12.5px',
                        color: 'var(--pk-text-muted)',
                        marginTop: 'var(--space-1)',
                      }}
                    >
                      {row.src}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ═══ BRIEF ORGANISATEUR ═══ */}
        <section id="brief" className="lp-section">
          <div className="lp-wrap lp-split lp-split-start lp-split-52">
            <div>
              <p className="pk-label lp-label-forest" style={{ marginBottom: '14px' }}>
                {c.brief.label}
              </p>

              <h2 className="lp-h2 lp-measure-20" style={{ marginBottom: '18px', lineHeight: 1.1 }}>
                {c.brief.title}
              </h2>

              <p
                className="lp-p-18 lp-measure-56"
                style={{ color: 'var(--pk-text-secondary)', marginBottom: 'var(--space-4)' }}
              >
                {c.brief.lede}
              </p>

              <p
                className="lp-measure-56"
                style={{
                  fontSize: '15.5px',
                  lineHeight: 1.6,
                  color: 'var(--pk-text-muted)',
                  margin: '0 0 22px',
                }}
              >
                {c.brief.note}
              </p>

              <a className="pk-btn pk-button-secondary" href="#contact">
                {c.brief.cta}
              </a>
            </div>

            <div className="lp-form-card">
              <div className="lp-form-head lp-topo">
                <p className="pk-label lp-label-lichen" style={{ marginBottom: 'var(--space-2)' }}>
                  {c.brief.cardLabel}
                </p>
                <p className="lp-hd lp-h3-20">{c.brief.cardTitle}</p>
                <p
                  className="lp-data"
                  style={{ fontSize: '11px', color: 'var(--lp-on-dark-66)', marginTop: '7px' }}
                >
                  {c.brief.cardUpdated}
                </p>
              </div>

              <div style={{ padding: 'var(--space-1) 22px 18px' }}>
                {c.brief.sections.map((section) => (
                  <div key={section.title} className="lp-brief-section">
                    <p className="pk-label" style={{ marginBottom: '9px' }}>
                      {section.title}
                    </p>
                    {section.lines.map((line) => (
                      <p key={line} className="lp-brief-line">
                        {line}
                      </p>
                    ))}
                  </div>
                ))}

                <p className="lp-note-12" style={{ paddingTop: 'var(--space-3)' }}>
                  {c.brief.cardFootnote}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ CONDITIONS J-14 ═══ */}
        <section
          id="conditions"
          className="lp-section lp-section-ink lp-topo-glacier"
          style={{ padding: 'clamp(50px, 7vw, 90px) var(--space-5)' }}
        >
          <div className="lp-wrap">
            <p className="pk-label lp-label-lichen" style={{ marginBottom: '14px' }}>
              {c.conditions.label}
            </p>

            <h2
              className="lp-h2-40 lp-measure-24"
              style={{ marginBottom: '18px', lineHeight: 1.12 }}
            >
              {c.conditions.title}
            </h2>

            <p className="lp-p-18 lp-on-dark-body lp-measure-60" style={{ marginBottom: '34px' }}>
              {c.conditions.lede}
            </p>

            <div className="lp-split lp-split-48">
              <div
                style={{
                  background: 'var(--pk-surface)',
                  color: 'var(--pk-ink)',
                  padding: 'var(--space-5) 22px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 'var(--space-3)',
                    marginBottom: 'var(--space-3)',
                  }}
                >
                  <span className="lp-hd lp-h3-19">{c.conditions.point}</span>
                  <span
                    className="lp-data lp-push"
                    style={{ fontSize: '11.5px', color: 'var(--pk-dawn-ink)' }}
                  >
                    {c.conditions.risk}
                  </span>
                </div>

                <p
                  className="lp-data"
                  style={{
                    fontSize: '13.5px',
                    color: 'var(--pk-text-muted)',
                    marginBottom: '18px',
                  }}
                >
                  {c.conditions.window}
                </p>

                <p className="lp-condition-figure">{c.conditions.figure}</p>

                <p
                  className="lp-measure-38"
                  style={{
                    fontSize: '14.5px',
                    lineHeight: 1.5,
                    color: 'var(--pk-text-secondary)',
                    marginTop: 'var(--space-2)',
                  }}
                >
                  {c.conditions.figureText}
                </p>
              </div>

              <div>
                <p
                  className="lp-p lp-on-dark-body lp-measure-48"
                  style={{ marginBottom: 'var(--space-4)' }}
                >
                  {c.conditions.decision}
                </p>
                <p className="lp-p-15 lp-on-dark-soft lp-measure-48">{c.conditions.published}</p>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ CÔTÉ PARTICIPANT ═══ */}
        <section
          id="participant"
          className="lp-section lp-section-ink lp-topo"
          style={{ padding: 'clamp(50px, 7vw, 90px) var(--space-5)' }}
        >
          <div className="lp-wrap">
            <p className="lp-eyebrow lp-eyebrow-lichen" style={{ marginBottom: 'var(--space-3)' }}>
              {c.participant.eyebrow}
            </p>

            <h2
              className="lp-h2-40 lp-measure-28"
              style={{ marginBottom: '18px', lineHeight: 1.12 }}
            >
              {c.participant.title}
            </h2>

            <p className="lp-p lp-on-dark-body lp-measure-62" style={{ marginBottom: '34px' }}>
              {c.participant.lede}
            </p>

            <div className="lp-split lp-split-start lp-split-52">
              <div className="lp-stack lp-gap-3">
                {c.participant.flow.map((step) => (
                  <div key={step.n} className="lp-flow-row">
                    <span className="lp-flow-num">{step.n}</span>
                    <span className="lp-grow">
                      <span className="lp-flow-title">{step.title}</span>
                      <span className="lp-flow-text">{step.text}</span>
                    </span>
                  </div>
                ))}
              </div>

              <div className="lp-org-card lp-org-card-20">
                <p
                  style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    color: 'var(--pk-text-muted)',
                    marginBottom: 'var(--space-3)',
                  }}
                >
                  {c.participant.cardLabel}
                </p>

                <p
                  style={{
                    fontFamily: 'var(--font-heading)',
                    fontWeight: 700,
                    fontSize: '24px',
                    marginBottom: 'var(--space-1)',
                  }}
                >
                  {c.participant.cardTitle}
                </p>

                <p
                  style={{
                    fontSize: '13.5px',
                    color: 'var(--pk-text-muted)',
                    marginBottom: 'var(--space-4)',
                  }}
                >
                  {c.participant.cardMeta}
                </p>

                <div className="lp-stack lp-gap-seam" style={{ marginBottom: 'var(--space-4)' }}>
                  {c.participant.rows.map((row) => (
                    <div
                      key={row.label}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '11px',
                        padding: '11px 0',
                        boxShadow: 'inset 0 -1px 0 var(--lp-rule)',
                      }}
                    >
                      <Icon name={row.icon} size={17} className="lp-icon-forest" />
                      <span className="lp-grow" style={{ fontSize: '15px' }}>
                        {row.label}
                      </span>
                      <span
                        style={{
                          fontFamily: 'var(--font-heading)',
                          fontWeight: 600,
                          fontSize: '15px',
                        }}
                      >
                        {row.v}
                      </span>
                    </div>
                  ))}
                </div>

                <div
                  style={{
                    padding: '13px 15px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--pk-glacier-bg)',
                  }}
                >
                  <p
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontSize: 'var(--space-3)',
                      fontWeight: 500,
                      color: 'var(--pk-ink)',
                      marginBottom: 'var(--space-1)',
                    }}
                  >
                    <Icon name="SealCheck" size={14} />
                    {c.participant.officialLabel}
                  </p>
                  <p style={{ fontSize: '14px', color: 'var(--pk-forest)' }}>
                    {c.participant.officialText}
                  </p>
                  <p
                    style={{
                      fontSize: '12.5px',
                      color: 'var(--pk-text-muted)',
                      marginTop: '6px',
                    }}
                  >
                    {c.participant.officialSource}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ CONFIDENTIALITÉ ═══ */}
        <section
          id="confidentialite"
          className="lp-section-surface-both"
          style={{ padding: 'clamp(46px, 6vw, var(--space-20)) var(--space-5)' }}
        >
          <div className="lp-wrap-1100">
            <p className="pk-label lp-label-forest" style={{ marginBottom: '14px' }}>
              {c.privacy.label}
            </p>

            <h2
              className="lp-h2-38 lp-measure-24"
              style={{ marginBottom: '18px', lineHeight: 1.12 }}
            >
              {c.privacy.title}
            </h2>

            <div className="lp-auto-260">
              <div>
                <p
                  className="lp-p-15"
                  style={{ color: 'var(--pk-text-secondary)', marginBottom: 'var(--space-3)' }}
                >
                  {c.privacy.neverLabel}
                </p>

                <div className="lp-actions" style={{ gap: 'var(--space-2)' }}>
                  {c.privacy.never.map((item) => (
                    <span key={item} className="lp-chip-privacy">
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              <p className="lp-p-16" style={{ color: 'var(--pk-forest)' }}>
                {c.privacy.text}
              </p>
            </div>
          </div>
        </section>

        {/* ═══ UNE MÊME DONNÉE, PLUSIEURS MÉTIERS ═══ */}
        <section
          id="metiers"
          className="lp-section lp-section-ink lp-topo"
          style={{ padding: 'clamp(50px, 7vw, 90px) var(--space-5)' }}
        >
          <div className="lp-wrap">
            <p className="pk-label lp-label-lichen" style={{ marginBottom: '14px' }}>
              {c.trades.label}
            </p>

            <h2
              className="lp-h2-40 lp-measure-24"
              style={{ marginBottom: '18px', lineHeight: 1.12 }}
            >
              {c.trades.title}
            </h2>

            <div
              className="lp-split lp-split-48"
              style={{ marginTop: '34px', alignItems: 'stretch' }}
            >
              <div className="lp-stack lp-gap-seam">
                {c.trades.roles.map((role) => (
                  <div key={role.who} className="lp-role">
                    <p className="pk-label lp-label-lichen" style={{ marginBottom: '9px' }}>
                      {role.who}
                    </p>
                    <p className="lp-p-15 lp-on-dark-body lp-measure-52">{role.what}</p>
                  </div>
                ))}
              </div>

              <div
                style={{
                  alignSelf: 'start',
                  background: 'var(--pk-surface)',
                  color: 'var(--pk-ink)',
                  boxShadow: 'var(--lp-lift)',
                }}
              >
                <div style={{ padding: 'var(--space-5) 22px 0' }}>
                  <p className="pk-label" style={{ marginBottom: 'var(--space-3)' }}>
                    {c.trades.cardLabel}
                  </p>
                  <p
                    className="lp-data"
                    style={{
                      fontSize: '12px',
                      color: 'var(--pk-text-muted)',
                      marginBottom: 'var(--space-4)',
                    }}
                  >
                    {c.trades.cardMeta}
                  </p>
                </div>

                <div style={{ padding: '0 22px var(--space-2)' }}>
                  <div className="lp-bars">
                    {c.trades.bars.map((bar) => (
                      <div key={bar.t} className="lp-bar">
                        <span
                          className={bar.v === 100 ? 'lp-bar-fill lp-bar-fill-peak' : 'lp-bar-fill'}
                          style={{ height: `${String(Math.max(3, Math.round(bar.v * 0.9)))}px` }}
                        />
                        <span className="lp-bar-time">{bar.t}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    padding: '14px 22px 18px',
                    boxShadow: 'inset 0 1px 0 var(--lp-rule-inner)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
                    <span className="pk-label lp-label-dawn">{c.trades.peakLabel}</span>
                    <span
                      className="lp-data lp-push"
                      style={{ fontSize: '15px', color: 'var(--pk-ink)' }}
                    >
                      {c.trades.peakWindow}
                    </span>
                  </div>

                  <p className="lp-note-12" style={{ marginTop: 'var(--space-3)' }}>
                    {c.trades.coverage}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ BÉNÉFICES ═══ */}
        <section
          id="benefices"
          className="lp-section"
          style={{ padding: 'clamp(50px, 7vw, 88px) var(--space-5)' }}
        >
          <div className="lp-wrap">
            <h2 className="lp-h2 lp-measure-26" style={{ marginBottom: '30px' }}>
              {c.benefits.title}
            </h2>

            <div className="lp-auto-258" style={{ marginBottom: 'var(--space-8)' }}>
              {c.benefits.cards.map((card) => (
                <div key={card.title} className="lp-card">
                  <Icon name={card.icon} size={24} className="lp-icon-forest" />
                  <h3 className="lp-h3-18" style={{ margin: 'var(--space-3) 0 var(--space-2)' }}>
                    {card.title}
                  </h3>
                  <p className="lp-tile-body" style={{ lineHeight: 1.55 }}>
                    {card.text}
                  </p>
                </div>
              ))}
            </div>

            {/*
              Emplacement d'image du prototype (`<image-slot id="pluka-org-photo">`).
              Le gabarit y porte déjà son propre texte d'attente : la photo est à
              fournir par l'organisation, ce n'est pas un asset manquant du dépôt.
            */}
            <div className="lp-photo-slot">
              <p className="lp-note-12 lp-measure-38">{c.benefits.photoPlaceholder}</p>
            </div>
          </div>
        </section>

        {/* ═══ PÉRIMÈTRE ═══ */}
        <section
          className="lp-section-surface-both"
          style={{ padding: 'clamp(46px, 6vw, var(--space-20)) var(--space-5)' }}
        >
          <div className="lp-wrap-1100">
            <h2 className="lp-h2-36" style={{ marginBottom: 'var(--space-6)' }}>
              {c.scope.title}
            </h2>

            <div className="lp-auto-280">
              <div>
                <p
                  className="lp-eyebrow lp-eyebrow-success"
                  style={{ marginBottom: 'var(--space-3)' }}
                >
                  {c.scope.doLabel}
                </p>

                <ul className="lp-ticks" style={{ gap: '9px' }}>
                  {c.scope.doList.map((item) => (
                    <li key={item} className="lp-tick">
                      <Icon name="CheckCircle" size={18} className="lp-icon-success" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p
                  className="lp-eyebrow lp-eyebrow-muted"
                  style={{ marginBottom: 'var(--space-3)' }}
                >
                  {c.scope.dontLabel}
                </p>

                <ul className="lp-ticks" style={{ gap: '9px' }}>
                  {c.scope.dontList.map((item) => (
                    <li key={item} className="lp-tick lp-tick-muted">
                      <Icon name="MinusCircle" size={18} className="lp-icon-faint" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ CONTACT ═══ */}
        <section
          id="contact"
          className="lp-section"
          style={{ padding: 'clamp(50px, 7vw, 88px) var(--space-5)' }}
        >
          <div className="lp-wrap-1000 lp-split lp-split-start lp-split-48">
            <div>
              <h2 className="lp-h2-38" style={{ marginBottom: 'var(--space-3)', lineHeight: 1.12 }}>
                {c.contact.title}
              </h2>

              <p className="lp-p" style={{ fontSize: '16.5px', marginBottom: 'var(--space-5)' }}>
                {c.contact.lede}
              </p>

              <ul className="lp-ticks" style={{ gap: '9px' }}>
                {c.contact.points.map((point) => (
                  <li key={point} className="lp-tick lp-tick-muted" style={{ fontSize: '15px' }}>
                    <Icon name="Check" size={16} className="lp-tick-icon" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>

            <ContactForm />
          </div>
        </section>

        {/* ═══ FAQ ═══ */}
        <section
          id="faq"
          className="lp-section-surface"
          style={{ padding: 'clamp(46px, 6vw, var(--space-20)) var(--space-5)' }}
        >
          <div className="lp-wrap-860">
            <h2 className="lp-h2-36" style={{ marginBottom: 'var(--space-6)' }}>
              Questions des organisateurs
            </h2>

            <FaqList entries={c.faq} compact />
          </div>
        </section>

        {/* ═══ CTA FINAL ═══ */}
        <section
          className="lp-section-ink lp-topo-glacier"
          style={{ padding: 'clamp(52px, 7vw, 96px) var(--space-5)' }}
        >
          <div className="lp-wrap-900">
            <h2 className="lp-h2-46" style={{ marginBottom: 'var(--space-4)' }}>
              {c.finalCta.title}
            </h2>

            <p
              className="lp-on-dark-body lp-measure-56"
              style={{
                fontSize: 'clamp(16.5px, 2vw, 19px)',
                lineHeight: 1.55,
                margin: '0 0 30px',
              }}
            >
              {c.finalCta.lede}
            </p>

            <div className="lp-actions">
              <a className="pk-btn pk-button-primary" href="#contact">
                {c.finalCta.primary}
                <Icon name="ArrowRight" size={20} />
              </a>
              <Link className="pk-btn pk-button-ghost-dark" href="/">
                {c.finalCta.secondary}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter
        layout="inline"
        tagline={c.footerTagline}
        columns={c.footerColumns}
        domain="pluka.run/organisateurs"
      />
    </div>
  );
}
