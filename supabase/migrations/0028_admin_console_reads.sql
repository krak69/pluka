-- PLUKA V1 — Lectures de la console d'administration
-- File target: supabase/migrations/0028_admin_console_reads.sql
-- Référence : docs/03_PRIVACY_RLS.md §8, §104 · docs/00_PRODUCT_SPEC.md §3.5
--
-- POURQUOI
--
-- L'administration PLUKA doit montrer huit écrans que 0005 ne lui laisse pas
-- lire. Sous RLS, `pluka_admin` ne voit que `events`, `editions`, `races` et
-- `users` : ni les organisations non actives, ni les sources d'une édition en
-- brouillon, ni un produit nutrition non validé, ni un signalement, ni la file
-- de traitements, ni le journal d'audit.
--
-- Ce n'est pas un oubli de 0005. §104 le dit :
--
--   « Le simple statut `pluka_admin` ne doit pas transformer toutes les
--     données en contenu courant de l'admin UI. »
--
-- 0007 s'est arrêtée là pour cette raison — « l'ouverture est additive et
-- s'arrête au référentiel de course » — et la suite pgTAP 07 le vérifie :
-- l'admin ne lit aucun Plan, aucune Nutrition, aucune Assistance, aucune
-- sortie. Elle en tire aussi le mécanisme :
--
--   « le support passe par des use cases audités, pas par une lecture directe »
--
-- CE QUE CETTE MIGRATION FAIT
--
-- Aucune nouvelle policy de lecture. Onze fonctions `security definer`, une
-- par écran, qui contournent la RLS et portent donc elles-mêmes leur condition
-- d'accès (§8). Chacune ne rend que les colonnes de son écran : une fonction
-- large redeviendrait la « navigation informelle » que §104 refuse.
--
-- Toutes sont en `plpgsql`, et la garde est un `perform` en première ligne,
-- jamais un prédicat de `where`. La nuance est réelle : sur une table vide, le
-- planificateur peut n'évaluer aucun prédicat, et un non-admin recevrait un
-- résultat vide au lieu d'un refus.
--
-- Un non-admin n'est donc pas servi à vide, il est refusé — `42501`. Une
-- réponse vide se confondrait avec « rien à afficher », et masquerait une
-- erreur de droits derrière un écran plausible.
--
-- L'AUDIT
--
-- §104 demande un accès « justifié ; audité ». `private.record_audit` est le
-- mécanisme unique, réutilisable : les trois lectures de données personnelles
-- l'appellent, et les écritures d'administration à venir s'y brancheront sans
-- qu'une seconde façon d'écrire le journal apparaisse.
--
-- Les lectures opérationnelles — compteurs, organisations, sources, produits,
-- traitements, file de validation — n'écrivent rien : auditer la consultation
-- d'une file de jobs produirait un journal de bruit où l'accès à une identité
-- passerait inaperçu.
--
-- La lecture du journal lui-même n'est pas journalisée non plus : chaque visite
-- polluerait ce qu'elle affiche.
--
-- PORTÉE
--
-- Lecture seule. Aucune de ces fonctions n'écrit, hors la ligne d'audit. Les
-- écritures d'administration — relance d'un traitement, modération d'un
-- signalement, validation d'un produit — n'ont pas de use case et arriveront
-- avec le leur.

begin;

-- ============================================================
-- 1. Socle : garde et audit
-- ============================================================

create or replace function private.assert_pluka_admin(p_action text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.users u
    where u.id = (select auth.uid()) and u.platform_role = 'pluka_admin'
  ) then
    -- `42501` est le code que PostgreSQL émet lui-même sur une policy violée :
    -- l'appelant n'a pas à distinguer un refus de fonction d'un refus de table.
    raise exception 'action reservee a l''administration PLUKA : %', p_action
      using errcode = '42501';
  end if;
end;
$$;

comment on function private.assert_pluka_admin(text) is
  'Garde des fonctions d''administration. Refuse (42501) plutot que de rendre un resultat vide, qui se confondrait avec « rien a afficher » (03_PRIVACY_RLS §8, §104).';

/*
 * Mécanisme d'audit unique — §104.
 *
 * Une seule fonction pour tout ce que l'administration fait de traçable. Les
 * lectures de données personnelles l'appellent aujourd'hui ; les écritures s'y
 * brancheront, et le journal restera homogène.
 *
 * `action` suit la convention de 0012 — `fact.publish`, `fact.reject` — donc
 * `<domaine>.<verbe>` : `user.read`, `user.search`, `report.read`.
 */
create or replace function private.record_audit(
  p_action text,
  p_entity_table text,
  p_entity_id uuid default null,
  p_after jsonb default null
)
returns void language sql security definer set search_path = '' as $$
  insert into private.audit_logs
    (actor_user_id, action, entity_table, entity_id, after_data)
  values ((select auth.uid()), p_action, p_entity_table, p_entity_id, p_after);
$$;

comment on function private.record_audit(text, text, uuid, jsonb) is
  'Ecriture du journal d''audit. Point d''entree unique : toute action d''administration tracable passe par ici (03_PRIVACY_RLS §104).';

-- ============================================================
-- 2. Vue d'ensemble
-- ============================================================

/*
 * Compteurs de plateforme.
 *
 * Des `count(*)`, pas des estimations : le prototype affiche « 128 événements »
 * et « 18 450 participants actifs », et un chiffre approché sur un écran
 * d'administration serait pire qu'absent.
 *
 * Aucun compteur ne porte de donnée personnelle — ce sont des cardinalités.
 */
create or replace function public.admin_platform_counters()
returns table (
  events_total bigint,
  events_published bigint,
  editions_total bigint,
  races_total bigint,
  races_published bigint,
  organizations_total bigint,
  organizations_active bigint,
  participations_active bigint,
  candidates_pending bigint,
  jobs_failed bigint,
  reports_open bigint,
  products_draft bigint,
  sources_failed bigint
)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_pluka_admin('admin_platform_counters');

  return query select
    (select count(*) from public.events),
    (select count(*) from public.events where status = 'published'),
    (select count(*) from public.editions),
    (select count(*) from public.races),
    (select count(*) from public.races where status = 'published'),
    (select count(*) from public.organizations),
    (select count(*) from public.organizations where status = 'active'),
    (select count(*) from public.participant_races where status = 'active'),
    (select count(*) from private.fact_candidates
      where status in ('detected', 'needs_review', 'conflict')),
    (select count(*) from private.ingestion_jobs where status = 'failed'),
    (select count(*) from public.community_reports where status = 'open'),
    (select count(*) from public.nutrition_products where status = 'draft'),
    (select count(*) from public.sources where status = 'failed');
end;
$$;

comment on function public.admin_platform_counters is
  'Cardinalites de la vue d''ensemble. Aucune donnee personnelle, donc aucune ecriture d''audit.';

-- ============================================================
-- 3. Organisations
-- ============================================================

/*
 * Tous les statuts, y compris `prospect`, `suspended` et `archived`.
 *
 * `organizations__select__active` n'ouvre que les actives, à tout le monde :
 * une organisation en discussion ou sortie de circulation serait invisible de
 * l'administration, qui est précisément celle qui doit la suivre.
 *
 * `contact_email` est une adresse d'organisation, pas de personne : §28
 * minimise l'email des participants, pas celui d'un partenaire.
 */
create or replace function public.admin_list_organizations(p_limit integer default 100)
returns table (
  organization_id uuid,
  name text,
  slug text,
  status public.organization_status,
  contact_email text,
  events_count bigint,
  races_count bigint,
  members_count bigint,
  created_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_pluka_admin('admin_list_organizations');

  return query select
    o.id,
    o.name,
    o.slug,
    o.status,
    o.contact_email::text,
    (select count(*) from public.events e where e.organization_id = o.id),
    (select count(*)
       from public.races r
       join public.editions ed on ed.id = r.edition_id
       join public.events e2 on e2.id = ed.event_id
      where e2.organization_id = o.id),
    (select count(*) from public.organization_members m where m.organization_id = o.id),
    o.created_at
  from public.organizations o
  order by o.name
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

-- ============================================================
-- 4. Sources
-- ============================================================

/*
 * Toutes les éditions, y compris en brouillon.
 *
 * `sources__select__edition_readable` suit la lisibilité publique de l'édition.
 * L'administration doit voir la source d'un événement qui n'est pas encore
 * publié : c'est même le moment où son analyse compte.
 *
 * Le nombre d'extraits vient de `private.source_chunks`, que rien d'autre
 * n'expose.
 */
create or replace function public.admin_list_sources(p_limit integer default 100)
returns table (
  source_id uuid,
  title text,
  source_type public.source_type,
  status public.source_status,
  url text,
  event_name text,
  -- `editions.year` est un `smallint` : le déclarer `integer` fait échouer
  -- `return query` sur un écart de type que rien ne convertit implicitement.
  edition_year smallint,
  snapshot_retrieved_at timestamptz,
  chunks_count bigint,
  imported_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_pluka_admin('admin_list_sources');

  return query select
    s.id,
    s.title,
    s.source_type,
    s.status,
    s.url,
    e.name,
    ed.year,
    snap.retrieved_at,
    (select count(*) from private.source_chunks c
      where c.source_snapshot_id = s.current_snapshot_id),
    s.imported_at
  from public.sources s
  join public.editions ed on ed.id = s.edition_id
  join public.events e on e.id = ed.event_id
  left join public.source_snapshots snap on snap.id = s.current_snapshot_id
  order by s.imported_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

-- ============================================================
-- 5. Produits nutrition
-- ============================================================

/*
 * Tous les statuts. `nutrition_products__select__validated` n'ouvre que les
 * `validated` : l'onglet « À vérifier » du prototype porte exactement sur les
 * `draft`, donc sur ce que personne ne peut lire aujourd'hui.
 */
create or replace function public.admin_list_nutrition_products(
  p_status public.nutrition_product_status default null,
  p_limit integer default 200
)
returns table (
  product_id uuid,
  brand text,
  name text,
  variant text,
  category public.nutrition_product_category,
  status public.nutrition_product_status,
  carbs_g numeric,
  sodium_mg integer,
  caffeine_mg integer,
  hydration_ml integer,
  source_url text,
  verified_at timestamptz,
  updated_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_pluka_admin('admin_list_nutrition_products');

  return query select
    p.id, p.brand, p.name, p.variant, p.category, p.status,
    p.carbs_g, p.sodium_mg, p.caffeine_mg, p.hydration_ml,
    p.source_url, p.verified_at, p.updated_at
  from public.nutrition_products p
  where p_status is null or p.status = p_status
  order by p.brand nulls last, p.name
  limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

-- ============================================================
-- 6. Signalements
-- ============================================================

/*
 * La liste ne porte pas le contenu signalé, et ne nomme pas le déclarant.
 *
 * Un signalement met en cause deux personnes : celle qui écrit et celle qui est
 * visée. La file de triage se lit au motif, au statut et à la date ; le contenu
 * n'arrive qu'au détail, et ce détail est audité.
 *
 * `target_kind` dit sur quoi porte le signalement sans rien en révéler.
 */
create or replace function public.admin_list_reports(p_limit integer default 100)
returns table (
  report_id uuid,
  reason public.report_reason,
  status public.report_status,
  target_kind text,
  created_at timestamptz,
  resolved_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_pluka_admin('admin_list_reports');

  return query select
    r.id,
    r.reason,
    r.status,
    case when r.post_id is not null then 'post' else 'thread' end,
    r.created_at,
    r.resolved_at
  from public.community_reports r
  order by
    case r.status when 'open' then 0 when 'reviewed' then 1 else 2 end,
    r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

comment on function public.admin_list_reports is
  'File de triage : motif, statut, dates. Ni contenu signale, ni declarant — ils appartiennent au detail, qui est audite (§104).';

/*
 * Détail d'un signalement — lecture de données personnelles, donc auditée.
 *
 * Trois personnes peuvent apparaître ici : le déclarant, l'auteur du contenu,
 * et l'administrateur qui regarde. Le journal enregistre le troisième.
 */
create or replace function public.admin_get_report(p_report_id uuid)
returns table (
  report_id uuid,
  reason public.report_reason,
  status public.report_status,
  details text,
  reporter_email text,
  target_kind text,
  target_content text,
  target_author_email text,
  created_at timestamptz,
  resolved_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_pluka_admin('admin_get_report');
  perform private.record_audit('report.read', 'community_reports', p_report_id);

  return query select
    r.id,
    r.reason,
    r.status,
    r.details,
    reporter.email::text,
    case when r.post_id is not null then 'post' else 'thread' end,
    coalesce(po.body, th.title),
    author.email::text,
    r.created_at,
    r.resolved_at
  from public.community_reports r
  join public.users reporter on reporter.id = r.reporter_user_id
  left join public.community_posts po on po.id = r.post_id
  left join public.community_threads th on th.id = r.thread_id
  left join public.users author on author.id = po.author_user_id
  where r.id = p_report_id;
end;
$$;

comment on function public.admin_get_report is
  'Detail d''un signalement, contenu et personnes comprises. Ecrit dans le journal d''audit : §104 exige un acces justifie et audite.';

-- ============================================================
-- 7. Utilisateurs
-- ============================================================

/*
 * Identité, niveau de droit, nombre de courses. Un compteur, pas la liste.
 *
 * Ce que cette fonction ne rend pas est le point : aucun Plan, aucune
 * Nutrition, aucune Assistance, aucune sortie, aucun profil trailer. La suite
 * pgTAP 07 affirme que l'admin n'y accède pas, et §104 vaut pour lui ; ce n'est
 * pas une fonction d'administration qui doit le contredire.
 *
 * Le niveau de droit suit la priorité de 04_ENTITLEMENTS §21 — « le droit le
 * plus large gagne » : PLUKA+ devant une préparation offerte, celle-ci devant
 * un Race Pass, et Free à défaut. Seuls les droits actifs et non expirés
 * comptent.
 *
 * La recherche est auditée autant que la fiche : une liste d'identités est une
 * donnée personnelle. L'entrée journalisée porte le terme cherché et le nombre
 * de correspondances, pas les personnes trouvées — les journaliser recopierait
 * dans le journal ce que la lecture devait seulement montrer.
 */
create or replace function public.admin_search_users(
  p_query text default null,
  p_limit integer default 50
)
returns table (
  user_id uuid,
  email text,
  first_name text,
  last_name text,
  platform_role public.platform_role,
  entitlement_level text,
  races_count bigint,
  created_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
  v_term text := coalesce(p_query, '');
  v_pattern text;
  v_matches bigint;
begin
  perform private.assert_pluka_admin('admin_search_users');

  -- Les caractères de motif sont échappés : un `%` saisi transformerait la
  -- recherche en balayage complet, un `_` en joker d'un caractère.
  v_pattern := '%' || replace(replace(replace(v_term, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  select count(*) into v_matches
  from public.users u
  where v_term = ''
     or u.email::text ilike v_pattern
     or coalesce(u.first_name, '') ilike v_pattern
     or coalesce(u.last_name, '') ilike v_pattern;

  perform private.record_audit(
    'user.search',
    'users',
    null,
    jsonb_build_object('query', v_term, 'matches', v_matches)
  );

  return query select
    u.id,
    u.email::text,
    u.first_name,
    u.last_name,
    u.platform_role,
    coalesce(
      (select case
                when bool_or(en.kind = 'plus') then 'plus'
                when bool_or(en.kind = 'organizer_included') then 'organizer_included'
                when bool_or(en.kind = 'race_pass') then 'race_pass'
              end
         from public.entitlements en
        where en.user_id = u.id
          and en.status = 'active'
          and (en.ends_at is null or en.ends_at > now())),
      'free'),
    (select count(*) from public.participant_races pr
      where pr.user_id = u.id and pr.status <> 'archived'),
    u.created_at
  from public.users u
  where v_term = ''
     or u.email::text ilike v_pattern
     or coalesce(u.first_name, '') ilike v_pattern
     or coalesce(u.last_name, '') ilike v_pattern
  order by u.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

comment on function public.admin_search_users is
  'Identite, niveau de droit et nombre de courses. Aucun Plan, aucune Nutrition, aucune Assistance (§104, pgTAP 07). Audite : le journal porte le terme cherche et le nombre de correspondances, pas les personnes.';

/*
 * Fiche d'un utilisateur — même périmètre que la recherche, sur une personne.
 *
 * Une entrée d'audit distincte, `user.read`, porte l'identifiant consulté :
 * c'est cette ligne qui rend l'accès « justifié ; audité » au sens de §104.
 *
 * `entitlements_detail` énumère les droits actifs par nature et par échéance.
 * C'est un droit commercial, pas une donnée de préparation : §30 le range avec
 * l'utilisateur, et il n'ouvre ni Plan, ni Nutrition, ni Assistance.
 */
create or replace function public.admin_get_user(p_user_id uuid)
returns table (
  user_id uuid,
  email text,
  first_name text,
  last_name text,
  locale text,
  timezone text,
  platform_role public.platform_role,
  entitlement_level text,
  entitlements_detail jsonb,
  races_count bigint,
  created_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_pluka_admin('admin_get_user');
  perform private.record_audit('user.read', 'users', p_user_id);

  return query select
    u.id,
    u.email::text,
    u.first_name,
    u.last_name,
    u.locale::text,
    u.timezone::text,
    u.platform_role,
    coalesce(
      (select case
                when bool_or(en.kind = 'plus') then 'plus'
                when bool_or(en.kind = 'organizer_included') then 'organizer_included'
                when bool_or(en.kind = 'race_pass') then 'race_pass'
              end
         from public.entitlements en
        where en.user_id = u.id
          and en.status = 'active'
          and (en.ends_at is null or en.ends_at > now())),
      'free'),
    coalesce(
      (select jsonb_agg(jsonb_build_object(
                'kind', en.kind,
                'source', en.source,
                'status', en.status,
                'startsAt', en.starts_at,
                'endsAt', en.ends_at)
              order by en.starts_at desc)
         from public.entitlements en
        where en.user_id = u.id),
      '[]'::jsonb),
    (select count(*) from public.participant_races pr
      where pr.user_id = u.id and pr.status <> 'archived'),
    u.created_at
  from public.users u
  where u.id = p_user_id;
end;
$$;

comment on function public.admin_get_user is
  'Fiche utilisateur : identite, droits commerciaux, nombre de courses. Aucune donnee de preparation. Ecrit dans le journal d''audit (§104).';

-- ============================================================
-- 8. Imports et traitements
-- ============================================================

/*
 * La file de traitements, avec ce qu'il faut pour diagnostiquer sans ouvrir
 * psql : statut, erreur, clé d'idempotence, tentatives, horodatages.
 *
 * `private.ingestion_jobs` est `service only` (§8) et le reste : cette fonction
 * est le seul chemin de lecture, et elle porte sa condition d'accès.
 *
 * `idempotency_key` est rendue telle quelle. C'est une clé technique, pas un
 * secret : elle sert précisément à rapprocher un job d'un autre essai.
 */
create or replace function public.admin_list_jobs(p_limit integer default 100)
returns table (
  job_id uuid,
  job_type text,
  status text,
  idempotency_key text,
  attempts integer,
  max_attempts integer,
  last_error text,
  available_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz,
  source_title text,
  event_name text
)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_pluka_admin('admin_list_jobs');

  return query select
    j.id, j.job_type, j.status, j.idempotency_key,
    j.attempts, j.max_attempts, j.last_error,
    j.available_at, j.started_at, j.completed_at, j.created_at,
    s.title, e.name
  from private.ingestion_jobs j
  left join public.source_snapshots snap on snap.id = j.source_snapshot_id
  left join public.sources s on s.id = snap.source_id
  left join public.editions ed on ed.id = s.edition_id
  left join public.events e on e.id = ed.event_id
  order by
    case j.status when 'failed' then 0 when 'running' then 1 when 'queued' then 2 else 3 end,
    j.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

comment on function public.admin_list_jobs is
  'File de traitements : statut, erreur, cle d''idempotence, tentatives. Seul chemin de lecture de private.ingestion_jobs (§8).';

-- ============================================================
-- 9. Journal d'audit
-- ============================================================

/*
 * Le journal, lisible par l'administration.
 *
 * Cette lecture n'est pas journalisée : chaque visite ajouterait une ligne au
 * journal qu'elle affiche, et le bruit finirait par masquer les accès aux
 * données personnelles que §104 veut justement rendre visibles.
 *
 * `before_data` n'est pas rendu : il contient l'état antérieur d'un objet, donc
 * potentiellement une donnée personnelle qu'aucun écran ne demande.
 * `after_data` suffit à dire ce qui a été fait.
 */
create or replace function public.admin_list_audit(p_limit integer default 200)
returns table (
  entry_id bigint,
  action text,
  entity_table text,
  entity_id uuid,
  after_data jsonb,
  actor_email text,
  organization_name text,
  request_id text,
  created_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_pluka_admin('admin_list_audit');

  return query select
    a.id, a.action, a.entity_table, a.entity_id, a.after_data,
    actor.email::text, o.name, a.request_id, a.created_at
  from private.audit_logs a
  left join public.users actor on actor.id = a.actor_user_id
  left join public.organizations o on o.id = a.organization_id
  order by a.id desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;

comment on function public.admin_list_audit is
  'Journal d''audit. Lecture non journalisee : chaque visite polluerait ce qu''elle affiche. `before_data` n''est pas rendu.';

-- ============================================================
-- 10. File de validation globale
-- ============================================================

/*
 * `list_fact_candidates_for_review` est scopée à une course, parce que l'écran
 * de revue l'est. La file globale ne peut pas être N appels : à l'échelle du
 * prototype — 312 épreuves — ce serait 312 allers-retours par affichage.
 *
 * Elle rend moins de colonnes que la revue par course : une file sert à choisir
 * quoi examiner, pas à examiner. Le détail reste sur `/courses/[raceId]/revue`.
 */
create or replace function public.admin_list_fact_candidates(p_limit integer default 100)
returns table (
  candidate_id uuid,
  race_id uuid,
  race_name text,
  event_name text,
  category public.fact_category,
  fact_key text,
  value_text text,
  status text,
  conflict_status text,
  confidence_label text,
  extracted_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_pluka_admin('admin_list_fact_candidates');

  return query select
    c.id, c.race_id, r.name, e.name,
    c.category, c.fact_key, c.value_text,
    c.status, cr.status, c.confidence_label, run.started_at
  from private.fact_candidates c
  join public.races r on r.id = c.race_id
  join public.editions ed on ed.id = r.edition_id
  join public.events e on e.id = ed.event_id
  join private.extraction_runs run on run.id = c.extraction_run_id
  left join private.conflict_reports cr on cr.candidate_id = c.id
  where c.status in ('detected', 'needs_review', 'conflict')
  order by
    case c.status when 'conflict' then 0 when 'needs_review' then 1 else 2 end,
    run.started_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

comment on function public.admin_list_fact_candidates is
  'File de validation, toutes courses. Une seule requete : N appels de list_fact_candidates_for_review ne tiendraient pas a l''echelle.';

-- ============================================================
-- 11. Droits d'exécution
-- ============================================================

-- Chaque fonction contourne la RLS et porte sa propre garde : le droit
-- d'exécution va donc à `authenticated`, jamais à `anon`. Un visiteur non
-- authentifié n'a même pas d'identité à vérifier.
do $do$
declare
  f text;
begin
  for f in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'admin\_%'
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$do$;

-- Le socle reste interne : `private` n'est jamais exposé à PostgREST, et ces
-- deux fonctions ne sont appelées que depuis les onze ci-dessus.
revoke all on function private.assert_pluka_admin(text) from public;
revoke all on function private.record_audit(text, text, uuid, jsonb) from public;

commit;
