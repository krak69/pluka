# PLUKA — Auto-évaluation RGPD

**Statut :** document de travail, 2026-11-09. Ce n'est pas un avis juridique.
**Usage :** savoir où PLUKA en est, décider ce qui reste à trancher, et préparer une consultation courte avec un avocat ou un DPO avant d'ouvrir à de vraies organisations.
**Références :** `03_PRIVACY_RLS.md` (§28, §93, §94 et la liste « À valider séparément »), guides de la CNIL.

`03_PRIVACY_RLS.md` interdit d'inventer dans le code une durée de conservation ou une base légale. Ce document propose donc des options. Chaque ligne « À décider » attend ta décision, idéalement confirmée par un professionnel.

---

## 1. Qui est responsable de quoi

| Traitement | Rôle de PLUKA | Rôle de l'organisation |
|---|---|---|
| Compte coureur, Profil trailer, Plan, préparation | Responsable de traitement | Aucun accès (AGENTS §19) |
| Liste d'inscrits importée par l'organisation | **Sous-traitant** : PLUKA traite la liste pour elle | **Responsable** : c'est sa liste |
| Envoi des invitations | Sous-traitant, au nom de l'organisation | Responsable : elle décide d'inviter |
| Participation activée par le coureur | Responsable, puisque le coureur a créé son compte | Voit l'état « Sur PLUKA » et des agrégats ≥ 10 |
| Équipe d'une organisation (membres, rôles) | Responsable | — |
| Formulaire de contact du site d'un événement | Sous-traitant : PLUKA transmet le message | Responsable : elle reçoit le message |
| Testeurs bêta, couples de calibrage du Repère | Responsable | Aucun accès |

**Conséquence :** il faut un **contrat de sous-traitance** (article 28 du RGPD) entre PLUKA et chaque organisation qui importe une liste. La CNIL publie un modèle de clauses, utilisable comme base.

---

## 2. Registre des traitements (à tenir à jour)

| Traitement | Finalité | Base légale proposée | Données | Durée de conservation |
|---|---|---|---|---|
| Compte et préparation du coureur | Fournir le service | Exécution du contrat (CGU) | adresse, nom, profil, Plan, Nutrition, sorties | **À décider** : durée du compte, puis X mois après la dernière connexion ? |
| Liste d'inscrits importée | Inviter et préremplir l'espace | Celle de l'organisation : exécution de l'inscription ou intérêt légitime, à elle de la fixer | nom, adresse, dossard, vague | **À décider** : jusqu'à la fin de l'édition + X mois ? |
| Données déclaratives importées | Agrégats d'ensemble | **À décider** avec l'organisation : consentement à l'inscription ? | sexe, date de naissance, nationalité | **À décider** |
| Indices ITRA / UTMB importés | Agrégats d'ensemble | **À décider** : « légitimement obtenus » (§29.3) reste à préciser | indices | **À décider** |
| Invitations | Envoyer le lien | Celle de l'organisation | adresse, état, jeton haché | Jusqu'au départ, puis **à décider** |
| Refus d'être contacté | Ne plus recontacter | Obligation de respecter le refus | organisation + adresse | Tant que l'organisation existe (sinon, on pourrait la recontacter) |
| Repère et calibrage | Proposer et améliorer la plage | Exécution du contrat / consentement explicite (page dédiée) | efforts, temps | **À décider** |
| Journal d'audit | Sécurité, traçabilité | Intérêt légitime | identifiants, gestes, sans adresse | **À décider** : 1 an ? |
| Messages du site | Transmettre une question | Intérêt légitime de l'organisation | nom, adresse, message | Supprimé après envoi (déjà le cas) |

---

## 3. Ce qui est déjà en place dans le produit

- **Confidentialité par construction :**
  - l'organisation ne lit jamais Plan, Nutrition, Assistance, sorties ou notes, même avec l'accès inclus ;
  - les règles d'accès (RLS) sont fermées par défaut, avec des tests de refus.
- **Minimisation :**
  - l'adresse e-mail n'est montrée qu'à qui invite (§28) ;
  - les données déclaratives et les indices vont dans un schéma privé que l'organisation ne relit pas ;
  - les fichiers d'import ne sont pas stockés, et leurs lignes de travail sont vidées.
- **Agrégats :** aucun sous-groupe affiché en dessous de 10 participants.
- **Invitations :**
  - le jeton est haché ;
  - le lien expire au départ ;
  - l'activation exige l'adresse invitée ;
  - l'e-mail dit **d'où vient l'adresse**, et porte un **lien de refus** sans compte (0075).
- **Journaux :** ni adresse, ni contenu, ni jeton.
- **Sécurité :** flags pour garder hors production ce qui n'est pas validé (`participant_invitations`, `repere_pluka`).

---

## 4. Ce qui manque avant d'ouvrir à de vraies organisations

Par ordre d'importance.

1. **Politique de confidentialité et mentions légales.** Aucune page n'existe : il n'y a qu'un engagement dans la page Organisateurs. Elles doivent dire qui est PLUKA, ce qui est collecté, pourquoi, combien de temps, les sous-traitants, et comment exercer ses droits. L'e-mail d'invitation devra y renvoyer.
2. **CGU** pour les coureurs et **conditions organisateurs**, avec le contrat de sous-traitance (§1).
3. **Information dans le formulaire d'inscription de l'organisation.** Les inscrits doivent être prévenus que leur adresse est transmise à PLUKA. C'est à l'organisation de l'écrire, mais PLUKA doit lui fournir le texte.
4. **Durées de conservation**, puis leur purge automatique (§2). Rien n'est purgé aujourd'hui : l'adresse importée et les données déclaratives restent tant que la ligne existe.
5. **Droits des personnes.** Il n'existe encore ni suppression de compte, ni export de ses données (§94). Il faut au minimum une adresse de contact pour les demandes, et un délai de réponse d'un mois.
6. **Sous-traitants de PLUKA et transferts hors UE.**
   - Resend, pour les e-mails, est américain : vérifier son DPA et son adhésion au Data Privacy Framework, ou des clauses contractuelles types.
   - Vérifier aussi la région de Supabase et de Vercel.
   - Les lister dans la politique de confidentialité.
7. **Mineurs.** Des coureurs de moins de 15 ans peuvent être inscrits à une course. À décider : refuser leur invitation, ou demander l'accord d'un parent.
8. **Violation de données.** Écrire une procédure courte : qui prévient la CNIL sous 72 heures, et qui prévient les organisations.
9. **Domaine d'envoi.** Un domaine vérifié dans Resend, pour que l'expéditeur soit identifiable.

---

## 5. Décisions à prendre (à cocher)

- [ ] Durée de conservation du compte inactif
- [ ] Durée de conservation de la liste importée après l'édition
- [ ] Base légale et information pour sexe, date de naissance, nationalité
- [ ] Usage des indices ITRA / UTMB : quelles sources sont « légitimes »
- [ ] Durée du journal d'audit
- [ ] Mineurs : refus ou accord parental
- [ ] Contact pour l'exercice des droits (adresse dédiée)
- [ ] Sous-traitants retenus et leurs garanties de transfert

---

## 6. Ressources

- CNIL, « RGPD : passer à l'action » et le guide de la sécurité des données personnelles.
- CNIL, modèle de registre des traitements (format tableur).
- CNIL, guide du sous-traitant et exemple de clauses contractuelles de sous-traitance.
- CNIL, « Prospection commerciale par courrier électronique », pour les règles d'un premier e-mail.

Une consultation d'une ou deux heures avec un avocat en droit du numérique, avec ce document en main, suffit souvent à valider les choix de la section 5.
