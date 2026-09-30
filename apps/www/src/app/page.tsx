import type { Metadata } from 'next';
import Link from 'next/link';

import { FaqList } from '@/components/faq-list';
import { Icon } from '@/components/icon';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import * as c from '@/content/homepage';
import { publicEnv } from '@/lib/env';

/**
 * Homepage coureur — `reference/prototype/PLUKA Homepage.dc.html`.
 *
 * Server Component, comme tout ce qui est lecture (01_ARCHITECTURE.md §6.1).
 * Aucune donnée privée n'entre ici et aucun client Supabase n'y est construit :
 * `apps/www` ne lit pas la base (§4.1). Les douze sections sont du contenu
 * statique, repris du prototype sans ajout ni coupe.
 *
 * Seul état de la page : l'entrée de FAQ ouverte et le menu replié, tous deux
 * isolés dans des Client Components. Le reste est rendu au build.
 */

export const metadata: Metadata = {
  alternates: { canonical: '/' },
  openGraph: {
    url: '/',
    title: 'PLUKA — Prépare ton trail : plan de course, nutrition et assistance',
    description:
      'À partir du parcours et des informations officielles de ta course, PLUKA construit ton plan personnel : temps de passage, barrières, nutrition, matériel et assistance.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PLUKA — Prépare ton trail',
    description:
      'Plan de course, temps de passage, barrières horaires, nutrition, matériel et assistance : tout au même endroit.',
  },
};

/**
 * Données structurées reprises du prototype. `pluka.run` et `app.pluka.run` y
 * sont écrits en dur ; ici les URL viennent de la configuration publique, pour
 * qu'un environnement de recette ne déclare pas l'identité de la production.
 */
function StructuredData({ site, app }: { readonly site: string; readonly app: string }) {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${site}/#website`,
        url: `${site}/`,
        name: 'PLUKA',
        inLanguage: 'fr-FR',
        publisher: { '@id': `${site}/#org` },
      },
      {
        '@type': 'Organization',
        '@id': `${site}/#org`,
        name: 'PLUKA',
        url: `${site}/`,
        description:
          'PLUKA transforme les informations officielles d’une course de trail en préparation personnelle : plan de course, nutrition, matériel et assistance.',
      },
      {
        '@type': 'SoftwareApplication',
        name: 'PLUKA',
        applicationCategory: 'SportsApplication',
        operatingSystem: 'Web',
        url: `${app}/`,
        publisher: { '@id': `${site}/#org` },
        description:
          'Préparation de trail et d’ultra-trail : plan de course, temps de passage, barrières horaires, nutrition, matériel, sacs et assistance.',
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

/** Profil altimétrique du hero, avec les temps de passage estimés. */
function HeroProfile() {
  return (
    <svg
      viewBox="0 0 620 150"
      role="img"
      aria-label="Profil altimétrique du Wildstrubel 70 avec les temps de passage estimés"
      className="lp-profile"
    >
      <path
        d="M14 118 L60 78 L110 42 L200 96 L250 66 L300 110 L370 82 L420 30 L606 74 L606 132 L14 132 Z"
        className="lp-profile-fill"
      />
      <path
        d="M14 118 L60 78 L110 42 L200 96 L250 66 L300 110 L370 82 L420 30 L606 74"
        strokeWidth="2.2"
        className="lp-profile-line"
      />

      <g className="lp-pop-1">
        <line x1="200" y1="96" x2="200" y2="140" className="lp-profile-stem" />
        <circle cx="200" cy="96" r="5" strokeWidth="2.5" className="lp-profile-node" />
        <text x="200" y="84" textAnchor="middle" className="lp-profile-eta">
          11:42
        </text>
      </g>

      <g className="lp-pop-2">
        <line x1="300" y1="110" x2="300" y2="140" className="lp-profile-stem" />
        <circle cx="300" cy="110" r="5" strokeWidth="2.5" className="lp-profile-node" />
        <text x="300" y="98" textAnchor="middle" className="lp-profile-eta">
          14:35
        </text>
      </g>

      <g className="lp-pop-3">
        <line x1="420" y1="30" x2="420" y2="140" className="lp-profile-stem-alert" />
        <path d="M420 12 L431 32 L409 32 Z" className="lp-profile-flag" />
        <text x="420" y="8" textAnchor="middle" className="lp-profile-eta lp-profile-eta-alert">
          15:54
        </text>
      </g>

      <text x="14" y="148" className="lp-profile-place">
        Kandersteg
      </text>
      <text x="220" y="148" textAnchor="middle" className="lp-profile-place">
        Adelboden
      </text>
      <text x="606" y="148" textAnchor="end" className="lp-profile-place">
        Crans-Montana
      </text>
    </svg>
  );
}

/** Profil altimétrique de la section Conditions, avec les températures prévues. */
function ConditionsProfile() {
  return (
    <svg
      viewBox="0 0 560 150"
      role="img"
      aria-label="Profil du Wildstrubel 70 avec les conditions prévues aux points de passage"
      className="lp-profile"
    >
      <path
        d="M12 118 L58 82 L104 44 L188 98 L236 70 L284 112 L344 86 L392 34 L548 78 L548 132 L12 132 Z"
        className="lp-profile-fill"
      />
      <path
        d="M12 118 L58 82 L104 44 L188 98 L236 70 L284 112 L344 86 L392 34 L548 78"
        strokeWidth="2.1"
        className="lp-profile-line"
      />

      <g className="lp-pop-1">
        <circle cx="104" cy="44" r="4.5" strokeWidth="2" className="lp-profile-node" />
        <text x="104" y="32" textAnchor="middle" className="lp-profile-temp">
          3°
        </text>
      </g>

      <g className="lp-pop-2">
        <circle cx="284" cy="112" r="4.5" strokeWidth="2" className="lp-profile-node" />
        <text x="284" y="100" textAnchor="middle" className="lp-profile-temp">
          14°
        </text>
      </g>

      <g className="lp-pop-3">
        <line x1="392" y1="34" x2="392" y2="132" className="lp-profile-stem-alert" />
        <circle cx="392" cy="34" r="6" strokeWidth="2" className="lp-profile-node-alert" />
        <text x="392" y="20" textAnchor="middle" className="lp-profile-temp lp-profile-eta-alert">
          4°
        </text>
      </g>

      <text x="12" y="148" className="lp-profile-place">
        Kandersteg
      </text>
      <text x="392" y="148" textAnchor="middle" className="lp-profile-place lp-profile-place-alert">
        Rawil
      </text>
      <text x="548" y="148" textAnchor="end" className="lp-profile-place">
        Crans-Montana
      </text>
    </svg>
  );
}

/*
 * Les quatre tables ci-dessous traduisent une tonalité de contenu en classes.
 * `as const` les rend totales sur leurs clés littérales : avec
 * `noUncheckedIndexedAccess`, un `Record<string, string>` renverrait
 * `string | undefined` et masquerait une tonalité oubliée derrière un repli.
 */
const PILL_TONE = {
  glacier: 'lp-pill lp-pill-glacier',
  community: 'lp-pill lp-pill-community',
  official: 'lp-pill lp-pill-official',
  check: 'lp-pill lp-pill-check',
} as const;

const STATUS_TONE = {
  glacier: 'lp-status lp-pill-glacier',
  success: 'lp-status lp-pill-official',
  community: 'lp-status lp-pill-community',
} as const;

const ICON_TONE = {
  muted: 'lp-icon-muted',
  forest: 'lp-icon-forest',
  warning: 'lp-icon-warning',
} as const;

const PLAN_ROW = {
  plain: 'lp-plan-row',
  glacier: 'lp-plan-row lp-plan-row-glacier',
  warning: 'lp-plan-row lp-plan-row-warning',
} as const;

export default function HomePage() {
  const env = publicEnv();
  const app = env.NEXT_PUBLIC_APP_URL;
  const site = env.NEXT_PUBLIC_SITE_URL;

  return (
    <div className="lp-shell">
      <StructuredData site={site} app={app} />

      <div aria-hidden="true" className="lp-backdrop" />

      <SiteHeader
        audience="coureur"
        claim={c.claim}
        links={c.navLinks}
        homeHref="/"
        action={{ label: 'Préparer ma course', href: app }}
        login={{ label: 'Connexion', href: `${app}/connexion` }}
        cross={{
          href: '/organisateurs',
          title: `Vous organisez une course ?`,
          text: 'Voir PLUKA pour les organisateurs',
          audience: 'organisateur',
        }}
      />

      <main id="top" className="lp-main">
        {/* ═══ HERO ═══ */}
        <section className="lp-section-hero">
          <div className="lp-wrap lp-hero-grid">
            <div className="lp-enter">
              <p className="lp-eyebrow" style={{ marginBottom: 'var(--space-4)' }}>
                {c.hero.eyebrow}
              </p>

              <h1 className="lp-h1" style={{ marginBottom: 'var(--space-5)' }}>
                {c.hero.titleTop}
                <br />
                {c.hero.titleBottom}
              </h1>

              <p
                className="lp-lede lp-measure-58"
                style={{ marginBottom: 'var(--space-8)', fontSize: 'clamp(17px, 2vw, 20px)' }}
              >
                {c.hero.lede}
              </p>

              <div className="lp-actions" style={{ marginBottom: 'var(--space-4)' }}>
                <a className="pk-btn pk-button-primary" href={app}>
                  {c.hero.primary}
                  <Icon name="ArrowRight" size={20} />
                </a>
                <a className="pk-btn pk-button-secondary" href="#comment">
                  {c.hero.secondary}
                </a>
              </div>

              <p className="lp-note">{c.hero.note}</p>
            </div>

            <div className="lp-enter-delayed">
              <div className="lp-device lp-topo">
                <div className="lp-device-head">
                  <p
                    className="pk-label lp-label-lichen"
                    style={{ marginBottom: 'var(--space-3)' }}
                  >
                    {c.heroPlan.label}
                  </p>

                  <div className="lp-hero-eta">
                    <span className="lp-hero-eta-value">{c.heroPlan.eta}</span>
                    <span
                      className="lp-data"
                      style={{ fontSize: '11.5px', color: 'var(--lp-on-dark-66)' }}
                    >
                      {c.heroPlan.meta}
                    </span>
                  </div>

                  <div className="lp-hero-facts">
                    {c.heroPlan.facts.map((fact) => (
                      <div key={fact.label}>
                        <p
                          className="pk-label lp-label-on-dark"
                          style={{ marginBottom: 'var(--space-2)' }}
                        >
                          {fact.label}
                        </p>
                        <p
                          className={
                            fact.tone === 'lichen'
                              ? 'lp-fact-value lp-fact-value-lichen'
                              : fact.tone === 'dawn'
                                ? 'lp-fact-value lp-fact-value-dawn'
                                : 'lp-fact-value'
                          }
                        >
                          {fact.value}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="lp-device-chart">
                  <p className="pk-label lp-label-on-dark" style={{ marginBottom: '6px' }}>
                    Profil du parcours
                  </p>
                  <HeroProfile />
                </div>

                <div className="lp-device-foot">
                  {c.heroPlan.rows.map((row) => (
                    <div key={row.label} className="lp-device-row">
                      {row.mark === 'dot' ? <span className="lp-dot" /> : null}
                      {row.mark === 'triangle' ? <span className="lp-tri-mark" /> : null}
                      {row.mark === 'crew' ? (
                        <Icon name="UsersThree" size={17} className="lp-icon-forest" />
                      ) : null}

                      <span className="lp-device-row-label">{row.label}</span>

                      {row.meta === null ? null : (
                        <span
                          className="lp-data"
                          style={{
                            fontSize: '10.5px',
                            color:
                              row.metaTone === 'dawn'
                                ? 'var(--pk-dawn-ink)'
                                : 'var(--pk-text-muted)',
                          }}
                        >
                          {row.meta}
                        </span>
                      )}

                      <span className="lp-data" style={{ fontSize: '14px' }}>
                        {row.eta}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ PROBLÈME ═══ */}
        <section
          className="lp-section-surface-both"
          style={{ padding: 'clamp(var(--space-12), 6vw, var(--space-20)) var(--space-5)' }}
        >
          <div className="lp-wrap-1000">
            <h2 className="lp-h2-40 lp-measure-30" style={{ marginBottom: 'var(--space-5)' }}>
              {c.problem.title}
            </h2>

            <div className="lp-scatter">
              <div className="lp-stack" style={{ gap: '9px' }}>
                {c.problem.scatter.map((item) => (
                  <p key={item.label} className="lp-scatter-line">
                    <Icon name={item.icon} size={18} className="lp-scatter-icon" />
                    {item.label}
                  </p>
                ))}
              </div>

              <div>
                <p
                  className="lp-p"
                  style={{ color: 'var(--pk-forest)', marginBottom: 'var(--space-3)' }}
                >
                  PLUKA rassemble ces informations autour d’une seule chose
                  {' '}: <b style={{ fontWeight: 600 }}>ton plan de course</b>. Les horaires, les
                  barrières, les sacs, la nutrition et les consignes de ton accompagnant deviennent
                  un seul document vivant, qui se recalcule quand tu changes d’avis.
                </p>

                <a href="#produit" className="lp-inline-link">
                  {c.problem.cta}
                  <Icon name="ArrowDown" size={18} />
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ COMMENT ÇA MARCHE ═══ */}
        <section
          id="comment"
          className="lp-section"
          style={{ paddingTop: 'clamp(52px, 7vw, 90px)' }}
        >
          <div className="lp-wrap">
            <p className="lp-eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
              Comment ça marche
            </p>

            <h2 className="lp-h2 lp-measure-24" style={{ marginBottom: '34px' }}>
              Trois étapes, et ta course est organisée.
            </h2>

            <div className="lp-auto-270" style={{ marginBottom: '30px' }}>
              {c.steps.map((step) => (
                <div key={step.num} className="lp-card lp-card-step">
                  <p className="lp-step-num">{step.num}</p>
                  <h3 className="lp-h3" style={{ marginBottom: 'var(--space-2)' }}>
                    {step.title}
                  </h3>
                  <p className="lp-tile-body" style={{ fontSize: '15.5px', lineHeight: 1.55 }}>
                    {step.text}
                  </p>
                </div>
              ))}
            </div>

            <a className="pk-btn pk-button-primary" href={app}>
              Trouver ma course
              <Icon name="MagnifyingGlass" size={20} />
            </a>
          </div>
        </section>

        {/* ═══ LE PLAN ═══ */}
        <section id="produit" className="lp-section lp-section-surface">
          <div className="lp-wrap lp-split">
            <div>
              <p className="lp-eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
                Le cœur de PLUKA
              </p>

              <h2 className="lp-h2" style={{ marginBottom: '18px' }}>
                Un vrai plan de course.
                <br />
                Pas une règle de trois.
              </h2>

              <p className="lp-p" style={{ marginBottom: '22px' }}>
                PLUKA utilise le parcours, le dénivelé, les sections, les ravitaillements, tes
                arrêts et les barrières horaires pour construire tes temps de passage. Tu ajustes
                une section ou tu verrouilles un horaire{' '}: tout le reste se recalcule.
              </p>

              <ul
                className="lp-ticks"
                style={{ gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}
              >
                {c.planPoints.map((point) => (
                  <li key={point} className="lp-tick">
                    <Icon name="Check" size={17} className="lp-tick-icon" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>

              <a className="pk-btn pk-button-secondary" href={app}>
                Construire mon plan
              </a>
            </div>

            <div className="lp-planbox">
              <div className="lp-planbox-head">
                <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--pk-text-muted)' }}>
                  Mon plan
                </span>
                <span className="lp-planbox-eta">12 h 37</span>
                <span style={{ fontSize: '13px', color: 'var(--pk-text-muted)' }}>
                  objectif 12 h 30 · stratégie régulière
                </span>
              </div>

              <div className="lp-stack lp-gap-hair">
                {c.timeline.map((point) => (
                  <div key={point.name} className={PLAN_ROW[point.row]}>
                    <Icon name={point.icon} size={17} className={ICON_TONE[point.tone]} />
                    <span className="lp-grow">
                      <span className="lp-plan-row-name">{point.name}</span>
                      <span className="lp-plan-row-meta">{point.meta}</span>
                    </span>
                    <span className="lp-plan-row-eta">{point.eta}</span>
                  </div>
                ))}
              </div>

              <div
                className="lp-actions"
                style={{ gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}
              >
                <span className="lp-chip lp-chip-surface">
                  Arrêts cumulés <b style={{ fontWeight: 600 }}>26 min</b>
                </span>
                <span className="lp-chip lp-chip-warning">Marge mini 37 min · Iffigenalp</span>
                <span className="lp-chip lp-chip-glacier">Passage verrouillé à Lenk</span>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ TON PLAN ORGANISE LE RESTE ═══ */}
        <section
          id="autour"
          className="lp-section lp-section-ink lp-topo"
          style={{ padding: 'clamp(52px, 7vw, 92px) var(--space-5)' }}
        >
          <div className="lp-wrap">
            <p className="pk-label lp-label-lichen" style={{ marginBottom: '14px' }}>
              Autour du plan
            </p>

            <h2 className="lp-h2 lp-measure-22" style={{ marginBottom: '18px' }}>
              Ton plan organise le reste.
            </h2>

            <p className="lp-p-18 lp-on-dark-body lp-measure-60" style={{ marginBottom: '38px' }}>
              Nutrition, matériel et assistance ne sont pas trois outils séparés{' '}: ce sont des
              conséquences de ton plan. Change un horaire, et tout se recale.
            </p>

            <div className="lp-tri">
              {c.around.map((block) => (
                <div key={block.label} className="lp-tile">
                  <p className="pk-label" style={{ marginBottom: '14px' }}>
                    {block.label}
                  </p>

                  <p className="lp-hd lp-h3-20" style={{ marginBottom: 'var(--space-3)' }}>
                    {block.title}
                  </p>

                  <p className="lp-tile-body" style={{ marginBottom: '18px' }}>
                    {block.text}
                  </p>

                  <div className="lp-inset">
                    <p
                      className="lp-data"
                      style={{
                        fontSize: '11px',
                        color: 'var(--pk-text-muted)',
                        marginBottom: '9px',
                      }}
                    >
                      {block.insetLabel}
                    </p>

                    {block.valueMono ? (
                      <p className="lp-data" style={{ fontSize: '14px', color: 'var(--pk-ink)' }}>
                        {block.insetValue}
                      </p>
                    ) : (
                      <p style={{ fontSize: '13.5px', color: 'var(--pk-ink)', padding: '2px 0' }}>
                        {block.insetValue}
                      </p>
                    )}

                    <p
                      className={block.noteMono ? 'lp-data' : undefined}
                      style={{
                        fontSize: block.noteMono ? '11px' : '13px',
                        color: 'var(--pk-text-muted)',
                        marginTop: 'var(--space-2)',
                      }}
                    >
                      {block.insetNote}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ CONDITIONS DE COURSE ═══ */}
        <section id="conditions" className="lp-section lp-section-surface">
          <div className="lp-wrap lp-split">
            <div>
              <p className="pk-label lp-label-forest" style={{ marginBottom: '14px' }}>
                {c.conditions.label}
              </p>

              <h2 className="lp-h2 lp-measure-22" style={{ marginBottom: '18px', lineHeight: 1.1 }}>
                {c.conditions.title}
              </h2>

              <p
                className="lp-p-18 lp-measure-54"
                style={{ color: 'var(--pk-text-secondary)', marginBottom: 'var(--space-5)' }}
              >
                {c.conditions.lede}
              </p>

              <p
                className="lp-p-15 lp-measure-54"
                style={{ color: 'var(--pk-text-muted)', marginBottom: 'var(--space-6)' }}
              >
                {c.conditions.note}
              </p>

              <div className="lp-actions" style={{ gap: 'var(--space-2)' }}>
                {c.conditions.chips.map((chip) => (
                  <span key={chip} className="lp-chip-data">
                    {chip}
                  </span>
                ))}
              </div>
            </div>

            <div className="lp-device lp-topo">
              <div className="lp-device-head-sm">
                <p className="pk-label lp-label-lichen" style={{ marginBottom: '11px' }}>
                  {c.conditions.label}
                </p>

                <div className="lp-flex-baseline">
                  <span className="lp-hd lp-h3-19">{c.conditions.point}</span>
                  <span
                    className="lp-data"
                    style={{ fontSize: '11px', color: 'var(--lp-on-dark-66)' }}
                  >
                    {c.conditions.pointMeta}
                  </span>
                </div>

                <p
                  className="lp-data"
                  style={{
                    fontSize: '12px',
                    color: 'var(--pk-lichen)',
                    marginTop: 'var(--space-2)',
                    paddingBottom: 'var(--space-4)',
                  }}
                >
                  {c.conditions.pointEta}
                </p>
              </div>

              <div className="lp-device-chart-sm">
                <ConditionsProfile />
              </div>

              <div className="lp-device-foot lp-device-foot-16">
                {c.conditions.rows.map((row) => (
                  <div key={row.label} className="lp-device-row">
                    {row.mark === 'dot' ? (
                      <span className="lp-dot" />
                    ) : (
                      <span className="lp-tri-mark" />
                    )}
                    <span className="lp-device-row-label">{row.label}</span>
                    <span className="lp-data" style={{ fontSize: '13px' }}>
                      {row.value}
                    </span>
                  </div>
                ))}

                <div
                  className="lp-device-row"
                  style={{
                    borderBottom: 0,
                    padding: '13px 0 var(--space-1)',
                    gap: 'var(--space-3)',
                  }}
                >
                  <Icon name="Backpack" size={17} className="lp-icon-forest" />
                  <span
                    className="lp-grow"
                    style={{ fontSize: '13.5px', color: 'var(--pk-text-muted)' }}
                  >
                    {c.conditions.prep}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ SOURCES ET DEMANDER À PLUKA ═══ */}
        <section id="fiabilite" className="lp-section">
          <div className="lp-wrap">
            <h2 className="lp-h2 lp-measure-26" style={{ marginBottom: 'var(--space-4)' }}>
              {c.reliability.title}
            </h2>

            <p className="lp-p lp-measure-64" style={{ marginBottom: 'var(--space-8)' }}>
              {c.reliability.lede}
            </p>

            <div className="lp-auto-280" style={{ marginBottom: 'var(--space-5)' }}>
              {c.statuses.map((status) => (
                <div key={status.label} className="lp-card lp-card-22">
                  <span
                    className={STATUS_TONE[status.tone]}
                    style={{ marginBottom: 'var(--space-3)' }}
                  >
                    <Icon name={status.icon} size={14} />
                    {status.label}
                  </span>
                  <p className="lp-tile-body" style={{ lineHeight: 1.55 }}>
                    {status.text}
                  </p>
                </div>
              ))}
            </div>

            <div className="lp-auto-300">
              <div className="lp-card lp-card-22">
                <p
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: 'var(--space-3)',
                    fontWeight: 500,
                    marginBottom: 'var(--space-2)',
                  }}
                >
                  <Icon name="SealCheck" size={14} />
                  {c.reliability.source.kicker}
                </p>

                <p style={{ fontSize: '16px', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                  {c.reliability.source.title}
                </p>

                <p
                  style={{
                    fontSize: '13.5px',
                    color: 'var(--pk-text-muted)',
                    marginBottom: 'var(--space-3)',
                  }}
                >
                  {c.reliability.source.meta}
                </p>

                <blockquote className="lp-quote">{c.reliability.source.quote}</blockquote>

                <a href="#fiabilite" className="lp-inline-link lp-inline-link-14">
                  {c.reliability.source.cta}
                  <Icon name="ArrowUpRight" size={16} />
                </a>
              </div>

              <div className="lp-card lp-card-22">
                <h3 className="lp-h3-20" style={{ marginBottom: '6px' }}>
                  {c.reliability.ask.title}
                </h3>

                <p
                  style={{
                    fontSize: '14.5px',
                    color: 'var(--pk-text-secondary)',
                    marginBottom: 'var(--space-4)',
                  }}
                >
                  {c.reliability.ask.text}
                </p>

                <p className="lp-ask-question" style={{ marginBottom: 'var(--space-3)' }}>
                  {c.reliability.ask.question}
                </p>

                <div className="lp-ask-answer">
                  <p
                    style={{
                      fontSize: '15px',
                      color: 'var(--pk-ink)',
                      marginBottom: 'var(--space-2)',
                    }}
                  >
                    {c.reliability.ask.answer}
                  </p>
                  <p style={{ fontSize: '12.5px', color: 'var(--pk-text-muted)' }}>
                    {c.reliability.ask.answerSource}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ TOUTE LA SAISON ═══ */}
        <section id="saison" className="lp-section">
          <div className="lp-wrap">
            <p className="lp-eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
              {c.season.eyebrow}
            </p>

            <h2 className="lp-h2 lp-measure-24" style={{ marginBottom: 'var(--space-4)' }}>
              {c.season.title}
            </h2>

            <p className="lp-p lp-measure-62" style={{ marginBottom: 'var(--space-8)' }}>
              {c.season.lede}
            </p>

            <div className="lp-auto-258" style={{ marginBottom: 'var(--space-8)' }}>
              {c.season.cards.map((card) => (
                <div key={card.title} className="lp-card">
                  <Icon name={card.icon} size={24} className="lp-icon-forest" />
                  <h3 className="lp-h3-19" style={{ margin: 'var(--space-3) 0 var(--space-2)' }}>
                    {card.title}
                  </h3>
                  <p className="lp-tile-body" style={{ lineHeight: 1.55 }}>
                    {card.text}
                  </p>
                </div>
              ))}
            </div>

            <div className="lp-beta" style={{ marginBottom: '26px' }}>
              <p className="pk-label lp-label-lichen" style={{ marginBottom: 'var(--space-2)' }}>
                {c.season.beta.label}
              </p>
              <p className="lp-note-14 lp-on-dark-body">{c.season.beta.text}</p>
            </div>

            <div
              className="lp-auto-250"
              style={{
                gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                gap: 'var(--space-3)',
                marginBottom: '22px',
              }}
            >
              {c.pricing.map((plan) => (
                <div
                  key={plan.name}
                  className={plan.featured ? 'lp-price lp-price-featured' : 'lp-price'}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      marginBottom: 'var(--space-2)',
                    }}
                  >
                    <span className="lp-price-name">{plan.name}</span>
                    {plan.tag === null ? null : <span className="lp-price-tag">{plan.tag}</span>}
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: '6px',
                      marginBottom: 'var(--space-1)',
                    }}
                  >
                    <span className="lp-price-amount">{plan.price}</span>
                    <span style={{ fontSize: '13px', color: 'var(--pk-text-muted)' }}>
                      {plan.unit}
                    </span>
                  </div>

                  <p
                    style={{
                      fontSize: '13px',
                      color: 'var(--pk-text-muted)',
                      marginBottom: 'var(--space-4)',
                    }}
                  >
                    {plan.sub}
                  </p>

                  <ul
                    className="lp-stack"
                    style={{
                      gap: '7px',
                      marginBottom: 'var(--space-5)',
                      padding: 0,
                      listStyle: 'none',
                    }}
                  >
                    {plan.lines.map((line) => (
                      <li key={line} className="lp-price-line">
                        <Icon name="Check" size={15} className="lp-tick-icon" />
                        {line}
                      </li>
                    ))}
                  </ul>

                  <a
                    className={`pk-btn ${plan.featured ? 'pk-button-primary' : 'pk-button-secondary'} lp-price-cta`}
                    href={app}
                  >
                    {plan.cta}
                  </a>
                </div>
              ))}
            </div>

            <p className="lp-note lp-measure-70">{c.season.footnote}</p>
          </div>
        </section>

        {/* ═══ ORGANISATEURS ═══ */}
        <section
          id="organisateurs"
          className="lp-section lp-section-forest lp-topo-glacier"
          style={{ padding: 'clamp(52px, 7vw, 92px) var(--space-5)' }}
        >
          <div className="lp-wrap">
            <p className="lp-eyebrow lp-eyebrow-lichen" style={{ marginBottom: 'var(--space-3)' }}>
              {c.organisers.eyebrow}
            </p>

            <h2 className="lp-h2 lp-measure-28" style={{ marginBottom: '18px' }}>
              {c.organisers.title}
            </h2>

            <p className="lp-p lp-on-dark-body lp-measure-62" style={{ marginBottom: '34px' }}>
              {c.organisers.lede}
            </p>

            <div className="lp-split lp-split-start lp-split-52" style={{ marginBottom: '34px' }}>
              <div className="lp-auto-230">
                {c.organisers.benefits.map((benefit) => (
                  <div key={benefit.title}>
                    <h3 className="lp-h3-17" style={{ marginBottom: '6px' }}>
                      {benefit.title}
                    </h3>
                    <p
                      style={{
                        fontSize: '14.5px',
                        lineHeight: 1.55,
                        color: 'var(--pk-lichen)',
                        margin: 0,
                      }}
                    >
                      {benefit.text}
                    </p>
                  </div>
                ))}
              </div>

              <div className="lp-org-card">
                <div className="lp-planbox-head" style={{ gap: 'var(--space-3)' }}>
                  <span
                    style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '19px' }}
                  >
                    {c.organisers.card.title}
                  </span>
                  <span style={{ fontSize: '12.5px', color: 'var(--pk-text-muted)' }}>
                    {c.organisers.card.meta}
                  </span>
                </div>

                <div className="lp-stack lp-gap-seam">
                  {c.organisers.card.rows.map((row) => (
                    <div
                      key={row.label}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-3)',
                        padding: '11px 0',
                        boxShadow: 'inset 0 -1px 0 var(--lp-rule)',
                      }}
                    >
                      <Icon name={row.icon} size={17} className="lp-icon-muted" />
                      <span className="lp-grow" style={{ fontSize: '14.5px' }}>
                        {row.label}
                      </span>
                      <span className={PILL_TONE[row.tone]}>{row.status}</span>
                    </div>
                  ))}
                </div>

                <div
                  style={{
                    marginTop: 'var(--space-4)',
                    paddingTop: 'var(--space-3)',
                    boxShadow: 'inset 0 1px 0 var(--lp-rule-strong)',
                  }}
                >
                  <p
                    style={{
                      fontSize: '12px',
                      fontWeight: 500,
                      color: 'var(--pk-text-muted)',
                      marginBottom: 'var(--space-3)',
                    }}
                  >
                    {c.organisers.card.flowLabel}
                  </p>

                  <div className="lp-stack" style={{ gap: '7px' }}>
                    {c.organisers.card.flow.map((step) => (
                      <p
                        key={step}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '9px',
                          fontSize: '14px',
                          color: 'var(--pk-forest)',
                          margin: 0,
                        }}
                      >
                        <Icon name="ArrowDown" size={13} className="lp-icon-faint" />
                        {step}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="lp-actions">
              <Link className="pk-btn pk-button-primary" href="/organisateurs">
                {c.organisers.primary}
                <Icon name="ArrowRight" size={20} />
              </Link>
              <Link className="pk-btn pk-button-ghost-dark" href="/organisateurs#contact">
                {c.organisers.secondary}
              </Link>
            </div>
          </div>
        </section>

        {/* ═══ EARLY ACCESS ═══ */}
        <section
          id="contact"
          className="lp-section"
          style={{ padding: 'clamp(52px, 7vw, 84px) var(--space-5)' }}
        >
          <div className="lp-wrap-820">
            <h2 className="lp-h2-38" style={{ marginBottom: 'var(--space-3)' }}>
              {c.earlyAccess.title}
            </h2>

            <p className="lp-p lp-measure-60" style={{ marginBottom: '26px' }}>
              {c.earlyAccess.lede}
            </p>

            <div className="lp-actions">
              <a className="pk-btn pk-button-primary" href={app}>
                {c.earlyAccess.primary}
              </a>
              <Link className="pk-btn pk-button-secondary" href="/organisateurs">
                {c.earlyAccess.secondary}
              </Link>
            </div>
          </div>
        </section>

        {/* ═══ FAQ ═══ */}
        <section
          id="ressources"
          className="lp-section-surface"
          style={{ padding: 'clamp(var(--space-12), 6vw, 84px) var(--space-5)' }}
        >
          <div className="lp-wrap-860">
            <h2 className="lp-h2-38" style={{ marginBottom: '26px' }}>
              Questions fréquentes sur la préparation d’un trail
            </h2>

            <FaqList entries={c.faq} />
          </div>
        </section>

        {/* ═══ CTA FINAL ═══ */}
        <section
          className="lp-section-ink lp-topo-glacier"
          style={{ padding: 'clamp(56px, 8vw, 104px) var(--space-5)' }}
        >
          <div className="lp-wrap-900">
            <h2 className="lp-h2-52" style={{ marginBottom: 'var(--space-4)' }}>
              {c.finalCta.title}
            </h2>

            <p
              className="lp-on-dark-body lp-measure-56"
              style={{
                fontSize: 'clamp(17px, 2vw, 19px)',
                lineHeight: 1.55,
                margin: '0 0 30px',
              }}
            >
              {c.finalCta.lede}
            </p>

            <div className="lp-actions">
              <a className="pk-btn pk-button-primary" href={app}>
                {c.finalCta.primary}
                <Icon name="ArrowRight" size={20} />
              </a>
              <Link className="pk-btn pk-button-ghost-dark" href="/organisateurs">
                {c.finalCta.secondary}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter
        layout="grid"
        tagline={c.footerTagline}
        columns={c.footerColumns}
        domain="pluka.run"
        disclaimer={c.footerDisclaimer}
      />
    </div>
  );
}
