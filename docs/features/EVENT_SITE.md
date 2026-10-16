# PLUKA — Site de l'événement

**Statut :** proposition — en cours de cadrage, non implémentée
**Décisions produit :** 2026-10-16
**Portée :** organisateurs (`apps/app`, espace `/org`) et visiteurs anonymes

---

# 0. Rôle de ce document

Ce document décrit une offre organisateur : un site public, bien fait, pour un événement,
à l'identité de l'événement, construit sur les données que l'organisation tient déjà dans
PLUKA.

Il fixe les décisions prises, le périmètre de la première version, les invariants à ne pas
casser et les questions encore ouvertes. Tant qu'il porte le statut « proposition », il ne
modifie aucun document de référence ; §15 liste ce qu'il faudra y reporter à l'adoption.

---

# 1. Principe

Beaucoup de petites courses ont un site pauvre, daté ou abandonné. Leur organisation saisit
pourtant dans PLUKA ses épreuves, horaires, barrières, ravitaillements, matériel, règlements
et communiqués.

> **Le site de l'événement est la vitrine publique de ces données, à l'identité de
> l'événement. Rien n'y est saisi deux fois.**

Il reprend la règle du co-branding (`06_DESIGN_SYSTEM.md` §95) :

> **L'événement reste au premier plan. PLUKA signe l'infrastructure.**

Ce que le site **n'est pas** :

- une plateforme d'inscription — l'inscription est un lien externe (`00_PRODUCT_SPEC.md` §2) ;
- un CMS généraliste — pas de HTML libre, pas de pages arbitraires ;
- un outil de résultats, de chronométrage ou de live ;
- une seconde fiche épreuve.

---

# 2. Décisions prises (2026-10-16)

| Sujet | Décision |
| --- | --- |
| Qui édite | L'organisation, en self-service dans `/org`. L'admin PLUKA peut intervenir. |
| Adresse | Un sous-domaine de `pluka.run` **par événement** : `{eventSlug}.pluka.run`. |
| Identité | Logo, image de couverture, une couleur d'accent, une police de titres choisie dans une liste fermée. |
| Fiches épreuves | Les fiches publiques existantes (`05_ROUTES_FLOWS.md` §1.8), habillées. Une seule fiche par épreuve. |
| Pages V0 | Accueil, épreuves, infos pratiques, documents et règlement, communiqués, partenaires, contact. |
| Inscription | Un lien par édition, surchargeable par épreuve. |
| Contact | Un formulaire. Le message part par mail à l'organisation ; PLUKA n'en garde qu'une trace sans contenu. |
| Anti-spam | Champ pot de miel et limite de débit. Pas de captcha en V0. |
| Commerce | Paiement en ligne à terme. **Bêta ouverte à toutes les organisations d'abord.** Tarif non fixé. |
| Édition affichée | La prochaine à venir ; à défaut, la dernière. Pas d'archive en V0. |
| Infos pratiques | L'officiel vient des faits publiés ; le reste est du texte de l'organisation, étiqueté comme tel. |
| Rôles | Owner, admin et editor éditent ; owner et admin publient et retirent. |
| Adresse de contact | Propre à l'événement, distincte de celle de l'organisation. |
| Polices | 6 à 8 polices de titres sous licence libre, servies par PLUKA (§4.1). |
| Changement de slug | L'ancien sous-domaine redirige en permanence vers le nouveau (§7.1). |
| Signature PLUKA | « Propulsé par PLUKA » en pied de page, et « Préparer ma course » sur chaque fiche épreuve. |

---

# 3. Pages de la première version

Chaque page ne lit que des données **publiées** et des épreuves **`public`**.

## 3.1 Accueil

- nom de l'événement, logo, image de couverture ;
- dates et lieu de l'édition affichée : la prochaine à venir, à défaut la dernière ;
- présentation de l'événement (`events.description`) ;
- les épreuves en liste : nom, distance, D+, départ ;
- le bouton d'inscription (§5) — l'action dominante de la page ;
- le dernier communiqué officiel, s'il existe ;
- les partenaires.

## 3.2 Épreuves

La fiche épreuve publique existante, sous l'habillage de l'événement. Elle garde son
contenu, sa grammaire PLUKA et son appel « Préparer ma course » ; elle gagne l'en-tête, la
navigation du site et le lien d'inscription de l'épreuve.

## 3.3 Infos pratiques

Deux natures d'information, qui ne se mélangent pas :

- **l'officiel vient des faits publiés** — retrait des dossards (`bib`), transport
  (`transport`), départ (`start`), contact (`contact`) — avec leur source et leur niveau de
  confiance. Il n'est pas ressaisi en texte : un horaire n'existe qu'une fois ;
- **le reste est du texte de l'organisation** — hébergement, stationnement, mot d'accueil —
  en blocs titrés, sans HTML (§7), étiqueté « écrit par l'organisation ».

Un bloc de texte ne remplace pas un fait : s'il contredit un fait publié, le fait reste
affiché tel quel.

## 3.4 Documents et règlement

Les documents de l'édition que l'organisation **autorise explicitement** à diffuser
(AGENTS §66 : un document officiel n'est pas redistribuable par défaut). Téléchargement par
URL signée ou point d'accès serveur, jamais par URL brute de Storage
(`03_PRIVACY_RLS.md` §84).

## 3.5 Communiqués

Les `race_notices` autorisées au public, avec leur niveau de confiance
(`02_DATA_MODEL.md` §8.6). Une information de sécurité officielle n'est jamais cachée.

## 3.6 Partenaires

Les `event_partners` actifs de l'édition, dans leur ordre.

## 3.7 Contact

Le formulaire de §6.

---

# 4. Ce que l'organisation personnalise

| Élément | Règle |
| --- | --- |
| Logo | PNG, JPEG ou WebP. **Pas de SVG** : un SVG peut porter du script (§7). |
| Couverture | PNG, JPEG ou WebP, taille et poids bornés, recadrage côté serveur. |
| Couleur d'accent | Une couleur. Refusée si son contraste avec le fond ou le texte posé dessus est sous WCAG AA. |
| Police de titres | Une police d'une liste fermée, servie par PLUKA. Le texte courant reste en Hanken Grotesk. |
| Textes | Présentation, infos pratiques. |

Ce qui ne change pas, quelle que soit l'identité choisie (`06_DESIGN_SYSTEM.md` §96) :

- les blocs fonctionnels — horaires, profil, barrières, ravitaillements, matériel, sources —
  gardent la grammaire PLUKA ;
- le sens des états, la provenance et les niveaux de confiance restent visibles ;
- l'accessibilité ne se dégrade pas ;
- l'accent colore l'identité, pas les états.

## 4.1 Polices de titres

Liste de départ, à ajuster — toutes sous licence SIL Open Font License, servies par PLUKA
sans appel à un service tiers au chargement :

- Archivo (défaut, la police PLUKA) ;
- Barlow Condensed ;
- Oswald ;
- Bebas Neue ;
- Space Grotesk ;
- Montserrat ;
- Fraunces ;
- Playfair Display.

Chaque police ajoutée est vérifiée sur les caractères français et les chiffres des tableaux.

La police au choix **élargit** §96, qui ne la cite pas : à reporter dans
`06_DESIGN_SYSTEM.md` à l'adoption.

---

# 5. Inscription

- un lien d'inscription par édition ;
- une épreuve peut porter le sien, qui prime ;
- l'URL est en `https`, validée côté serveur ;
- le lien sort de PLUKA : aucune donnée de participant ne transite par lui.

Sans lien, le bouton d'inscription n'apparaît pas — il n'est jamais remplacé par un faux
état.

---

# 6. Formulaire de contact

## 6.1 Ce qui est envoyé

- nom, adresse e-mail de l'expéditeur, message ;
- l'épreuve concernée, facultative.

Le message part par l'`EmailProvider` (`packages/notifications`) vers l'adresse de contact
de l'événement. L'expéditeur PLUKA est l'émetteur technique ; l'en-tête `Reply-To` porte
l'adresse du coureur, pour que l'organisation réponde directement.

## 6.2 Ce que PLUKA garde

Une trace **sans contenu** : événement, horodatage, statut d'envoi, empreinte d'IP salée et
tournante pour la limite de débit. Ni le nom, ni l'adresse, ni le message ne sont stockés.

## 6.3 Anti-abus

- un champ pot de miel ;
- une durée minimale entre l'affichage et l'envoi ;
- une limite de débit par empreinte d'IP et par événement ;
- un captcha, derrière une interface, seulement si le spam passe.

---

# 7. Adresse, routage et sécurité

## 7.1 Routage

`{eventSlug}.pluka.run` est servi par `apps/app` : le proxy reconnaît l'hôte et réécrit vers
les routes publiques du site. Le slug d'événement est déjà unique (`05_ROUTES_FLOWS.md` §1.9).

Un slug change parfois. Les anciens slugs d'un événement sont conservés : l'ancien
sous-domaine répond par une redirection permanente vers le nouveau, pour que les affiches et
les liens déjà partagés continuent de fonctionner. Un ancien slug reste réservé à son
événement et ne peut pas être repris par un autre.

Des sous-domaines sont réservés et ne peuvent pas devenir un slug d'événement : `app`, `www`,
`admin`, `api`, `mail`, `auth`, `status`, `static`, `cdn`, et toute adresse technique de
PLUKA.

## 7.2 Un sous-domaine de l'app, donc des précautions strictes

Les sites partagent le même site navigateur que `app.pluka.run`. Ce choix impose :

- **aucun HTML, CSS ni JavaScript fourni par l'organisation** — textes rendus comme texte ;
- **aucun SVG téléversé** ;
- les cookies de session restent attachés à l'hôte `app.pluka.run`, jamais à `.pluka.run` ;
- le site n'ouvre aucune session et ne lit aucune donnée privée ;
- une politique de sécurité de contenu stricte sur les pages du site.

## 7.3 Visibilité

Un site est en ligne si, et seulement si :

- le site est publié par l'organisation ;
- l'événement est publié ;
- l'organisation est active.

Sinon, l'hôte renvoie une 404, comme une course non publique (`05_ROUTES_FLOWS.md` §1.8).
Un site en ligne est indexable ; seules les épreuves `public` y sont listées.

---

# 8. Accès et rôles

| Rôle | Aperçu | Édite | Publie / retire |
| --- | --- | --- | --- |
| owner | oui | oui | oui |
| admin | oui | oui | oui |
| editor | oui | oui | non |
| viewer | oui | non | non |

L'édition du site suit les rôles d'organisation (`03_PRIVACY_RLS.md` §15,
`04_ENTITLEMENTS.md` §62), par helper explicite, jamais par l'ordre de l'énumération.

La capacité commerciale « site » est un droit d'**organisation** (contrat / feature flag),
pas un tier coureur. En bêta, elle est accordée à toutes les organisations ; elle reste un
droit distinct pour que le paiement s'y branche sans changer le modèle.

Le site n'expose **aucune donnée de participant** (AGENTS §19).

---

# 9. Signature PLUKA

- « Propulsé par PLUKA » en pied de page, discret ;
- l'appel « Préparer ma course avec PLUKA » sur chaque fiche épreuve.

Rien d'autre : pas de bandeau, pas d'encart publicitaire.

---

# 10. Hors périmètre V0

- domaine personnalisé ;
- paiement en ligne ;
- actualités / blog, galerie photo, résultats ;
- plusieurs langues ;
- boîte de réception des messages dans `/org` ;
- statistiques de visite détaillées.

---

# 11. Modèle de données — esquisse, à valider

À écrire en migration seulement après validation de ce document.

- `event_sites` — un par événement : statut (brouillon, publié, suspendu), accent, police,
  couverture, publié le / par ;
- blocs d'infos pratiques ordonnés, rattachés au site ;
- `editions.registration_url`, `races.registration_url` (surcharge) ;
- l'adresse de contact de l'événement (`events`), distincte de `organizations.contact_email` ;
- l'autorisation de diffusion publique d'un document ;
- la trace des messages de contact (§6.2) ;
- l'historique des slugs d'événement, pour les redirections (§7.1) ;
- le droit d'organisation « site ».

---

# 12. Questions ouvertes

1. **Fin de bêta :** que devient le site d'une organisation qui ne paie pas ? À trancher
   avec le tarif. Contraintes déjà fixées : les organisations de la bêta sont prévenues
   avant toute coupure, et la fiche épreuve PLUKA garde toujours ses informations
   officielles.
2. **Tarif** de l'offre.

---

# 13. Livraison proposée

1. Ce document validé.
2. Modèle de données, migrations, RLS et pgTAP.
3. Routage par hôte et pages publiques en lecture.
4. Éditeur du site dans `/org`.
5. Formulaire de contact.
6. Paiement, en fin de bêta.

---

# 14. Critères d'acceptation — premiers

- un site non publié, ou d'un événement non publié, renvoie une 404 ;
- une épreuve `unlisted` ou `private` n'apparaît pas sur le site ;
- aucune donnée de participant n'est lisible depuis le site ;
- une organisation B ne peut pas modifier le site de l'organisation A ;
- un rôle non autorisé ne peut pas publier ;
- un document non autorisé à la diffusion n'est pas téléchargeable ;
- un SVG et un texte contenant du HTML ne sont jamais rendus comme tels ;
- une couleur d'accent sous le contraste AA est refusée ;
- un message de contact n'est pas stocké, sa trace l'est ;
- la limite de débit du contact s'applique ;
- un sous-domaine réservé ne peut pas devenir un slug d'événement ;
- un ancien slug redirige en permanence et ne peut pas être repris par un autre événement.

---

# 15. À reporter dans les documents de référence à l'adoption

- `00_PRODUCT_SPEC.md` — l'offre site dans l'expérience organisateur ;
- `01_ARCHITECTURE.md` — le routage par hôte dans `apps/app` ;
- `02_DATA_MODEL.md` — §11 ;
- `03_PRIVACY_RLS.md` — lecture publique du site, trace de contact, cookies ;
- `04_ENTITLEMENTS.md` §62 — le droit d'organisation « site » ;
- `05_ROUTES_FLOWS.md` — les routes du site et de l'éditeur ;
- `06_DESIGN_SYSTEM.md` §96 — la police au choix ;
- `ACCEPTANCE_CRITERIA.md` — §14.
