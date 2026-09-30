/**
 * Contenu de la homepage coureur.
 *
 * Reprise littérale de `reference/prototype/PLUKA Homepage.dc.html`. Les
 * espaces insécables du prototype (`&nbsp;` avant `?`, `:`, `!` et autour des
 * guillemets français) sont conservés en ` ` : la typographie française
 * fait partie de la fidélité demandée, et un espace normal produirait un
 * rejet de ponctuation en début de ligne.
 *
 * Rien n'est inventé ici et rien n'est résumé. Ces valeurs sont du contenu
 * éditorial figé, pas des données : la page est statique et ne lit pas la base
 * (01_ARCHITECTURE.md §4.1).
 */

import type { NavLink } from '@/components/site-header';
import type { FaqEntry } from '@/components/faq-list';
import type { FooterColumn } from '@/components/site-footer';

const NB = ' ';

export const claim = 'La préparation opérationnelle de ta course de trail';

/** L'ordre du menu suit l'ordre des sections de la page. */
export const navLinks: readonly NavLink[] = [
  { label: 'Comment ça marche', href: '#comment' },
  { label: 'Le plan', href: '#produit' },
  { label: 'Autour du plan', href: '#autour' },
  { label: 'Conditions', href: '#conditions' },
  { label: 'Tarifs', href: '#saison' },
  { label: 'Questions', href: '#ressources' },
];

export const hero = {
  eyebrow: 'Ton trail, enfin organisé',
  titleTop: 'Prépare ta course.',
  titleBottom: 'PLUKA organise le reste.',
  lede: `Une fois inscrit, transforme les informations de ta course en un plan concret${NB}: temps de passage, nutrition, matériel, assistance et conditions sur le parcours.`,
  primary: 'Préparer ma prochaine course',
  secondary: 'Voir comment ça marche',
  note: `Phase de test${NB}: les fonctionnalités sont ouvertes gratuitement aux premiers testeurs.`,
} as const;

/** Panneau de démonstration du hero — plan projeté sur le Wildstrubel 70. */
export const heroPlan = {
  label: 'Mon plan · Wildstrubel 70',
  eta: '12 h 30',
  meta: '72 km · D+ 4 600 m',
  facts: [
    { label: 'Départ', value: '06:00', tone: 'plain' },
    { label: 'Arrivée estimée', value: '18:37', tone: 'lichen' },
    { label: 'Marge la plus courte', value: '37 min', tone: 'dawn' },
  ],
  rows: [
    { mark: 'dot', label: 'Adelboden', meta: 'barrière 13:00', metaTone: 'muted', eta: '11:42' },
    {
      mark: 'triangle',
      label: 'Iffigenalp',
      meta: 'marge 37 min',
      metaTone: 'dawn',
      eta: '15:54',
    },
    {
      mark: 'crew',
      label: 'Alice · assistance à Lenk',
      meta: null,
      metaTone: 'muted',
      eta: '14:35',
    },
  ],
} as const;

export const problem = {
  title: 'Préparer un ultra ne devrait pas demander douze onglets ouverts.',
  scatter: [
    { icon: 'FilePdf', label: 'Le règlement dans un PDF de 24 pages' },
    { icon: 'MapTrifold', label: 'Le GPX sur un autre site' },
    { icon: 'Note', label: 'Les horaires dans une note du téléphone' },
    { icon: 'Table', label: 'La nutrition dans un tableur' },
    { icon: 'ChatCircle', label: `Les consignes de l'assistance sur WhatsApp` },
  ],
  cta: 'Voir ce que PLUKA construit',
} as const;

export const steps = [
  {
    num: '01',
    title: 'Choisis ta course',
    text: 'PLUKA réunit les informations utiles de ton épreuve : parcours, ravitaillements, barrières horaires, règlement, matériel obligatoire, logistique.',
  },
  {
    num: '02',
    title: 'Fixe ton objectif',
    text: 'Indique le chrono que tu vises. PLUKA construit un premier plan adapté au profil du parcours, que tu peux ajuster tout de suite.',
  },
  {
    num: '03',
    title: 'Prépare le reste',
    text: 'Nutrition, matériel, sacs, assistance et conditions sur le parcours s’organisent autour de ton plan.',
  },
] as const;

export const planPoints = [
  'Temps de passage par section, arrêts inclus',
  'Marge restante à chaque barrière horaire',
  'Horaires verrouillés quand tu connais déjà ton rythme',
  'Recalcul immédiat de tout le plan après une modification',
  'Roadbook lisible avant le départ comme en course',
] as const;

export const timeline = [
  {
    name: 'Kandersteg · départ',
    meta: 'km 0 · vague 2',
    eta: '06:00',
    icon: 'Flag',
    tone: 'muted',
    row: 'plain',
  },
  {
    name: 'Adelboden',
    meta: 'km 31,2 · ravitaillement · assistance',
    eta: '11:42',
    icon: 'UsersThree',
    tone: 'forest',
    row: 'glacier',
  },
  {
    name: 'Lenk',
    meta: 'km 46,0 · passage verrouillé',
    eta: '14:35',
    icon: 'LockSimple',
    tone: 'forest',
    row: 'plain',
  },
  {
    name: 'Iffigenalp',
    meta: 'barrière 16:31 · marge 37 min',
    eta: '15:54',
    icon: 'ClockCountdown',
    tone: 'warning',
    row: 'warning',
  },
  {
    name: 'Crans-Montana · arrivée',
    meta: 'km 72 · 4 600 m D+',
    eta: '18:37',
    icon: 'FlagCheckered',
    tone: 'muted',
    row: 'plain',
  },
] as const;

/**
 * Trois tuiles « autour du plan ». Le prototype n'y applique pas la même
 * typographie d'un encart à l'autre : la valeur est en mono pour Nutrition et
 * Assistance, la note l'est pour Préparation. `valueMono` / `noteMono` portent
 * cette différence plutôt que de l'aplatir.
 */
export const around = [
  {
    label: 'Nutrition',
    title: 'Quoi consommer, quand, et quoi récupérer au prochain ravito.',
    text: 'Tes cibles horaires sont placées sur ta timeline, section par section, avec les quantités à préparer et ce que tu trouveras sur place.',
    insetLabel: 'Section Adelboden → Lenk',
    insetValue: '75 g/h · 550 ml/h · 500 mg/h',
    valueMono: true,
    insetNote: '2 gels, 1 barre salée, 1 flasque à remplir',
    noteMono: false,
  },
  {
    label: 'Préparation',
    title: 'Matériel obligatoire, sacs, checklists et choses à ne pas oublier.',
    text: 'Le matériel obligatoire est extrait du règlement de ton épreuve, avec sa source. Tes sacs se remplissent depuis ton plan, pas depuis une liste générique.',
    insetLabel: 'Sac assistance Adelboden',
    insetValue: 'Chaussettes sèches · 3 gels · veste',
    valueMono: false,
    insetNote: 'À déposer avant 05:30',
    noteMono: true,
  },
  {
    label: 'Assistance',
    title: 'Où ton accompagnant doit être, à quelle heure et avec quoi.',
    text: `Un lien privé suffit${NB}: pas de compte à créer de son côté. Il voit les horaires de passage, l’accès, et ce qu’il doit te donner.`,
    insetLabel: 'Alice · Adelboden',
    insetValue: 'passage prévu 11:42 ± 22 min',
    valueMono: true,
    insetNote: 'Parking Boden, 5 min à pied',
    noteMono: false,
  },
] as const;

export const conditions = {
  label: 'Conditions de course',
  title: 'Même la météo suit ton plan.',
  lede: 'À partir de J-14, PLUKA croise les prévisions avec ton parcours, l’altitude et tes horaires de passage pour te montrer les conditions que tu devrais rencontrer — là où tu seras, au moment où tu devrais y passer.',
  note: `Si tu modifies ton objectif ou ton heure de départ, les conditions se recalent sur tes nouveaux horaires. Aucune prévision avant J-14${NB}: à cette échéance, personne ne peut rien promettre sur un col précis.`,
  chips: ['Inclus dans Race Pass', 'Toutes tes courses avec PLUKA+'],
  point: 'Col du Rawil',
  pointMeta: 'km 62,8 · 2 429 m',
  pointEta: 'passage prévu par ton plan · 17:20',
  rows: [
    { mark: 'triangle', label: 'Froid + vent', value: '4 ° · ressenti 1 °' },
    { mark: 'dot', label: 'Rafales', value: '38 km/h' },
  ],
  prep: '2 éléments à vérifier dans ta préparation',
} as const;

export const statuses = [
  {
    label: 'Officielle',
    icon: 'SealCheck',
    tone: 'glacier',
    text: 'Information fournie ou validée par l’organisation de l’épreuve, avec sa référence exacte dans le règlement ou le guide coureur.',
  },
  {
    label: 'Validée PLUKA',
    icon: 'ShieldCheck',
    tone: 'success',
    text: 'Information contrôlée par PLUKA à partir des sources disponibles, quand l’organisation ne l’a pas encore confirmée.',
  },
  {
    label: 'Communauté',
    icon: 'ChatsCircle',
    tone: 'community',
    text: 'Retour d’un participant : utile sur le terrain, jamais présenté comme une règle officielle.',
  },
] as const;

export const reliability = {
  title: `Une information importante${NB}? Vérifie toujours sa source.`,
  lede: 'Plus besoin de se demander si une règle vient du règlement de l’édition en cours, d’un post oublié ou d’un commentaire de l’an dernier. Chaque information affichée dans PLUKA porte son origine.',
  source: {
    kicker: 'Source officielle',
    title: 'Règlement Wildstrubel 2026',
    meta: 'Page 14 · Article 9.1 — Assistance personnelle',
    quote: `«${NB}L’assistance personnelle est autorisée uniquement dans les zones d’assistance prévues d’Adelboden (km 31,2) et de Lenk (km 46,0).${NB}»`,
    cta: 'Voir la source',
  },
  ask: {
    title: 'Pose ta question. PLUKA cherche dans ta course.',
    text: `Ce n’est pas une IA qui sait tout${NB}: c’est une façon plus simple d’interroger les informations disponibles pour ton épreuve.`,
    question: `«${NB}Est-ce qu’Alice peut m’assister à Adelboden${NB}?${NB}»`,
    answer:
      'Oui. L’assistance est autorisée dans la zone prévue, à la sortie du ravitaillement d’Adelboden.',
    answerSource: 'Source officielle · Règlement 2026, page 14 · article 9.1',
  },
} as const;

export const season = {
  eyebrow: 'PLUKA+',
  title: 'Toute ta saison, pas seulement la semaine avant ton ultra.',
  lede: `Entre deux courses, PLUKA reste utile${NB}: tes sorties longues se préparent comme des courses, tes stratégies se testent avant le jour J, et ce qui fonctionne pour toi reste enregistré d’une saison à l’autre.`,
  cards: [
    {
      icon: 'Mountains',
      title: 'Tes sorties longues aussi',
      text: `Importe une trace GPX${NB}: PLUKA en déduit le profil, une durée estimée, tes jalons nutrition et ta checklist — comme pour une course.`,
    },
    {
      icon: 'Flask',
      title: 'Teste ta stratégie avant le jour J',
      text: 'Rejoue la stratégie nutrition de ta prochaine course sur une sortie longue, puis ajuste-la avec ton retour. Deux sorties de préparation sont même incluses avec un Race Pass.',
    },
    {
      icon: 'Books',
      title: 'Garde ce qui fonctionne',
      text: `Stratégies, produits, modèles de matériel et de sacs${NB}: ta préparation ne repart pas de zéro à chaque course.`,
    },
  ],
  beta: {
    label: 'Beta PLUKA',
    text: 'Pendant la phase de test, toutes les fonctionnalités sont ouvertes gratuitement aux testeurs. Les tarifs ci-dessous sont ceux prévus après cette phase.',
  },
  footnote: `Race Pass, c’est «${NB}je prépare cette course${NB}» — deux sorties de préparation comprises. PLUKA+, c’est «${NB}PLUKA m’accompagne toute ma saison${NB}». Si l’organisation de ta course est partenaire PLUKA, la préparation complète de cette course est incluse avec ton inscription.`,
} as const;

export const pricing = [
  {
    name: 'Free',
    price: '0 €',
    unit: '',
    sub: 'Découvrir PLUKA',
    cta: 'Commencer',
    featured: false,
    tag: null,
    lines: [
      'Informations officielles et sources',
      'Alertes météo de l’organisation',
      'Matériel obligatoire',
      'Plan estimé de ta course',
    ],
  },
  {
    name: 'Race Pass',
    price: '14,90 €',
    unit: 'par course',
    sub: 'Préparer cette course à fond',
    cta: 'Préparer une course',
    featured: false,
    tag: null,
    lines: [
      'Plan complet et éditable',
      'Nutrition et conditions de course',
      'Météo point par point dès J-14',
      'Préparation, sacs et assistance',
      '2 sorties de préparation liées',
    ],
  },
  {
    name: 'PLUKA+',
    price: '44,90 €',
    unit: 'par an',
    sub: 'Toute ta saison avec toi',
    cta: 'Découvrir PLUKA+',
    featured: true,
    tag: 'Recommandé',
    lines: [
      'Toutes tes courses',
      'Tout Race Pass inclus',
      'Météo sur toutes tes courses et sorties',
      'Sorties personnelles illimitées',
      'Stratégies et modèles réutilisables',
      'Mémoire de saison',
    ],
  },
] as const;

export const organisers = {
  eyebrow: 'Organisateurs',
  title: `Et si vos participants arrivaient mieux préparés au départ${NB}?`,
  lede: `PLUKA transforme les informations officielles de votre événement en espaces de préparation personnalisés. Vous fournissez vos données une fois${NB}; chaque participant les transforme en plan de course, matériel, nutrition et assistance.`,
  benefits: [
    {
      title: 'Des informations mieux utilisées',
      text: 'Vos règles importantes ne restent plus enfouies dans un PDF : elles apparaissent au moment où le participant en a besoin.',
    },
    {
      title: 'Des participants mieux préparés',
      text: 'Chaque coureur transforme vos données officielles en préparation personnelle, matériel et assistance compris.',
    },
    {
      title: 'Moins de questions répétitives',
      text: 'Les participants retrouvent et interrogent directement les informations officielles de votre épreuve.',
    },
    {
      title: 'Une meilleure lecture des besoins',
      text: 'Vous suivez l’activation de vos participants et les thématiques les plus consultées.',
    },
  ],
  card: {
    title: 'Wildstrubel by UTMB',
    meta: 'Édition 2026 · back-office',
    rows: [
      {
        icon: 'FilePdf',
        label: 'Règlement 2026 · 24 pages',
        status: '23 informations',
        tone: 'glacier',
      },
      {
        icon: 'Globe',
        label: 'Site officiel de l’événement',
        status: 'Relevé le 2 juillet',
        tone: 'community',
      },
      {
        icon: 'SealCheck',
        label: 'Barrières horaires Wild 70',
        status: 'Officielle',
        tone: 'official',
      },
      { icon: 'Warning', label: 'Zone d’assistance Lenk', status: 'À vérifier', tone: 'check' },
    ],
    flowLabel: 'Côté participant',
    flow: [
      'Invitation personnalisée envoyée par l’organisation',
      `«${NB}Ton espace Wild 70 est presque prêt${NB}»`,
      'Le participant fixe son objectif',
      'Son premier plan de course est généré',
    ],
  },
  primary: 'Découvrir PLUKA pour mon événement',
  secondary: 'Nous contacter',
} as const;

export const earlyAccess = {
  title: 'PLUKA se construit avec ceux qui courent.',
  lede: 'Nous ouvrons progressivement PLUKA à de premiers trailers et organisateurs, pour construire un outil réellement utile sur le terrain. Vos retours orientent directement le produit.',
  primary: 'Tester PLUKA',
  secondary: 'Je suis organisateur',
} as const;

export const faq: readonly FaqEntry[] = [
  {
    q: 'Qu’est-ce qu’un plan de course en trail ?',
    a: 'C’est la projection de ta course : les temps de passage estimés à chaque ravitaillement et point clé, la durée de tes arrêts, les marges qu’il te reste avant chaque barrière horaire et l’heure d’arrivée qui en découle. Un plan de course sert à décider avant le départ, puis à savoir en course si tu es dans ton rythme.',
  },
  {
    q: 'Comment calculer ses temps de passage sur un trail ?',
    a: 'À partir du parcours plutôt que d’une vitesse moyenne : distance et dénivelé de chaque section, nature du terrain, durée réaliste des arrêts, puis répartition de ton objectif final sur ces sections. PLUKA construit cette répartition automatiquement et la recalcule dès que tu modifies une section, un arrêt ou que tu verrouilles un horaire de passage.',
  },
  {
    q: 'PLUKA est-il un plan d’entraînement ?',
    a: 'Non. PLUKA n’écrit pas tes séances et ne remplace pas un coach. PLUKA intervient une fois ta course choisie, pour préparer et organiser cette course précise : plan de course, nutrition, matériel, sacs, logistique et assistance.',
  },
  {
    q: 'Peut-on préparer sa nutrition avec PLUKA ?',
    a: 'Oui. Tu définis tes cibles horaires — glucides, hydratation, sodium, caféine — et PLUKA les répartit le long de ton plan en tenant compte de ton allure, des ravitaillements et des conditions prévues (chaud, froid, nuit). Tu obtiens des jalons nutrition sur ta timeline et la liste de ce qu’il faut préparer avant le départ.',
  },
  {
    q: 'PLUKA fonctionne-t-il pour un ultra-trail ?',
    a: 'C’est même son terrain principal : plusieurs barrières horaires, bases vie, sacs, assistance sur plusieurs points, nuit et ravitaillements espacés. PLUKA reste utile sur un format plus court, en restant plus simple.',
  },
  {
    q: 'Comment partager mon plan avec mon assistance ?',
    a: 'Tu choisis tes points d’assistance et tu envoies un lien privé à ton accompagnant. Il y trouve le lieu, le passage estimé, la fenêtre probable, ce qu’il doit apporter et récupérer, les consignes et l’accès — sans créer de compte, et sans accéder au reste de ton espace.',
  },
  {
    q: 'D’où viennent les informations sur les courses ?',
    a: 'Des documents officiels de l’épreuve : règlement, guide coureur, site de l’organisation, trace GPX. Chaque information affichée indique son statut — officielle, validée PLUKA ou communautaire — et renvoie vers la source exacte, page et article compris.',
  },
  {
    q: 'Que se passe-t-il si ma course n’est pas encore dans PLUKA ?',
    a: 'Tu peux l’ajouter à partir de son site ou de ses documents. PLUKA en extrait les éléments utiles — parcours, ravitaillements, barrières, matériel — que tu valides avant de générer ton plan. La course devient alors disponible pour les autres participants.',
  },
];

export const finalCta = {
  title: 'Ta prochaine course mérite mieux qu’un tableur.',
  lede: 'Trouve ton épreuve, fixe ton objectif et construis ton premier plan avec PLUKA.',
  primary: 'Préparer ma course',
  secondary: 'Je suis organisateur',
} as const;

export const footerTagline =
  'La préparation opérationnelle de ta course de trail et d’ultra-trail.';

export const footerColumns: readonly FooterColumn[] = [
  {
    title: 'Produit',
    links: [
      { label: 'Plan de course', href: '#produit' },
      { label: 'Nutrition', href: '#autour' },
      { label: 'Préparation et matériel', href: '#autour' },
      { label: 'Assistance', href: '#autour' },
    ],
  },
  {
    title: 'Ressources',
    links: [
      { label: 'Courses', href: '#ressources' },
      { label: 'Préparation trail', href: '#ressources' },
      { label: 'Blog', href: '#ressources' },
      { label: 'FAQ', href: '#ressources' },
    ],
  },
  {
    title: 'Organisateurs',
    links: [
      { label: 'PLUKA pour les organisateurs', href: '/organisateurs' },
      { label: 'Contact', href: '/organisateurs#contact' },
    ],
  },
  {
    title: 'PLUKA',
    links: [
      { label: 'À propos', href: '#contact' },
      { label: 'Contact', href: '#contact' },
      { label: 'Confidentialité', href: '#contact' },
      { label: 'CGU', href: '#contact' },
    ],
  },
];

export const footerDisclaimer = `PLUKA n’est pas un plan d’entraînement${NB}: PLUKA prépare la course que tu vas courir.`;
