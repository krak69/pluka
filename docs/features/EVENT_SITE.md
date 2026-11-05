# PLUKA — Site de l'événement

**Statut :** adoptée le 2026-10-16 — modèle (0049–0052), pages publiques, éditeur (`/org/[id]/parametres/site`), contact et documents en place ; paiement à venir
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
| Pages | Un accueil qui résume, et des pages dédiées : infos pratiques, programme, galerie. Épreuves, documents, communiqués, partenaires et contact comme en V0. Une page sans contenu disparaît du menu (décidé le 2026-11-05). |
| Inscription | Un lien par édition, surchargeable par épreuve. |
| Contact | Un formulaire. Le message part par le worker, par mail à l'organisation ; son contenu est effacé une fois envoyé, seule reste une trace sans contenu. |
| Anti-spam | Champ pot de miel et limite de débit. Pas de captcha en V0. |
| Commerce | Paiement en ligne à terme. **Bêta ouverte à toutes les organisations d'abord.** Tarif non fixé. |
| Édition affichée | La prochaine à venir ; à défaut, la dernière. Pas d'archive en V0. |
| Infos pratiques | Des rubriques guidées, rangées en Avant / Pendant / Après. Faits publiés et texte de l'organisation y sont réunis, sans source affichée (§3.3, décidé le 2026-11-05). |
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

Le visiteur lit par moment, puis par sujet, et ne voit pas d'où vient l'information.
L'organisateur part d'une liste prête : il remplit ce qui le concerne, et une rubrique vide
n'apparaît pas sur le site.

| Moment | Rubriques proposées | Faits PLUKA repris |
| --- | --- | --- |
| Avant | Retrait des dossards, Accès et parking, Hébergement, Restauration, Contact | `bib`, `contact` |
| Pendant | Navettes et transport, Accompagnants, Consignes et sacs | `transport` |
| Après | Douches, Repas d'après-course, Remise des prix | — |

- l'organisateur peut **ajouter ses propres rubriques**, à un moment de son choix ;
- une rubrique réunit les faits publiés de son sujet, puis le texte de l'organisation (sans
  HTML, §7) ;
- **un fait n'est pas ressaisi en texte** : un horaire n'existe qu'une fois ;
- **les départs (`start`) n'y figurent pas** : ils sont sur chaque épreuve et au programme ;
- **ni source, ni niveau de confiance dans ces rubriques**, ni mention « écrit par
  l'organisation ». Ils restent sur les pages d'épreuve, où chaque fait garde sa
  traçabilité.

L'accueil en montre le sommaire ; le détail est sur `/infos-pratiques`.

Un bloc de texte ne remplace pas un fait : s'il contredit un fait publié, le fait reste
affiché tel quel.

## 3.4 Documents et règlement

Les documents de l'édition que l'organisation **autorise explicitement** à diffuser
(AGENTS §66 : un document officiel n'est pas redistribuable par défaut). Un fichier se
télécharge par `/documents/[sourceId]`, qui signe une adresse valable une minute ; jamais
par URL brute de Storage (`03_PRIVACY_RLS.md` §84). Un lien externe s'ouvre tel quel.

## 3.5 Communiqués

Les `race_notices` autorisées au public, avec leur niveau de confiance
(`02_DATA_MODEL.md` §8.6). Une information de sécurité officielle n'est jamais cachée.

## 3.6 Partenaires

Les `event_partners` actifs de l'édition, dans leur ordre.

## 3.7 Contact

Le formulaire de §6.

## 3.8 Présentation et lieu

Un texte de présentation de l'événement, le lieu du rendez-vous, et jusqu'à quatre chiffres
clés écrits par l'organisation (une valeur et son libellé). Ils sont sur l'accueil, avec les
dates. Un chiffre clé est une affirmation de l'organisation : PLUKA n'en calcule aucun.

## 3.9 Programme

La liste du rendez-vous, **par édition** : jour, heure, lieu, intitulé. Les départs des
épreuves s'y ajoutent d'eux-mêmes, depuis les épreuves publiques : ils ne se ressaisissent
pas. Les temps sont des instants réels dans le fuseau des épreuves de l'édition (AGENTS §34).
Quarante lignes au plus.

**Masqué depuis le 2026-11-05, à la demande du produit** : ni l'éditeur ni le site ne le
montrent, et ce qui est enregistré est conservé. `SITE_PROGRAM_VISIBLE` le fait revenir.

La page `/programme` existe dès que l'organisation a écrit une ligne : seuls, les départs
n'ajoutent rien aux cartes d'épreuves. L'accueil n'en montre qu'un lien.

## 3.10 Galerie et vidéo

Douze photos au plus, réencodées comme le logo et la couverture (§7.3), chacune avec un texte
de remplacement facultatif ; et une vidéo YouTube ou Vimeo. Les photos se déposent une par
une, et s'affichent dans l'ordre de dépôt. Page `/galerie` ; l'accueil en montre trois.

La vidéo se charge **au clic** : aucun tiers ne reçoit la visite tant que le visiteur n'a pas
demandé la lecture, et le lecteur YouTube est celui de `youtube-nocookie.com`. Seule une
adresse YouTube ou Vimeo reconnue est acceptée ; PLUKA en extrait l'identifiant et ne garde
jamais de code d'intégration.

## 3.11 Liens utiles

Résultats, suivi live, bénévoles, newsletter, Facebook, Instagram, Strava : sept adresses
`https` facultatives, rattachées à l'événement. Ce sont de simples liens : PLUKA ne remplace
ni le chronométrage, ni le live, ni un outil d'e-mailing, et ne collecte aucune adresse de
visiteur.

---

# 4. Ce que l'organisation personnalise

| Élément | Règle |
| --- | --- |
| Logo | PNG, JPEG ou WebP. **Pas de SVG** : un SVG peut porter du script (§7). |
| Couverture | PNG, JPEG ou WebP, taille et poids bornés, recadrage côté serveur. |
| Couleur d'accent | Une couleur. Refusée si son contraste avec le fond ou le texte posé dessus est sous WCAG AA. |
| Police de titres | Une police d'une liste fermée, servie par PLUKA. Le texte courant reste en Hanken Grotesk. |
| Textes | Présentation, lieu, chiffres clés, infos pratiques, programme. |
| Médias | Galerie de douze photos au plus, une vidéo YouTube ou Vimeo. |
| Liens | Résultats, suivi live, bénévoles, newsletter, réseaux sociaux (§3.11). |

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

Le message part par le worker (`email.event_site_contact`, file `pluka_email`), via
l'`EmailProvider` de `packages/notifications`, vers l'adresse de contact de l'événement.
L'app ne tient ni clé de service ni clé d'e-mail (décision du 2026-10-16). L'expéditeur PLUKA est l'émetteur technique ; l'en-tête `Reply-To` porte
l'adresse du coureur, pour que l'organisation réponde directement.

## 6.2 Ce que PLUKA garde

Le message attend en file privée le temps de l'envoi — quelques instants. Envoyé, ou
abandonné après cinq échecs, son contenu est effacé ; un message resté en file plus de
sept jours l'est aussi.

Reste une trace **sans contenu** : événement, horodatage, statut d'envoi, empreinte d'IP
salée par la base, avec un sel changé chaque jour. Elle sert la limite de débit et
s'efface après trente jours.

## 6.3 Anti-abus

- un champ pot de miel ;
- une durée minimale entre l'affichage et l'envoi ;
- une limite de débit : 5 messages par heure et par empreinte, 50 par événement (0052) ;
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

# 11. Modèle de données — écrit en 0049 à 0052 (`02_DATA_MODEL.md` §6.9)

Seuils de la limite de débit du contact : passés par le serveur, depuis sa configuration.

0050 enregistre les liens d'inscription avec le reste du site, en une transaction. 0051
ouvre le bucket des images aux éditeurs de l'événement, dans son dossier : l'app dépose
sous la session de l'éditeur, après avoir réencodé l'image, sans clé de service.

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

Contenu complet (0054 pour les rubriques, la présentation et les liens ; 0055 pour le programme ; 0056 pour la galerie et la vidéo) :

- `event_sites` gagne la présentation, le lieu et les sept liens de §3.11 ;
- `event_site_sections` gagne le moment et la clé de rubrique, nulle pour une rubrique
  ajoutée par l'organisation ;
- `event_site_figures` — les chiffres clés ;
- `event_site_program_items` — le programme, rattaché à l'édition ;
- `event_site_gallery` — les photos, dans `event-site-assets` ;
- `event_sites` gagne le fournisseur et l'identifiant de la vidéo.

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
- un ancien slug redirige en permanence et ne peut pas être repris par un autre événement ;
- une rubrique sans fait ni texte n'apparaît pas, et une page sans contenu sort du menu ;
- un départ d'épreuve non publique n'apparaît pas au programme ;
- aucun tiers n'est appelé par la page galerie avant le clic sur la vidéo ;
- une adresse de vidéo qui n'est ni YouTube ni Vimeo est refusée ;
- une treizième photo est refusée.

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
