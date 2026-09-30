/**
 * Contenu de la page Organisateurs.
 *
 * Reprise littérale de `reference/prototype/PLUKA Organisateurs.dc.html`, y
 * compris les espaces insécables de la typographie française.
 *
 * Les tableaux `heroStats` et `heroRows` du prototype sont volontairement
 * absents : ils sont déclarés dans son `renderVals()` mais jamais rendus dans
 * son balisage. Les porter ici aurait ajouté du contenu que la maquette ne
 * montre pas.
 */

import type { FaqEntry } from '@/components/faq-list';
import type { FooterColumn } from '@/components/site-footer';
import type { NavLink } from '@/components/site-header';

const NB = ' ';

export const claim = 'Vos informations officielles, transformées en préparation';

/** L'ordre du menu suit l'ordre des sections de la page. */
export const navLinks: readonly NavLink[] = [
  { label: 'Pourquoi PLUKA', href: '#intelligence' },
  { label: 'Comment ça marche', href: '#fonctionnement' },
  { label: 'Pour vos participants', href: '#participant' },
  { label: 'Questions', href: '#faq' },
];

export const hero = {
  label: 'PLUKA pour les organisateurs',
  title: 'Votre course, plus claire avant même le départ.',
  lede: 'Donnez à PLUKA les informations que vous avez déjà. PLUKA vérifie leur cohérence, analyse votre peloton et vous remonte ce qui mérite votre attention — tout en préparant chaque participant individuellement.',
  primary: 'Parler de mon événement',
  secondary: 'Voir un exemple de brief',
  note: 'Programme d’ouverture progressive · aucun engagement à ce stade.',
  briefLabel: 'Brief avant-course',
  event: 'Wildstrubel by UTMB',
  when: 'Brief avant-course · J-7',
  /* La mention de simulation appartient au prototype : elle reste affichée. */
  simulated: 'Exemple de démonstration · données simulées · aucune affiliation',
  pointsLabel: '3 points à retenir',
  points: [
    { n: '01', v: 'La vague 3 est plus hétérogène que les deux autres.' },
    { n: '02', v: 'Pic attendu à Adelboden entre 10:40 et 11:20.' },
    { n: '03', v: '38 participants cherchent une information sur le parking assistance.' },
  ],
  conditionsLabel: 'Conditions',
  conditionsWhen: 'à partir de J-14',
  conditionsTitle: 'Froid + vent probable au col du Rawil',
  conditionsText: 'Une majorité du peloton devrait traverser le secteur pendant cette période.',
} as const;

export const intelligence = {
  label: 'Pas un outil de plus à piloter',
  title: 'Vous fournissez ce que vous avez déjà. PLUKA fait le travail.',
  lede: 'Vos documents de course, votre GPX, votre liste d’inscrits. PLUKA les analyse automatiquement et ne vous présente que les informations utiles.',
  note: `Pas de double saisie. Pas de PC course à remplacer. Pas de nouveau workflow le jour J. Aucune donnée individuelle de participant n’est exposée${NB}: les analyses sont agrégées et anonymisées.`,
  footer:
    'PLUKA prépare l’avant-course. Le chronométrage et le pilotage temps réel restent dans vos outils métier — PLUKA ne cherche pas à les remplacer.',
} as const;

export const controls = {
  label: 'PLUKA contrôle',
  title: 'Une course plus cohérente avant publication.',
  text: 'PLUKA compare votre site, votre règlement, votre guide coureur et votre GPX. Vos contradictions remontent avant celles de vos participants.',
  insetLabel: 'Assistance · Adelboden',
  rows: [
    { k: 'Règlement', v: 'autorisée' },
    { k: 'Guide coureur', v: 'non mentionnée' },
  ],
  verdict: 'PLUKA · information à vérifier',
} as const;

export const analyses = {
  label: 'PLUKA analyse',
  title: 'Comprenez votre peloton sans devenir analyste.',
  text: 'Vagues, indices de performance quand vous en disposez, plans PLUKA agrégés. PLUKA ne restitue que les conclusions.',
  insetLabel: 'Wild 70 · 1 091 participants',
  lines: ['Vagues 1 et 2 · relativement homogènes', 'Vague 3 · plus dispersée'],
  note: `Les données individuelles restent privées${NB}: l’organisation ne voit que des analyses agrégées.`,
} as const;

export const anticipates = {
  label: 'PLUKA anticipe',
  title: 'Voyez les principaux moments de votre course.',
  text: 'Prévisions PLUKA — des estimations agrégées, pas des certitudes.',
  rows: [
    { k: 'Adelboden', v: 'pic 10:40 → 11:20', tone: 'muted' },
    { k: 'Iffigenalp', v: 'barrière à surveiller', tone: 'dawn' },
    { k: 'Rawil', v: 'flux 16:20 → 18:40', tone: 'muted' },
  ],
} as const;

export const listens = {
  label: 'PLUKA écoute',
  title: 'Découvrez ce que vos participants ne comprennent pas.',
  askedBy: '38 participants ont demandé',
  question: `«${NB}Où peut se garer mon accompagnant à Adelboden${NB}?${NB}»`,
  missing: 'Aucune réponse officielle suffisamment précise',
  text: `Vous ajoutez la réponse une fois. Elle devient immédiatement exploitable dans La course, dans Assistance et dans «${NB}Demander à PLUKA${NB}» — pour tous vos participants.`,
} as const;

export const observation = {
  title:
    'Vos informations existent déjà. Elles arrivent simplement trop tard, ou pas au bon endroit.',
  pains: [
    { icon: 'FilePdf', label: 'Le règlement est lu une fois, puis oublié' },
    { icon: 'Envelope', label: 'Les mêmes questions reviennent chaque année' },
    { icon: 'ChatsCircle', label: 'Des réponses approximatives circulent sur les réseaux' },
    {
      icon: 'UsersThree',
      label: 'Les accompagnants arrivent au mauvais endroit, au mauvais moment',
    },
  ],
  text: `Un règlement de vingt-quatre pages est un document juridique, pas un outil de préparation. PLUKA ne le remplace pas${NB}: il en extrait ce qui concerne chaque coureur — sa barrière horaire, son matériel, sa zone d’assistance — et le lui présente au moment utile, en citant toujours votre document d’origine.`,
} as const;

export const steps = [
  {
    num: '01',
    title: 'Vous fournissez',
    text: 'Documents de course, trace GPX, liste d’inscrits. Ce que vous possédez déjà — un lien vers votre site suffit pour démarrer.',
  },
  {
    num: '02',
    title: 'PLUKA analyse',
    text: 'Cohérence des informations, composition du peloton, principaux flux sur le parcours, questions de vos participants.',
  },
  {
    num: '03',
    title: 'Vous décidez',
    text: 'Vous ne vérifiez que les points qui méritent votre attention. Rien n’est publié sans votre validation.',
  },
] as const;

export const stepsNote = `Aucune intégration technique n’est nécessaire pour commencer${NB}: un règlement, un guide coureur, une trace GPX et vos horaires suffisent.`;

export const backOffice = {
  title: 'Vous restez la source officielle.',
  text: 'Chaque information détectée dans vos documents vous est présentée avec sa provenance. Vous validez, corrigez ou refusez. Rien n’est publié comme officiel sans votre accord, et chaque règle affichée à un coureur renvoie vers votre document, page et article compris.',
  points: [
    'Une information, une source : document, page, article',
    'Statuts explicites : officielle, validée PLUKA, communautaire',
    'Historique des modifications d’une édition à l’autre',
    'Prévisualisation « voir comme un participant »',
  ],
  cta: 'Voir une démonstration',
  tabs: [
    { label: 'Sources', active: true },
    { label: 'Informations', active: false },
    { label: 'Participants', active: false },
    { label: 'Épreuves', active: false },
  ],
  rows: [
    {
      label: 'Matériel obligatoire',
      status: 'Officielle',
      tone: 'official',
      src: 'Règlement 2026 · page 11 · article 7.2',
    },
    {
      label: 'Barrière Iffigenalp 16:31',
      status: 'Officielle',
      tone: 'official',
      src: 'Règlement 2026 · page 13 · article 8.1',
    },
    {
      label: 'Dépôt du sac d’arrivée',
      status: 'À vérifier',
      tone: 'check',
      src: 'Guide coureur 2026 · page 18 — horaire à confirmer',
    },
    {
      label: 'Parking assistance Adelboden',
      status: 'Communautaire',
      tone: 'community',
      src: 'Retour de 3 participants · édition 2025',
    },
    {
      label: 'Navettes retour',
      status: 'Officielle',
      tone: 'official',
      src: 'Guide coureur 2026 · page 22',
    },
  ],
} as const;

export const brief = {
  label: 'Votre brief avant-course',
  title: 'Tout ce qui compte. Une seule page.',
  lede: 'PLUKA génère votre brief automatiquement et le fait évoluer avec l’échéance. Vous ne le construisez pas.',
  note: `Partagez-le avec votre équipe${NB}: tout le monde n’a pas besoin d’un compte PLUKA pour en profiter. Il ne contient que des données agrégées, aucune information personnelle de coureur.`,
  cta: 'Voir un exemple de brief',
  cardLabel: 'Brief organisation',
  cardTitle: 'Wild 70 · J-7',
  cardUpdated: 'Mis à jour aujourd’hui · 14:20',
  sections: [
    {
      title: 'Course',
      lines: [
        '✓ Informations principales validées.',
        '1 point à vérifier : parking assistance Adelboden.',
      ],
    },
    {
      title: 'Peloton',
      lines: ['1 091 participants.', 'Vague 3 plus dispersée que les deux autres.'],
    },
    {
      title: 'Parcours',
      lines: ['Adelboden : pic attendu 10:40 → 11:20.', 'Iffigenalp : barrière à surveiller.'],
    },
    {
      title: 'Participants',
      lines: ['Assistance : principal sujet de questions cette semaine.'],
    },
    { title: 'Conditions', lines: ['Froid + vent prévu au col du Rawil.'] },
  ],
  cardFootnote: 'Données agrégées et simulées pour cet exemple.',
} as const;

export const conditions = {
  label: 'Conditions',
  title: 'À J-14, le terrain entre dans l’analyse.',
  lede: 'Avant J-14, PLUKA n’affiche aucune tendance météo — ni à vos participants, ni à votre organisation. Ensuite, les conditions annoncées sont croisées avec les flux prévisionnels de votre peloton.',
  point: 'Col du Rawil',
  risk: 'froid + vent probable',
  window: '15:30 → 19:00',
  figure: '68 %',
  figureText:
    'du peloton devrait traverser la zone pendant cette période, selon les flux prévisionnels.',
  decision:
    'PLUKA éclaire la décision. L’organisation reste la seule à décider d’un kit froid, d’une modification de parcours ou d’une consigne officielle.',
  published:
    'Et une décision publiée reste visible par tous vos participants, quelle que soit leur formule.',
} as const;

export const participant = {
  eyebrow: 'Côté participant',
  title: 'De votre invitation à son premier plan de course.',
  lede: 'Vos participants reçoivent une invitation à vos couleurs. En deux minutes, sans configuration, ils obtiennent un espace de préparation construit à partir de vos informations.',
  flow: [
    {
      n: '1',
      title: 'Invitation à vos couleurs',
      text: 'Un email signé de votre organisation, propulsé par PLUKA.',
    },
    {
      n: '2',
      title: `«${NB}Ton espace Wild 70 est presque prêt${NB}»`,
      text: 'Vos informations sont déjà préremplies : épreuve, dossard, vague de départ.',
    },
    {
      n: '3',
      title: 'Le participant fixe son objectif',
      text: 'Un chrono visé, une question sur son assistance. Rien d’autre.',
    },
    {
      n: '4',
      title: 'Son plan est généré',
      text: 'Temps de passage, marges aux barrières, matériel, sacs, tâches.',
    },
    {
      n: '5',
      title: 'Il prépare le reste',
      text: 'Nutrition, assistance et lien privé pour son accompagnant.',
    },
  ],
  cardLabel: 'Ce que voit votre participant',
  cardTitle: 'Wild 70',
  cardMeta: '72 km · 4 600 m D+ · 11 septembre 2026 · départ 06:00',
  rows: [
    { icon: 'Path', label: 'Plan de course généré', v: '12 h 30' },
    { icon: 'ClockCountdown', label: 'Barrières contrôlées', v: '4' },
    { icon: 'ListChecks', label: 'Matériel identifié', v: '22' },
    { icon: 'UsersThree', label: 'Points d’assistance', v: '2' },
    { icon: 'Mountains', label: 'Conditions point par point', v: 'dès J-14' },
  ],
  officialLabel: 'Information officielle',
  officialText:
    'Assistance autorisée uniquement dans la zone prévue, à la sortie du ravitaillement.',
  officialSource: 'Votre règlement 2026 · page 14 · article 9.1',
} as const;

export const privacy = {
  label: 'Confidentialité',
  title: 'Le plan reste celui du participant.',
  neverLabel: `L’organisation ne voit jamais${NB}:`,
  never: [
    'Objectif individuel',
    'Horaires personnels',
    'Plan personnel',
    'Nutrition',
    'Assistance privée',
    'Sacs et notes',
  ],
  text: `Les analyses organisateur reposent uniquement sur des données agrégées et anonymisées, avec un seuil minimal${NB}: aucune analyse n’est affichée sur un groupe trop petit. Aucun classement de coureurs, aucun score individuel, aucune notion de participant «${NB}à risque${NB}».`,
} as const;

export const trades = {
  label: 'Une même donnée',
  title: 'Plusieurs métiers, une seule source.',
  roles: [
    {
      who: 'Directeur de course',
      what: 'Les points du parcours et les barrières qui méritent votre attention.',
    },
    { who: 'Opérations', what: 'Les principales périodes de charge attendues.' },
    {
      who: 'Relation participants',
      what: 'Les informations que vos coureurs cherchent réellement.',
    },
    {
      who: 'Direction',
      what: 'Une vision synthétique de l’état de préparation de l’événement.',
    },
    {
      who: 'Marketing',
      what: 'Une expérience premium offerte aux participants, avec une adoption mesurable.',
    },
  ],
  cardLabel: 'Ce que PLUKA vous remonte · Adelboden',
  cardMeta: 'km 31,2 · 1 350 m · 1 091 coureurs attendus',
  /** `v` est la hauteur relative ; le pic à 100 passe en Aube. */
  bars: [
    { t: '09:00', v: 18 },
    { t: '09:30', v: 42 },
    { t: '10:00', v: 74 },
    { t: '10:30', v: 100 },
    { t: '11:00', v: 78 },
    { t: '11:30', v: 46 },
    { t: '12:00', v: 24 },
    { t: '12:30', v: 11 },
  ],
  peakLabel: 'Pic attendu',
  peakWindow: '10:30 → 11:00',
  coverage:
    'Basé sur 82 % du peloton avec données exploitables. Analyses agrégées — aucun plan individuel accessible.',
} as const;

export const benefits = {
  title: 'Ce que cela change pour votre événement.',
  cards: [
    {
      icon: 'BookOpenText',
      title: 'Des informations mieux utilisées',
      text: 'Vos règles apparaissent au moment où le coureur en a besoin, plutôt qu’enfouies page 14 d’un PDF.',
    },
    {
      icon: 'FlagCheckered',
      title: 'Des participants mieux préparés',
      text: 'Matériel conforme, horaires réalistes, sacs déposés à temps, accompagnants au bon endroit.',
    },
    {
      icon: 'ChatTeardropText',
      title: 'Moins de questions répétitives',
      text: 'Les participants interrogent directement les informations officielles de votre épreuve.',
    },
    {
      icon: 'ChartLine',
      title: 'Une meilleure lecture des besoins',
      text: 'Vous voyez l’activation de vos participants et les thématiques les plus consultées.',
    },
    {
      icon: 'Mountains',
      title: 'Des conditions comprises, pas subies',
      text: 'À partir de J-14, chaque participant voit les conditions recalées sur son propre plan et ses horaires de passage — et vos décisions météo apparaissent toujours au-dessus de la prévision.',
    },
  ],
  /* Le prototype porte lui-même ce texte d'attente dans son `image-slot`. */
  photoPlaceholder: 'Photo de votre événement — départ, ravitaillement ou zone d’assistance',
} as const;

export const scope = {
  title: 'Ce que PLUKA fait — et ne fait pas.',
  doLabel: 'PLUKA prend en charge',
  doList: [
    'Structurer vos documents officiels en informations exploitables',
    'Construire le plan de course personnel de chaque participant',
    'Traduire le matériel obligatoire en checklist individuelle',
    'Organiser la nutrition et les sacs selon le parcours',
    'Montrer à chacun les conditions prévues sur son propre horaire, dès J-14',
    'Donner à chaque accompagnant les consignes qui le concernent',
  ],
  dontLabel: 'PLUKA ne remplace pas',
  dontList: [
    'Votre site officiel et votre communication',
    'Votre système d’inscription et de chronométrage',
    'Le suivi live et le tracking GPS des coureurs',
    'Les plans d’entraînement de vos participants',
    'La vente de produits ou de services aux coureurs',
    'Vous donner accès au plan personnel ou aux conditions d’un participant',
  ],
} as const;

export const contact = {
  title: 'Parlons de votre événement.',
  lede: `Nous ouvrons PLUKA progressivement à des organisateurs de trail, pour construire un outil réellement utile aux coureurs comme aux organisations. Décrivez-nous votre épreuve${NB}: nous revenons vers vous avec une présentation adaptée à vos documents.`,
  points: [
    'Présentation adaptée à vos documents réels',
    'Aucune donnée de participant nécessaire à ce stade',
    'Retour sous quelques jours',
  ],
  formLabel: 'Parler de mon événement',
  formTitle: 'Quatre champs suffisent.',
  submit: 'Parler de mon événement',
  privacyNote:
    'Vos informations servent uniquement à préparer cet échange. Aucune donnée de vos participants ne nous est nécessaire à ce stade.',
} as const;

export const faq: readonly FaqEntry[] = [
  {
    q: 'Faut-il une intégration technique pour démarrer ?',
    a: 'Non. Un règlement, un guide coureur, votre trace GPX et vos horaires officiels suffisent pour construire un espace de préparation. Une connexion à votre système d’inscription peut venir ensuite, pour automatiser les invitations, mais elle n’est pas nécessaire au départ.',
  },
  {
    q: 'Qui reste responsable des informations affichées ?',
    a: 'Vous. Toute information issue de vos documents vous est soumise avant d’être publiée comme officielle, et chaque règle affichée à un coureur cite votre document d’origine avec sa page et son article. Ce que PLUKA n’a pas pu faire confirmer est signalé comme tel, jamais présenté comme officiel.',
  },
  {
    q: 'Que se passe-t-il si nous modifions une information après publication ?',
    a: 'Vous mettez l’information à jour dans votre espace organisateur ; elle est répercutée dans la préparation des participants concernés, et les plans qui en dépendent — barrières, matériel, zones d’assistance — sont recalculés côté coureur.',
  },
  {
    q: 'PLUKA remplace-t-il notre site ou notre application officielle ?',
    a: 'Non. Votre site reste la référence de votre événement. PLUKA est l’outil de préparation du coureur : il exploite vos informations pour construire son plan, sa nutrition, son matériel et son assistance, et renvoie systématiquement vers vos documents.',
  },
  {
    q: 'Nos participants doivent-ils payer ?',
    a: 'La préparation reste accessible gratuitement à vos participants pendant la phase d’ouverture. Les conditions applicables à votre événement sont discutées lors de la présentation, sans grille tarifaire imposée à ce stade.',
  },
  {
    q: 'Vos participants reçoivent-ils une météo de course ?',
    a: 'À partir de J-14, les participants équipés d’un Race Pass, d’un PLUKA+ ou d’une préparation offerte par votre organisation voient les conditions prévues point par point, recalées sur leurs propres horaires de passage. Aucune prévision n’est affichée au-delà de J-14. Vos décisions — kit froid, parcours de repli, alerte sécurité — restent gratuites pour tous et s’affichent systématiquement au-dessus de la prévision. Vous n’avez accès ni au plan personnel ni aux conditions individuelles d’un participant.',
  },
  {
    q: 'Quelles données de participants sont nécessaires ?',
    a: 'Aucune pour commencer : un espace peut être construit à partir de vos seuls documents officiels. Les invitations personnalisées nécessitent ensuite les éléments strictement utiles — nom, email, épreuve, dossard — que vous restez libre de ne pas transmettre.',
  },
];

export const finalCta = {
  title: 'Vos participants arriveront mieux préparés au départ.',
  lede: `Fournissez vos informations officielles une fois${NB}; PLUKA les transforme en préparation personnelle pour chacun de vos coureurs.`,
  primary: 'Demander une présentation',
  secondary: 'Voir PLUKA côté coureur',
} as const;

export const footerTagline =
  'La préparation opérationnelle de votre course, du règlement au plan de chaque participant.';

export const footerColumns: readonly FooterColumn[] = [
  {
    title: 'Organisateurs',
    links: [
      { label: 'Pourquoi PLUKA', href: '#intelligence' },
      { label: 'Comment ça marche', href: '#fonctionnement' },
      { label: 'Espace organisateur', href: '#backoffice' },
      { label: 'Questions', href: '#faq' },
      { label: 'Demander une présentation', href: '#contact' },
    ],
  },
  {
    title: 'PLUKA',
    links: [
      { label: 'PLUKA côté coureur', href: '/' },
      { label: 'Contact', href: '#contact' },
      { label: 'Confidentialité', href: '#contact' },
      { label: 'CGU', href: '#contact' },
    ],
  },
];
