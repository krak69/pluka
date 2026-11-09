# PLUKA — Repère PLUKA V0 (bêta)

**Statut :** spécification V0, bêta, non calibrée. Décisions produit du 2026-11-09.
**Références :** `00_PRODUCT_SPEC.md` §8, §9 · `PLAN_ENGINE.md` §6.2, §46 · `03_PRIVACY_RLS.md` · `01_ARCHITECTURE.md` §41.

---

# 0. Rôle

Le Repère PLUKA répond à « quel chrono pourrais-je viser ? » quand le coureur ne sait pas quoi taper. Il donne une **plage indicative**, jamais un chrono précis (§9.2).

Il ne fait pas :

- de prédiction de performance ;
- de recommandation imposée : l'objectif reste la décision du coureur (§9.1) ;
- de modification du Plan : il n'entre jamais dans le calcul du Plan (PLAN_ENGINE §6.2, §46).

Le moteur est pur et déterministe : mêmes entrées, même version, même plage. Pas d'IA, pas d'horloge implicite (AGENTS §11, §35).

---

# 1. Où il apparaît

Sur l'écran Objectif, sous le champ du chrono, un lien « Estime-le pour moi » (mention **Bêta**) ouvre un petit formulaire. Pas d'écran autonome (§9.2).

Le coureur y donne une référence (§2). PLUKA affiche :

> Repère PLUKA : 5h40–6h30

et un bouton **« Partir de ce repère »**, qui remplit le champ avec le milieu de la plage, arrondi à 5 minutes. Le coureur ajuste, puis valide lui-même : rien ne part au Plan sans son geste.

L'effort saisi est enregistré dans le Profil trailer (§8.1) et prérempli la fois suivante.

---

# 2. Entrées

## 2.1 Effort de référence (source principale)

Une course ou une sortie longue récente :

- distance (km) ;
- D+ (m) ;
- durée réelle, arrêts compris ;
- date (facultative).

Ce sont les champs `representative_*` du Profil trailer.

## 2.2 Allure trail habituelle (secours)

À défaut d'effort récent : l'allure trail habituelle en min/km (`fallback_trail_pace_seconds_per_km`). La plage est plus large et marquée « repère approximatif ».

## 2.3 Références exclues en V0

- un chrono sur route (10 km, semi) : il ne voit ni le dénivelé, ni la technicité, ni la tenue sur la durée ;
- les indices ITRA et UTMB : pas d'accès contractuel, et aucune formule « indice → temps » inventée (AGENTS §18). ITRA et UTMB restent deux sources distinctes.

## 2.4 La course visée

Distance et D+ officiels de l'épreuve. Sans D+ connu, pas de Repère : un repère sur la seule distance tromperait en trail.

---

# 3. Méthode

## 3.1 Effort comparable

Les deux parcours sont ramenés à une même unité, le **km-effort**, convention répandue en trail :

```text
E = distance_km + D+_m / 100
```

La V0 ignore le D− et la technicité, que la référence saisie ne porte pas.

## 3.2 Transposition

Le temps visé suit la référence avec un exposant d'endurance `k` : l'allure se dégrade quand l'effort s'allonge.

```text
r       = E_course / E_ref
central = t_ref × r^k
```

Pour l'allure de secours, la référence est un effort fictif de `E_pace_ref` km-effort parcouru à l'allure donnée :

```text
t_ref = pace_s_per_km × E_pace_ref
E_ref = E_pace_ref
```

## 3.3 Plage

Demi-largeur relative, en espace logarithmique :

```text
w = w_base
  + w_distance × |ln r|
  + w_age × max(0, mois_depuis_effort − age_free_months)    (plafonné à w_age_max)
  + (allure de secours ? w_pace : 0)

bas  = central × e^(−w)
haut = central × e^(+w)
```

Bas, central et haut sont arrondis à 5 minutes. Le bas est toujours strictement inférieur au haut.

## 3.4 Pas de Repère

Le moteur rend une raison, jamais une plage, quand :

| Raison | Condition |
|---|---|
| `course_elevation_unknown` | D+ de l'épreuve inconnu |
| `reference_too_short` | `E_ref < E_min` |
| `too_far` | `r > r_max` ou `r < 1 / r_max` |
| `reference_too_old` | effort daté de plus de `age_max_months` |
| `implausible_reference` | allure de référence hors de `[pace_min, pace_max]` par km-effort |

L'écran dit la raison en clair et laisse le coureur taper son chrono.

## 3.5 Barrière d'arrivée

Si l'épreuve a une barrière d'arrivée et que le haut de la plage la dépasse, l'écran le signale. Le Repère ne se recale jamais sur la barrière.

---

# 4. Configuration `repere-v0.1.0`

Valeurs de départ, **non calibrées** :

| Paramètre | Valeur | Rôle |
|---|---:|---|
| `k` | 1.07 | exposant d'endurance |
| `E_pace_ref` | 15 | effort fictif de l'allure de secours |
| `w_base` | 0.06 | incertitude minimale |
| `w_distance` | 0.05 | élargit quand les efforts diffèrent |
| `w_age` | 0.01 / mois | élargit quand l'effort vieillit |
| `age_free_months` | 3 | sans pénalité jusque-là |
| `w_age_max` | 0.06 | plafond de la pénalité d'âge |
| `w_pace` | 0.12 | élargit l'allure de secours |
| `E_min` | 5 | référence trop courte en dessous |
| `r_max` | 4 | écart d'effort maximal |
| `age_max_months` | 24 | référence trop ancienne au-delà |
| `pace_min`, `pace_max` | 3 et 30 min / km-effort | allure plausible |

Toute modification crée une nouvelle version. Une estimation garde la version qui l'a produite.

---

# 5. Calibrage

La V0 n'est pas calibrée. Elle reste derrière le flag `repere_pluka` : allumé en local et pour les testeurs, coupé en production.

Chaque Repère affiché est enregistré avec ses entrées, sa version et sa plage (`repere_estimates`). Le temps réel déclaré après la course (`post_race_reviews.actual_duration_seconds`) permet de mesurer :

- la part des temps réels tombés dans la plage ;
- le biais du central.

Avant la production :

- un jeu d'au moins 100 couples (référence, temps réel) ;
- une couverture de la plage proche de 70 % ;
- un biais documenté ;
- les constantes ajustées dans une nouvelle version ;
- la validation produit du libellé.

---

# 6. Confidentialité

Le Repère et ses entrées sont des données de préparation du coureur. Lecture et écriture par le coureur seul. L'organisation n'y accède jamais, même avec Organizer Included (AGENTS §19). Les journaux n'en portent ni valeur ni temps.

---

# 7. Tests d'acceptation

- **REP-01 :** même entrée, même version, même plage.
- **REP-02 :** bas < central < haut, tous arrondis à 5 minutes.
- **REP-03 :** une course plus longue ou plus dénivelée donne un central plus long.
- **REP-04 :** l'allure de secours donne une plage plus large qu'un effort de même allure.
- **REP-05 :** chaque raison de §3.4 rend une raison, pas une plage.
- **REP-06 :** le Repère ne change jamais un Plan ni un objectif.
- **REP-07 :** un autre compte et l'organisation ne lisent pas les estimations d'un coureur.
