import { getMyIdentity, getTrailProfile, illustrationFor } from '@pluka/domain';
import { Badge, TerrainBand } from '@pluka/ui';
import Link from 'next/link';

import { IdentityForm, PhotoForm } from '@/app/(shell)/profil/identity-forms';
import { ProfileForms } from '@/app/(shell)/profil/profile-forms';
import { DeleteAccountForm } from '@/components/account-forms';
import { Avatar, type AvatarSource } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { publicEnv } from '@/lib/env';
import { identityContext } from '@/lib/identity';
import { organizerPathOf } from '@/lib/organizer-link';
import { requireProfileContext } from '@/lib/profile';
import { repereEnabled } from '@/lib/repere';
import { requireSession } from '@/lib/session';

/**
 * Mon profil — `05_ROUTES_FLOWS.md` §5.3, 00_PRODUCT_SPEC §8, §21 ;
 * 03_PRIVACY_RLS §54.1.
 *
 * Une bande d'en-tête dit qui l'on est pour PLUKA et pour la Communauté :
 * photo ou illustration, nom, « Prénom N. ». Dessous, un encart par sujet :
 * l'identité (et la photo), le Profil trailer qui sert toutes les courses, le
 * Repère, puis les données du compte. Sur grand écran, un sommaire les relie.
 *
 * Le Profil trailer reste en deux étapes sur une même route : ce sont des
 * étapes de formulaire, donc un état, pas deux adresses (05 §1.2). Un profil
 * partiel est un état normal (§7.2) : le use case dit s'il est complet, il ne
 * l'exige pas.
 */

export const metadata = { title: 'Mon profil' };

export default async function ProfilePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const cancelled = (await searchParams).suppression === 'annulee';
  const session = await requireSession('/profil');
  const [view, identity, organizerHref] = await Promise.all([
    getTrailProfile(await requireProfileContext('/profil')),
    getMyIdentity(identityContext(session)),
    // Sur mobile, la barre du bas est pleine : c'est ici que le lien se trouve.
    organizerPathOf(session),
  ]);
  const repere = repereEnabled();

  const avatar: AvatarSource =
    identity.photoUrl === null
      ? { kind: identity.illustration }
      : { kind: 'photo', url: identity.photoUrl };
  const fullName = [identity.firstName, identity.lastName]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(' ');

  const sections = [
    { id: 'identite', label: 'Identité', icon: 'IdentificationCard' as const },
    { id: 'profil-trailer', label: 'Profil trailer', icon: 'Gauge' as const },
    ...(repere ? [{ id: 'repere', label: 'Repère PLUKA', icon: 'Sparkle' as const }] : []),
    { id: 'donnees', label: 'Mes données', icon: 'ShieldCheck' as const },
  ];

  return (
    <div className="pf-page">
      <TerrainBand
        tone="dark"
        topo
        eyebrow="Mon compte"
        title={fullName === '' ? 'Mon profil' : fullName}
        body={
          <div className="pf-hero">
            <Avatar avatar={avatar} size={88} label="Ta photo de profil" />
            <div className="pf-hero-text">
              <p className="pf-hero-line">
                Dans la Communauté&nbsp;: <strong>{identity.communityLabel}</strong>
              </p>
              <p className="pf-hero-mail">{identity.email}</p>
            </div>
          </div>
        }
        footer={
          view.complete
            ? 'Profil trailer complet · PLUKA estime tes passages'
            : 'Profil trailer à compléter · PLUKA ne peut pas encore estimer tes passages'
        }
        primaryAction={
          view.complete ? undefined : (
            <a href="#profil-trailer" className="pk-btn pk-button-primary pf-cta">
              Compléter mon profil
            </a>
          )
        }
      />

      {cancelled ? (
        <p className="pf-notice" role="status">
          <Icon name="Check" size={16} />
          Tu t’es reconnecté&nbsp;: la suppression de ton compte est annulée.
        </p>
      ) : null}

      <div className="pf-layout">
        <nav className="pf-index" aria-label="Sections du profil">
          <ul>
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>
                  <Icon name={section.icon} size={18} />
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="pf-main">
          <section id="identite" className="pf-card" aria-labelledby="pf-identite-title">
            <header className="pf-card-head">
              <h2 id="pf-identite-title" className="pf-card-title">
                Identité
              </h2>
              <p className="pf-card-sub">
                Ce qui te représente dans la Communauté&nbsp;: ta photo, ou une illustration, et
                «&nbsp;{identity.communityLabel}&nbsp;».
              </p>
            </header>
            <PhotoForm avatar={avatar} hasPhoto={identity.hasPhoto} />
            <IdentityForm
              firstName={identity.firstName}
              lastName={identity.lastName}
              sex={identity.sex}
              avatarIllustration={identity.avatarIllustration}
              autoIllustration={illustrationFor(null, identity.sex)}
            />
            <p className="pf-meta">
              E-mail de connexion&nbsp;: <span className="pf-mono">{identity.email}</span>
            </p>
          </section>

          <section id="profil-trailer" className="pf-card" aria-labelledby="pf-trailer-title">
            <header className="pf-card-head">
              <div className="pf-card-title-row">
                <h2 id="pf-trailer-title" className="pf-card-title">
                  Profil trailer
                </h2>
                {view.complete ? (
                  <Badge tone="success">Signal d’allure exploitable</Badge>
                ) : (
                  <Badge tone="neutral">À compléter</Badge>
                )}
              </div>
              <p className="pf-card-sub">
                Un seul profil sert toutes tes courses. Il donne à PLUKA de quoi estimer tes temps
                de passage&nbsp;: un effort que tu connais bien, ou à défaut ton allure de confort
                en trail.
              </p>
              {view.complete ? null : (
                <p className="pf-card-warning">
                  Tant que ni l’effort de référence ni l’allure de confort ne sont renseignés, PLUKA
                  ne peut pas estimer tes passages&nbsp;: il te faudra donner un objectif explicite.
                </p>
              )}
            </header>
            <ProfileForms profile={view.profile} />
          </section>

          {repere ? (
            <section id="repere" className="pf-card pf-card-link" aria-labelledby="pf-repere-title">
              <div>
                <h2 id="pf-repere-title" className="pf-card-title">
                  Repère PLUKA <span className="pf-beta">bêta</span>
                </h2>
                <p className="pf-card-sub">
                  Le Repère propose une plage de chrono à partir d’une sortie récente. Tes couples
                  sortie et course l’aident à devenir juste.
                </p>
              </div>
              <Link href="/profil/repere" className="pk-btn pk-button-secondary">
                Aider à calibrer
              </Link>
            </section>
          ) : null}

          {organizerHref === null ? null : (
            <section className="pf-card pf-card-link" aria-labelledby="pf-org-title">
              <div>
                <h2 id="pf-org-title" className="pf-card-title">
                  Espace organisateur
                </h2>
                <p className="pf-card-sub">Tes événements, ta course, tes participants.</p>
              </div>
              <Link href={organizerHref} className="pk-btn pk-button-secondary">
                <Icon name="Buildings" size={18} />
                Ouvrir
              </Link>
            </section>
          )}

          <section id="donnees" className="pf-card" aria-labelledby="pf-donnees-title">
            <header className="pf-card-head">
              <h2 id="pf-donnees-title" className="pf-card-title">
                Mes données
              </h2>
              <p className="pf-card-sub">
                Tout ce que PLUKA garde sur toi, dans un fichier&nbsp;: compte, profil, courses,
                Plans, Nutrition, sorties, assistance. Voir aussi la{' '}
                <a href={`${publicEnv().NEXT_PUBLIC_SITE_URL}/confidentialite`} className="pk-link">
                  politique de confidentialité
                </a>
                .
              </p>
            </header>
            {/* Un téléchargement, pas une navigation : un lien simple, sans préchargement. */}
            <a href="/profil/donnees" className="pk-btn pk-button-secondary pf-download" download>
              <Icon name="DownloadSimple" size={18} />
              Télécharger mes données
            </a>

            <details className="pf-danger">
              <summary>Supprimer mon compte</summary>
              <DeleteAccountForm />
            </details>
          </section>
        </div>
      </div>
    </div>
  );
}
