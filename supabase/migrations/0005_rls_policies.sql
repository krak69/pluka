-- PLUKA V1 — Row Level Security : helpers, grants et policies
-- File target: supabase/migrations/0005_rls_policies.sql
-- Référence : docs/03_PRIVACY_RLS.md (§168 recommande cette migration dédiée)
--
-- PORTÉE
--
-- 0001 a activé RLS sur toutes les tables `public` sans écrire une seule
-- policy : la base est donc actuellement en deny-by-default total. Cette
-- migration ouvre, table par table, exactement ce que la Privacy autorise.
--
-- ORDRE : helpers → revokes/grants → protections de colonnes → policies.
--
-- LA RÈGLE QUI STRUCTURE TOUT LE FICHIER
--
--   L'organisation ne voit jamais la préparation privée individuelle
--   du coureur. (§1)
--
-- Elle n'est pas appliquée par une condition à ne pas oublier, mais par une
-- absence : les tables de Plan, Nutrition, Assistance, sorties, tâches,
-- matériel, sacs, contacts d'urgence, météo personnelle, Q&A, retours
-- après-course et bibliothèque personnelle ne reçoivent **aucune policy
-- organisation**. Il n'y a rien à contourner parce qu'il n'y a rien à
-- accorder. Les tests pgTAP rejouent cette interdiction dans chaque fichier.
--
-- CE QUE CETTE MIGRATION NE FAIT PAS
--
-- - Les mutations de membres d'organisation (§15), les écritures de Plan et
--   de Nutrition (§33), les entitlements (§30) et les jetons (§45, §78)
--   n'obtiennent aucun grant d'écriture client : ces chemins passent par un
--   use case serveur. Une policy permissive y serait une porte ouverte que
--   personne n'a demandée.
-- - `service_role` n'est jamais mentionné : il contourne la RLS par
--   construction, et ce n'est pas une autorisation métier (§8).
-- - Les policies Storage sont hors périmètre de ce fichier (§82 à §90).

begin;

-- ============================================================
-- 01. Helpers
-- ============================================================
-- §9, §10 : `security definer`, `search_path` explicitement vide, minimales.
--
-- `security definer` n'est pas un raccourci de confort : il fait évaluer le
-- helper avec les droits du propriétaire, ce qui évite les cycles
-- policy → table → policy (§176) et permet de garder le schéma `private`
-- totalement fermé aux rôles client. Un `select` enveloppé dans
-- `(select auth.uid())` est évalué une fois par requête, pas une fois par
-- ligne (§175).

create or replace function private.is_pluka_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users u
    where u.id = (select auth.uid()) and u.platform_role = 'pluka_admin'
  );
$$;

comment on function private.is_pluka_admin() is
  'Rôle plateforme lu en base, jamais depuis un claim client modifiable (§178).';

-- §111 : la hiérarchie des rôles est explicite. L'ordre de l'enum
-- (owner, admin, editor, viewer) est l'inverse de la hiérarchie : s'y fier
-- donnerait des droits à l'envers.
create or replace function private.org_role_rank(p_role public.organization_member_role)
returns integer language sql immutable set search_path = '' as $$
  select case p_role
    when 'viewer' then 10
    when 'editor' then 20
    when 'admin' then 30
    when 'owner' then 40
  end;
$$;

create or replace function private.user_has_org_role(
  p_organization_id uuid,
  p_min_role public.organization_member_role
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = (select auth.uid())
      and private.org_role_rank(om.role) >= private.org_role_rank(p_min_role)
  );
$$;

comment on function private.user_has_org_role(uuid, public.organization_member_role) is
  'Appartenance vérifiée à chaque requête : un membre retiré perd l''accès immédiatement (§114).';

create or replace function private.user_is_org_member(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.user_has_org_role(p_organization_id, 'viewer');
$$;

create or replace function private.organization_of_edition(p_edition_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select e.organization_id
  from public.editions ed
  join public.events e on e.id = ed.event_id
  where ed.id = p_edition_id;
$$;

create or replace function private.organization_of_race(p_race_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select e.organization_id
  from public.races r
  join public.editions ed on ed.id = r.edition_id
  join public.events e on e.id = ed.event_id
  where r.id = p_race_id;
$$;

-- §110 : race → edition → event → organization, avec le rôle minimum requis.
create or replace function private.user_can_manage_event(
  p_event_id uuid,
  p_min_role public.organization_member_role
)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.user_has_org_role(
    (select e.organization_id from public.events e where e.id = p_event_id),
    p_min_role
  );
$$;

create or replace function private.user_can_manage_edition(
  p_edition_id uuid,
  p_min_role public.organization_member_role
)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.user_has_org_role(private.organization_of_edition(p_edition_id), p_min_role);
$$;

create or replace function private.user_can_manage_race(
  p_race_id uuid,
  p_min_role public.organization_member_role
)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.user_has_org_role(private.organization_of_race(p_race_id), p_min_role);
$$;

-- §112 : un seul endroit décide de la lisibilité publique d'une course, pour
-- que race.status, edition.status, event.status et la visibilité ne puissent
-- pas diverger d'une policy à l'autre.
create or replace function private.race_is_publicly_readable(p_race_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.races r
    join public.editions ed on ed.id = r.edition_id
    join public.events e on e.id = ed.event_id
    where r.id = p_race_id
      and r.status = 'published'
      and r.public_visibility = 'public'
      and ed.status in ('published', 'completed')
      and e.status = 'published'
  );
$$;

comment on function private.race_is_publicly_readable(uuid) is
  'Une course unlisted ou private ne devient pas lisible par la connaissance de son UUID (§17).';

create or replace function private.user_participates_in_race(p_race_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.participant_races pr
    where pr.race_id = p_race_id and pr.user_id = (select auth.uid())
  );
$$;

-- §18 : la lecture d'une table de référentiel remonte toujours jusqu'à la
-- Race. Une course non publique ne devient pas lisible par un waypoint
-- directement requêté.
create or replace function private.user_can_read_race(p_race_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.race_is_publicly_readable(p_race_id)
    or private.user_participates_in_race(p_race_id)
    or private.user_is_org_member(private.organization_of_race(p_race_id))
    or private.is_pluka_admin();
$$;

create or replace function private.race_of_waypoint(p_race_waypoint_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select w.race_id from public.race_waypoints w where w.id = p_race_waypoint_id;
$$;

-- §32, §109 : propriété d'un objet personnel, toujours résolue jusqu'à
-- `participant_races.user_id`.
create or replace function private.user_owns_participant_race(p_participant_race_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.participant_races pr
    where pr.id = p_participant_race_id and pr.user_id = (select auth.uid())
  );
$$;

create or replace function private.user_owns_race_plan(p_race_plan_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.race_plans rp
    join public.participant_races pr on pr.id = rp.participant_race_id
    where rp.id = p_race_plan_id and pr.user_id = (select auth.uid())
  );
$$;

create or replace function private.user_owns_outing(p_outing_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.outings o
    where o.id = p_outing_id and o.user_id = (select auth.uid())
  );
$$;

-- §40 : un plan Nutrition pend soit d'un Plan de course, soit d'une sortie.
-- Les deux chemins mènent au même propriétaire.
create or replace function private.user_owns_nutrition_plan(p_nutrition_plan_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.nutrition_plans np
    where np.id = p_nutrition_plan_id
      and (
        (np.race_plan_id is not null and private.user_owns_race_plan(np.race_plan_id))
        or (np.outing_id is not null and private.user_owns_outing(np.outing_id))
      )
  );
$$;

create or replace function private.user_owns_assistant(p_assistant_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.race_assistants ra
    where ra.id = p_assistant_id and private.user_owns_participant_race(ra.participant_race_id)
  );
$$;

create or replace function private.user_owns_bag(p_bag_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.bags b
    where b.id = p_bag_id and private.user_owns_participant_race(b.participant_race_id)
  );
$$;

-- §50 : un run météo appartient au Plan ou à la sortie qui l'a demandé.
create or replace function private.user_owns_weather_run(p_weather_run_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.weather_forecast_runs wr
    where wr.id = p_weather_run_id
      and (
        (wr.race_plan_id is not null and private.user_owns_race_plan(wr.race_plan_id))
        or (wr.outing_id is not null and private.user_owns_outing(wr.outing_id))
      )
  );
$$;

create or replace function private.user_owns_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.pluka_conversations c
    where c.id = p_conversation_id and c.user_id = (select auth.uid())
  );
$$;

create or replace function private.user_owns_post_race_review(p_review_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.post_race_reviews r
    where r.id = p_review_id and private.user_owns_participant_race(r.participant_race_id)
  );
$$;

create or replace function private.user_can_manage_race_fact(
  p_fact_id uuid,
  p_min_role public.organization_member_role
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.race_facts f
    where f.id = p_fact_id and private.user_can_manage_race(f.race_id, p_min_role)
  );
$$;

-- §55 : un rôle viewer organisation ne modère pas.
create or replace function private.user_can_moderate_community_thread(p_thread_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.community_threads t
    where t.id = p_thread_id
      and (
        (t.race_id is not null and private.user_can_manage_race(t.race_id, 'admin'))
        or private.user_has_org_role(private.organization_of_edition(t.edition_id), 'admin')
      )
  ) or private.is_pluka_admin();
$$;

-- §53 : la communauté est liée à une Race / édition, pas publique globalement.
create or replace function private.user_can_read_community_thread(p_thread_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.community_threads t
    where t.id = p_thread_id
      and (
        (t.race_id is not null and private.user_can_read_race(t.race_id))
        or private.user_is_org_member(private.organization_of_edition(t.edition_id))
      )
  ) or private.user_can_moderate_community_thread(p_thread_id);
$$;

-- Les helpers ne sont pas appelables directement par un client : ils servent
-- les policies, évaluées avec les droits du propriétaire (§9).
revoke all on all functions in schema private from anon, authenticated;

-- ============================================================
-- 02. Grants
-- ============================================================
-- §170 : « RLS ne suffit pas si des grants trop larges existent. » On repart
-- de zéro pour les rôles client, puis on accorde table par table l'opération
-- attendue. Une policy d'écriture sans grant correspondant est une policy
-- morte : les deux vont toujours par paire.
--
-- Conséquence volontaire : `select *` échoue sur les tables dont seules
-- certaines colonnes sont accordées — le client doit nommer ses colonnes.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- 02.1 Référentiel de course, lisible publiquement selon la visibilité
-- (§16 à §18, §42, §52).
do $$
declare t text;
begin
  foreach t in array array[
    'events', 'editions', 'races', 'event_partners',
    'race_start_waves', 'race_waypoints', 'race_segments', 'race_cutoffs',
    'race_assistance_rules', 'race_equipment_requirements', 'race_aid_station_items',
    'race_course_geometries', 'race_notices', 'race_change_events',
    'race_facts', 'race_fact_versions', 'fact_sources', 'source_race_scopes',
    'equipment_items', 'nutrition_products'
  ] loop
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end
$$;

-- 02.2 Objets personnels gérés directement par le coureur.
-- `library_templates` en fait partie : ses `payload` portent des stratégies
-- Nutrition, des sacs et des check-lists de préparation — c'est de la
-- préparation privée, pas un objet de configuration neutre (§37, §38, §40).
do $$
declare t text;
begin
  foreach t in array array[
    'trail_profiles', 'tasks', 'participant_equipment', 'bags', 'bag_items',
    'participant_race_settings', 'outings', 'outing_waypoints', 'outing_equipment',
    'outing_feedback', 'user_nutrition_products', 'library_templates',
    'race_assistants', 'assistance_assignments', 'assistance_items',
    'emergency_contacts', 'post_race_reviews', 'post_race_review_publications',
    'pluka_conversations', 'community_threads', 'community_posts',
    'community_reactions', 'community_reports'
  ] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end
$$;

-- 02.3 Objets personnels en lecture seule côté client.
-- §33 : les mutations de Plan et de Nutrition passent par le serveur —
-- entitlement, moteur déterministe, versioning, outbox. §34 : le client ne
-- déclare jamais lui-même de quelle version de fact son Plan dépend.
-- §49, §50 : le refresh météo est serveur. §63 : un message Q&A est produit
-- par le serveur, pas écrit librement par le client.
do $$
declare t text;
begin
  foreach t in array array[
    'race_plans', 'plan_waypoints', 'plan_segments', 'plan_cutoff_statuses',
    'plan_version_dependencies', 'participant_change_impacts',
    'nutrition_plans', 'nutrition_conditions', 'nutrition_condition_ranges',
    'nutrition_waypoints', 'nutrition_waypoint_items', 'nutrition_recalculations',
    'weather_forecast_runs', 'weather_forecast_points', 'condition_periods',
    'pluka_messages', 'pluka_answer_sources',
    'entitlements', 'entitlement_usage', 'purchases', 'beta_access_grants',
    'participant_invitations'
  ] loop
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end
$$;

-- §51 : une proposition Conditions est privée, mais l'utilisateur l'accepte
-- ou l'écarte lui-même — c'est le seul verbe d'écriture dont il a besoin.
grant select, update on public.condition_proposals to authenticated;

-- 02.4 Écritures organisation.
-- Le grant ouvre l'opération, la policy décide du rôle et du périmètre
-- (§170). Sans ce grant, les policies d'écriture organisation écrites plus
-- bas seraient inapplicables.
do $$
declare t text;
begin
  foreach t in array array[
    'events', 'editions', 'races', 'event_partners',
    'race_start_waves', 'race_waypoints', 'race_segments', 'race_cutoffs',
    'race_assistance_rules', 'race_equipment_requirements', 'race_aid_station_items',
    'race_course_geometries', 'race_notices'
  ] loop
    execute format('grant insert, update, delete on public.%I to authenticated', t);
  end loop;

  -- §24 : une version de fact publiée est immuable. On accorde la création,
  -- jamais la modification ni la suppression.
  foreach t in array array[
    'race_facts', 'race_fact_versions', 'fact_sources', 'source_race_scopes'
  ] loop
    execute format('grant insert on public.%I to authenticated', t);
  end loop;

  foreach t in array array[
    'participant_imports', 'participant_import_rows',
    'enrichment_imports', 'enrichment_import_rows'
  ] loop
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end
$$;

-- `sources` reçoit ses verbes d'écriture ici mais pas son SELECT : un grant de
-- table couvre toutes les colonnes et écraserait la projection restreinte
-- accordée plus bas, rouvrant `storage_path` à tout utilisateur authentifié
-- (§20). La lecture reste donc colonne par colonne.
grant insert, update on public.sources to authenticated;

-- §67, §68 : l'organisation lit des agrégats, elle ne les fabrique pas.
do $$
declare t text;
begin
  foreach t in array array[
    'race_intelligence_runs', 'race_intelligence_wave_summaries',
    'race_intelligence_waypoint_flows', 'race_intelligence_cutoff_summaries',
    'race_intelligence_weather_exposures', 'question_insight_snapshots',
    'organization_adoption_snapshots', 'organizer_briefs'
  ] loop
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end
$$;

-- 02.5 Grants de colonnes
-- §12, §179 : la RLS filtre des lignes, pas des colonnes. `platform_role` et
-- `email` sortent donc de la liste des colonnes modifiables.
grant select on public.users to authenticated;
grant update (first_name, last_name, avatar_url, locale, timezone)
  on public.users to authenticated;

-- §15 : lecture seule. Aucun verbe d'écriture n'est accordé — voir la note
-- devant les policies de cette table.
grant select on public.organization_members to authenticated;

-- §14 : la partie publique d'une organisation est son identité, pas sa fiche
-- opérationnelle. `contact_email` n'est accordé à aucun rôle client ; le
-- workflow qui en a besoin passe par le serveur.
grant select (id, name, slug, logo_url, website_url, status, created_at, updated_at)
  on public.organizations to anon, authenticated;

-- §27, §28 : pas de `select *` pour le back-office. L'email participant
-- n'est pas distribué à tous les écrans B2B ; il reste au workflow
-- d'invitation, côté serveur.
grant select (
  id, race_id, user_id, first_name_snapshot, last_name_snapshot,
  registration_source, external_registration_id, bib_number, start_wave_id,
  personal_start_datetime, status, preparation_state, joined_at,
  created_at, updated_at
) on public.participant_races to authenticated;

-- §20, §21 : le chemin de stockage et la métadonnée technique ne sortent
-- pas ; les fichiers passent par des URLs signées produites côté serveur.
grant select (
  id, edition_id, organization_id, source_type, title, url,
  declared_published_at, imported_at, status, current_snapshot_id,
  created_at, updated_at
) on public.sources to anon, authenticated;

grant select (id, source_id, version_number, content_hash, retrieved_at)
  on public.source_snapshots to authenticated;

-- ============================================================
-- 03. Protection de colonnes
-- ============================================================
-- §12 : « RLS seule ne contrôle pas facilement les colonnes. » Le grant
-- ci-dessus empêche déjà l'UPDATE de `platform_role`, mais un grant se
-- modifie et une future migration pourrait l'élargir par inadvertance. Le
-- trigger rend l'invariant indépendant de la configuration des privilèges.

create or replace function private.protect_user_columns()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Le garde-fou vise les sessions client. Un traitement serveur légitime —
  -- support, migration, worker — agit sans session utilisateur : `auth.uid()`
  -- y est nul, et il reste responsable de ses propres vérifications (§8).
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.platform_role is distinct from old.platform_role then
    raise exception 'platform_role est administré côté serveur'
      using errcode = '42501';
  end if;

  if new.email is distinct from old.email then
    raise exception 'email est administré par Supabase Auth'
      using errcode = '42501';
  end if;

  if new.id is distinct from old.id then
    raise exception 'id est immuable' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger users_protect_columns
  before update on public.users
  for each row execute function private.protect_user_columns();

-- ============================================================
-- 04. Identité
-- ============================================================
-- §12, §161 : un utilisateur lit sa ligne. L'organisation n'utilise jamais
-- `public.users` comme annuaire de participants.

create policy users__select__self on public.users
  for select to authenticated using (id = (select auth.uid()));

create policy users__select__pluka_admin on public.users
  for select to authenticated using (private.is_pluka_admin());

create policy users__update__self on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

comment on policy users__select__self on public.users is
  'Un autre participant ne lit pas ce profil, et une organisation ne s''en sert pas comme annuaire (§12).';

-- §13 : le profil trailer n'est pas exposé à l'organisation, même si Race
-- Intelligence existe par ailleurs.
create policy trail_profiles__select__owner on public.trail_profiles
  for select to authenticated using (user_id = (select auth.uid()));

create policy trail_profiles__insert__owner on public.trail_profiles
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy trail_profiles__update__owner on public.trail_profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy trail_profiles__delete__owner on public.trail_profiles
  for delete to authenticated using (user_id = (select auth.uid()));

-- ============================================================
-- 05. Organisations
-- ============================================================

create policy organizations__select__active on public.organizations
  for select to anon, authenticated using (status = 'active');

create policy organizations__select__member on public.organizations
  for select to authenticated using (private.user_is_org_member(id));

-- §15 : un membre lit son propre membership. Voir la liste complète des
-- membres relève de la gestion, donc du rôle admin.
create policy organization_members__select__self on public.organization_members
  for select to authenticated using (user_id = (select auth.uid()));

create policy organization_members__select__org_admin on public.organization_members
  for select to authenticated using (private.user_has_org_role(organization_id, 'admin'));

comment on policy organization_members__select__self on public.organization_members is
  'Un viewer n''a pas besoin de voir tous les membres et leurs emails (§15).';

-- §15 : aucune policy d'écriture. Empêcher un admin de supprimer le dernier
-- owner, ou un membre de s''auto-promouvoir, demande une logique que la RLS
-- n''exprime pas ; les mutations de membres passent par un use case serveur.

-- ============================================================
-- 06. Événements, éditions, courses
-- ============================================================
-- §16 : lecture publique des objets publiés, gestion réservée à
-- l'organisation gestionnaire selon le rôle.

create policy events__select__published on public.events
  for select to anon, authenticated using (status = 'published');

create policy events__select__org_member on public.events
  for select to authenticated using (private.user_is_org_member(organization_id));

create policy events__select__pluka_admin on public.events
  for select to authenticated using (private.is_pluka_admin());

create policy events__insert__org_editor on public.events
  for insert to authenticated
  with check (private.user_has_org_role(organization_id, 'editor'));

create policy events__update__org_editor on public.events
  for update to authenticated
  using (private.user_has_org_role(organization_id, 'editor'))
  with check (private.user_has_org_role(organization_id, 'editor'));

create policy events__delete__org_admin on public.events
  for delete to authenticated
  using (private.user_has_org_role(organization_id, 'admin'));

create policy editions__select__published on public.editions
  for select to anon, authenticated
  using (
    status in ('published', 'completed')
    and exists (select 1 from public.events e where e.id = event_id and e.status = 'published')
  );

create policy editions__select__org_member on public.editions
  for select to authenticated
  using (private.user_is_org_member(private.organization_of_edition(id)));

create policy editions__select__pluka_admin on public.editions
  for select to authenticated using (private.is_pluka_admin());

create policy editions__insert__org_editor on public.editions
  for insert to authenticated
  with check (private.user_can_manage_event(event_id, 'editor'));

create policy editions__update__org_editor on public.editions
  for update to authenticated
  using (private.user_can_manage_event(event_id, 'editor'))
  with check (private.user_can_manage_event(event_id, 'editor'));

create policy editions__delete__org_admin on public.editions
  for delete to authenticated
  using (private.user_can_manage_event(event_id, 'admin'));

-- §17 : seule une Race `public` est listable. `unlisted` et `private`
-- restent accessibles au participant inscrit, à l'organisation et aux
-- parcours serveur (lien direct, invitation), jamais à une requête générique
-- anonyme.
create policy races__select__public on public.races
  for select to anon, authenticated using (private.race_is_publicly_readable(id));

create policy races__select__participant on public.races
  for select to authenticated using (private.user_participates_in_race(id));

create policy races__select__org_member on public.races
  for select to authenticated
  using (private.user_is_org_member(private.organization_of_race(id)));

create policy races__select__pluka_admin on public.races
  for select to authenticated using (private.is_pluka_admin());

create policy races__insert__org_editor on public.races
  for insert to authenticated
  with check (private.user_can_manage_edition(edition_id, 'editor'));

create policy races__update__org_editor on public.races
  for update to authenticated
  using (private.user_can_manage_race(id, 'editor'))
  with check (private.user_can_manage_race(id, 'editor'));

create policy races__delete__org_admin on public.races
  for delete to authenticated
  using (private.user_can_manage_race(id, 'admin'));

comment on policy races__select__public on public.races is
  'Une Race unlisted ou private ne devient pas listable par la connaissance de son UUID (§17).';

-- ============================================================
-- 07. Référentiel de course
-- ============================================================
-- §18 : la lecture remonte toujours jusqu'à `races`. Les tables ci-dessous
-- partagent exactement la même règle ; la générer évite qu'une d'entre elles
-- reçoive par distraction une condition plus permissive.

do $do$
declare t text;
begin
  foreach t in array array[
    'race_start_waves', 'race_waypoints', 'race_segments', 'race_cutoffs',
    'race_assistance_rules', 'race_equipment_requirements',
    'race_change_events', 'race_course_geometries'
  ] loop
    execute format(
      'create policy %1$s__select__race_readable on public.%1$I
         for select to anon, authenticated
         using (private.user_can_read_race(race_id))', t);

    execute format(
      'create policy %1$s__insert__org_editor on public.%1$I
         for insert to authenticated
         with check (private.user_can_manage_race(race_id, ''editor''))', t);

    execute format(
      'create policy %1$s__update__org_editor on public.%1$I
         for update to authenticated
         using (private.user_can_manage_race(race_id, ''editor''))
         with check (private.user_can_manage_race(race_id, ''editor''))', t);

    execute format(
      'create policy %1$s__delete__org_admin on public.%1$I
         for delete to authenticated
         using (private.user_can_manage_race(race_id, ''admin''))', t);
  end loop;
end
$do$;

-- §42 : le contenu d'un ravitaillement est officiel, pas une stratégie
-- personnelle. Il suit la visibilité de la Race, à travers son waypoint.
create policy race_aid_station_items__select__race_readable on public.race_aid_station_items
  for select to anon, authenticated
  using (private.user_can_read_race(private.race_of_waypoint(race_waypoint_id)));

create policy race_aid_station_items__insert__org_editor on public.race_aid_station_items
  for insert to authenticated
  with check (private.user_can_manage_race(private.race_of_waypoint(race_waypoint_id), 'editor'));

create policy race_aid_station_items__update__org_editor on public.race_aid_station_items
  for update to authenticated
  using (private.user_can_manage_race(private.race_of_waypoint(race_waypoint_id), 'editor'))
  with check (private.user_can_manage_race(private.race_of_waypoint(race_waypoint_id), 'editor'));

create policy race_aid_station_items__delete__org_admin on public.race_aid_station_items
  for delete to authenticated
  using (private.user_can_manage_race(private.race_of_waypoint(race_waypoint_id), 'admin'));

create policy event_partners__select__edition_readable on public.event_partners
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.editions ed
      join public.events e on e.id = ed.event_id
      where ed.id = edition_id
        and ed.status in ('published', 'completed')
        and e.status = 'published'
    )
    or private.user_is_org_member(private.organization_of_edition(edition_id))
  );

create policy event_partners__insert__org_editor on public.event_partners
  for insert to authenticated
  with check (private.user_can_manage_edition(edition_id, 'editor'));

create policy event_partners__update__org_editor on public.event_partners
  for update to authenticated
  using (private.user_can_manage_edition(edition_id, 'editor'))
  with check (private.user_can_manage_edition(edition_id, 'editor'));

create policy event_partners__delete__org_admin on public.event_partners
  for delete to authenticated
  using (private.user_can_manage_edition(edition_id, 'admin'));

-- §52 : une notice officielle est lisible en Free comme en premium, selon la
-- visibilité de la Race. Elle ne dépend d'aucun run météo personnel.
create policy race_notices__select__race_readable on public.race_notices
  for select to anon, authenticated
  using (archived_at is null and private.user_can_read_race(race_id));

create policy race_notices__select__org_member on public.race_notices
  for select to authenticated
  using (private.user_is_org_member(private.organization_of_race(race_id)));

create policy race_notices__insert__org_editor on public.race_notices
  for insert to authenticated
  with check (private.user_can_manage_race(race_id, 'editor'));

create policy race_notices__update__org_editor on public.race_notices
  for update to authenticated
  using (private.user_can_manage_race(race_id, 'editor'))
  with check (private.user_can_manage_race(race_id, 'editor'));

create policy race_notices__delete__org_admin on public.race_notices
  for delete to authenticated
  using (private.user_can_manage_race(race_id, 'admin'));

comment on policy race_notices__select__race_readable on public.race_notices is
  'Information officielle : jamais paywallée (§52). L''organisation voit aussi ses notices archivées via sa propre policy.';

-- Catalogues transverses : lisibles, administrés côté serveur.
create policy equipment_items__select__all on public.equipment_items
  for select to anon, authenticated using (true);

-- §41 : le catalogue canonique validé est lisible ; la sélection personnelle
-- d'un participant ne l'est jamais.
create policy nutrition_products__select__validated on public.nutrition_products
  for select to anon, authenticated using (status = 'validated');

-- ============================================================
-- 08. Sources et facts
-- ============================================================

create policy sources__select__edition_readable on public.sources
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.editions ed
      join public.events e on e.id = ed.event_id
      where ed.id = edition_id
        and ed.status in ('published', 'completed')
        and e.status = 'published'
    )
    or private.user_is_org_member(private.organization_of_edition(edition_id))
  );

create policy sources__insert__org_editor on public.sources
  for insert to authenticated
  with check (private.user_can_manage_edition(edition_id, 'editor'));

create policy sources__update__org_editor on public.sources
  for update to authenticated
  using (private.user_can_manage_edition(edition_id, 'editor'))
  with check (private.user_can_manage_edition(edition_id, 'editor'));

create policy source_race_scopes__select__race_readable on public.source_race_scopes
  for select to anon, authenticated using (private.user_can_read_race(race_id));

create policy source_race_scopes__insert__org_editor on public.source_race_scopes
  for insert to authenticated
  with check (private.user_can_manage_race(race_id, 'editor'));

-- §21 : le contenu brut d'un snapshot peut être soumis au copyright. Il
-- n'est pas ouvert à `anon`, et le fichier lui-même passe par une URL signée.
create policy source_snapshots__select__org_member on public.source_snapshots
  for select to authenticated
  using (
    exists (
      select 1 from public.sources s
      where s.id = source_id
        and private.user_is_org_member(private.organization_of_edition(s.edition_id))
    )
  );

-- §22 : un fact publié suit la Race ; les états de travail restent à
-- l'organisation.
create policy race_facts__select__race_readable on public.race_facts
  for select to anon, authenticated
  using (archived_at is null and private.user_can_read_race(race_id));

create policy race_facts__insert__org_editor on public.race_facts
  for insert to authenticated
  with check (private.user_can_manage_race(race_id, 'editor'));

create policy race_fact_versions__select__published on public.race_fact_versions
  for select to anon, authenticated
  using (
    workflow_status = 'published'
    and exists (
      select 1 from public.race_facts f
      where f.id = fact_id and private.user_can_read_race(f.race_id)
    )
  );

create policy race_fact_versions__select__org_member on public.race_fact_versions
  for select to authenticated
  using (private.user_can_manage_race_fact(fact_id, 'viewer'));

create policy race_fact_versions__insert__org_editor on public.race_fact_versions
  for insert to authenticated
  with check (private.user_can_manage_race_fact(fact_id, 'editor'));

comment on policy race_fact_versions__select__published on public.race_fact_versions is
  'Les états draft, validated non publié, rejected et superseded restent internes (§22). Aucune policy d''update ni de delete : une version publiée est immuable (§24).';

create policy fact_sources__select__scope on public.fact_sources
  for select to anon, authenticated
  using (
    exists (
      select 1
      from public.race_fact_versions v
      join public.race_facts f on f.id = v.fact_id
      where v.id = fact_version_id
        and v.workflow_status = 'published'
        and private.user_can_read_race(f.race_id)
    )
  );

create policy fact_sources__select__org_member on public.fact_sources
  for select to authenticated
  using (
    exists (
      select 1 from public.race_fact_versions v
      where v.id = fact_version_id and private.user_can_manage_race_fact(v.fact_id, 'viewer')
    )
  );

create policy fact_sources__insert__org_editor on public.fact_sources
  for insert to authenticated
  with check (
    exists (
      select 1 from public.race_fact_versions v
      where v.id = fact_version_id and private.user_can_manage_race_fact(v.fact_id, 'editor')
    )
  );

-- ============================================================
-- 09. Participation
-- ============================================================
-- §26 : le coureur lit sa participation. L'organisation garde un accès
-- opérationnel — inscrits, dossard, vague, activation — et rien de plus : les
-- colonnes accordées plus haut excluent déjà l'email, et aucune table de
-- préparation ne lui est ouverte.

create policy participant_races__select__owner on public.participant_races
  for select to authenticated using (user_id = (select auth.uid()));

create policy participant_races__select__org_member on public.participant_races
  for select to authenticated
  using (private.user_is_org_member(private.organization_of_race(race_id)));

comment on policy participant_races__select__org_member on public.participant_races is
  'Accès opérationnel uniquement. Ce droit ne donne ni Plan, ni Nutrition, ni Assistance, ni sortie : ces tables n''ont aucune policy organisation (§26).';

-- §29 : les préférences de préparation ne sont pas des données
-- opérationnelles d'organisation.
create policy participant_race_settings__select__owner on public.participant_race_settings
  for select to authenticated using (private.user_owns_participant_race(participant_race_id));

create policy participant_race_settings__insert__owner on public.participant_race_settings
  for insert to authenticated with check (private.user_owns_participant_race(participant_race_id));

create policy participant_race_settings__update__owner on public.participant_race_settings
  for update to authenticated
  using (private.user_owns_participant_race(participant_race_id))
  with check (private.user_owns_participant_race(participant_race_id));

create policy participant_race_settings__delete__owner on public.participant_race_settings
  for delete to authenticated using (private.user_owns_participant_race(participant_race_id));

-- §30 : un utilisateur lit ses droits, il ne s'en crée pas.
create policy entitlements__select__owner on public.entitlements
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (participant_race_id is not null and private.user_owns_participant_race(participant_race_id))
  );

create policy entitlement_usage__select__owner on public.entitlement_usage
  for select to authenticated using (user_id = (select auth.uid()));

create policy purchases__select__owner on public.purchases
  for select to authenticated using (user_id = (select auth.uid()));

create policy beta_access_grants__select__owner on public.beta_access_grants
  for select to authenticated using (user_id = (select auth.uid()));

-- ============================================================
-- 10. Plan de course — aucune policy organisation
-- ============================================================
-- §31 : « Organisation : aucun accès direct. » Même si la participation a été
-- financée par l'organisation (§102, §103).
-- §33 : les écritures passent par le serveur ; seule la lecture est ouverte.

create policy race_plans__select__owner on public.race_plans
  for select to authenticated using (private.user_owns_participant_race(participant_race_id));

do $do$
declare t text;
begin
  foreach t in array array['plan_waypoints', 'plan_segments', 'plan_cutoff_statuses'] loop
    execute format(
      'create policy %1$s__select__owner on public.%1$I
         for select to authenticated
         using (private.user_owns_race_plan(race_plan_id))', t);
  end loop;
end
$do$;

-- §34 : lecture possible pour diagnostic, écriture serveur uniquement.
create policy plan_version_dependencies__select__owner on public.plan_version_dependencies
  for select to authenticated using (private.user_owns_race_plan(race_plan_id));

-- §35 : le participant lit ses propres impacts. Le back-office ne doit pas
-- afficher « untel a revérifié son Plan ».
create policy participant_change_impacts__select__owner on public.participant_change_impacts
  for select to authenticated using (private.user_owns_participant_race(participant_race_id));

-- ============================================================
-- 11. Préparation privée — aucune policy organisation
-- ============================================================
-- §36 : les TODO restent privés, y compris ceux nés d'un changement officiel.
-- §37 : l'organisation connaît ses exigences de matériel, pas ce que le
-- coureur a coché. §38 : sacs et contenus sont privés.

do $do$
declare t text;
begin
  foreach t in array array['tasks', 'participant_equipment', 'bags'] loop
    execute format(
      'create policy %1$s__select__owner on public.%1$I
         for select to authenticated
         using (private.user_owns_participant_race(participant_race_id))', t);

    execute format(
      'create policy %1$s__insert__owner on public.%1$I
         for insert to authenticated
         with check (private.user_owns_participant_race(participant_race_id))', t);

    execute format(
      'create policy %1$s__update__owner on public.%1$I
         for update to authenticated
         using (private.user_owns_participant_race(participant_race_id))
         with check (private.user_owns_participant_race(participant_race_id))', t);

    execute format(
      'create policy %1$s__delete__owner on public.%1$I
         for delete to authenticated
         using (private.user_owns_participant_race(participant_race_id))', t);
  end loop;
end
$do$;

create policy bag_items__select__owner on public.bag_items
  for select to authenticated using (private.user_owns_bag(bag_id));

create policy bag_items__insert__owner on public.bag_items
  for insert to authenticated with check (private.user_owns_bag(bag_id));

create policy bag_items__update__owner on public.bag_items
  for update to authenticated
  using (private.user_owns_bag(bag_id))
  with check (private.user_owns_bag(bag_id));

create policy bag_items__delete__owner on public.bag_items
  for delete to authenticated using (private.user_owns_bag(bag_id));

-- Bibliothèque personnelle réutilisable.
-- Elle n'apparaît dans aucune matrice de `03_PRIVACY_RLS`, ce qui en fait
-- précisément le piège : sans policy, elle serait muette ; avec une policy
-- trop large, elle exposerait des `payload` de stratégie Nutrition, de sacs
-- et de check-lists de préparation. C'est de la préparation privée, donc
-- propriétaire strict et aucun accès organisation (§37, §38, §40).
create policy library_templates__select__owner on public.library_templates
  for select to authenticated using (user_id = (select auth.uid()));

create policy library_templates__insert__owner on public.library_templates
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy library_templates__update__owner on public.library_templates
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy library_templates__delete__owner on public.library_templates
  for delete to authenticated using (user_id = (select auth.uid()));

comment on policy library_templates__select__owner on public.library_templates is
  'Un template porte une stratégie Nutrition, un sac ou une check-list : préparation privée, jamais visible d''une organisation (§37, §38, §40).';

-- ============================================================
-- 12. Nutrition — aucune policy organisation
-- ============================================================
-- §40 : propriétaire uniquement. §33 : les recalculs passent par le moteur
-- serveur, donc lecture seule côté client.

create policy user_nutrition_products__select__owner on public.user_nutrition_products
  for select to authenticated using (user_id = (select auth.uid()));

create policy user_nutrition_products__insert__owner on public.user_nutrition_products
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy user_nutrition_products__update__owner on public.user_nutrition_products
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy user_nutrition_products__delete__owner on public.user_nutrition_products
  for delete to authenticated using (user_id = (select auth.uid()));

create policy nutrition_plans__select__owner on public.nutrition_plans
  for select to authenticated using (private.user_owns_nutrition_plan(id));

create policy nutrition_conditions__select__owner on public.nutrition_conditions
  for select to authenticated using (private.user_owns_nutrition_plan(nutrition_plan_id));

create policy nutrition_condition_ranges__select__owner on public.nutrition_condition_ranges
  for select to authenticated
  using (
    exists (
      select 1 from public.nutrition_conditions nc
      where nc.id = nutrition_condition_id
        and private.user_owns_nutrition_plan(nc.nutrition_plan_id)
    )
  );

create policy nutrition_waypoints__select__owner on public.nutrition_waypoints
  for select to authenticated using (private.user_owns_nutrition_plan(nutrition_plan_id));

create policy nutrition_waypoint_items__select__owner on public.nutrition_waypoint_items
  for select to authenticated
  using (
    exists (
      select 1 from public.nutrition_waypoints nw
      where nw.id = nutrition_waypoint_id
        and private.user_owns_nutrition_plan(nw.nutrition_plan_id)
    )
  );

create policy nutrition_recalculations__select__owner on public.nutrition_recalculations
  for select to authenticated using (private.user_owns_nutrition_plan(nutrition_plan_id));

-- ============================================================
-- 13. Assistance — aucune policy organisation
-- ============================================================
-- §43 : propriétaire côté application, organisation aucun accès.
-- §45 : `assistant_access_tokens` n'est jamais interrogé par le navigateur ;
-- le flow passe par un endpoint serveur qui hache le jeton reçu. La table
-- n'a donc aucun grant et aucune policy.

create policy race_assistants__select__owner on public.race_assistants
  for select to authenticated using (private.user_owns_participant_race(participant_race_id));

create policy race_assistants__insert__owner on public.race_assistants
  for insert to authenticated with check (private.user_owns_participant_race(participant_race_id));

create policy race_assistants__update__owner on public.race_assistants
  for update to authenticated
  using (private.user_owns_participant_race(participant_race_id))
  with check (private.user_owns_participant_race(participant_race_id));

create policy race_assistants__delete__owner on public.race_assistants
  for delete to authenticated using (private.user_owns_participant_race(participant_race_id));

create policy assistance_assignments__select__owner on public.assistance_assignments
  for select to authenticated using (private.user_owns_assistant(assistant_id));

create policy assistance_assignments__insert__owner on public.assistance_assignments
  for insert to authenticated with check (private.user_owns_assistant(assistant_id));

create policy assistance_assignments__update__owner on public.assistance_assignments
  for update to authenticated
  using (private.user_owns_assistant(assistant_id))
  with check (private.user_owns_assistant(assistant_id));

create policy assistance_assignments__delete__owner on public.assistance_assignments
  for delete to authenticated using (private.user_owns_assistant(assistant_id));

create policy assistance_items__select__owner on public.assistance_items
  for select to authenticated
  using (
    exists (
      select 1 from public.assistance_assignments aa
      where aa.id = assistance_assignment_id and private.user_owns_assistant(aa.assistant_id)
    )
  );

create policy assistance_items__insert__owner on public.assistance_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.assistance_assignments aa
      where aa.id = assistance_assignment_id and private.user_owns_assistant(aa.assistant_id)
    )
  );

create policy assistance_items__update__owner on public.assistance_items
  for update to authenticated
  using (
    exists (
      select 1 from public.assistance_assignments aa
      where aa.id = assistance_assignment_id and private.user_owns_assistant(aa.assistant_id)
    )
  )
  with check (
    exists (
      select 1 from public.assistance_assignments aa
      where aa.id = assistance_assignment_id and private.user_owns_assistant(aa.assistant_id)
    )
  );

create policy assistance_items__delete__owner on public.assistance_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.assistance_assignments aa
      where aa.id = assistance_assignment_id and private.user_owns_assistant(aa.assistant_id)
    )
  );

-- §48 : le contact d'urgence est strictement séparé de l'Assistance. Aucun
-- accès organisation automatique en V1.
create policy emergency_contacts__select__owner on public.emergency_contacts
  for select to authenticated using (private.user_owns_participant_race(participant_race_id));

create policy emergency_contacts__insert__owner on public.emergency_contacts
  for insert to authenticated with check (private.user_owns_participant_race(participant_race_id));

create policy emergency_contacts__update__owner on public.emergency_contacts
  for update to authenticated
  using (private.user_owns_participant_race(participant_race_id))
  with check (private.user_owns_participant_race(participant_race_id));

create policy emergency_contacts__delete__owner on public.emergency_contacts
  for delete to authenticated using (private.user_owns_participant_race(participant_race_id));

-- ============================================================
-- 14. Sorties personnelles — aucune policy organisation
-- ============================================================
-- §39 : « Même si une Outing est liée à une Race organisée, l'organisation
-- n'obtient aucun accès à la sortie personnelle. »

create policy outings__select__owner on public.outings
  for select to authenticated using (user_id = (select auth.uid()));

create policy outings__insert__owner on public.outings
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy outings__update__owner on public.outings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy outings__delete__owner on public.outings
  for delete to authenticated using (user_id = (select auth.uid()));

do $do$
declare t text;
begin
  foreach t in array array['outing_waypoints', 'outing_equipment', 'outing_feedback'] loop
    execute format(
      'create policy %1$s__select__owner on public.%1$I
         for select to authenticated
         using (private.user_owns_outing(outing_id))', t);

    execute format(
      'create policy %1$s__insert__owner on public.%1$I
         for insert to authenticated
         with check (private.user_owns_outing(outing_id))', t);

    execute format(
      'create policy %1$s__update__owner on public.%1$I
         for update to authenticated
         using (private.user_owns_outing(outing_id))
         with check (private.user_owns_outing(outing_id))', t);

    execute format(
      'create policy %1$s__delete__owner on public.%1$I
         for delete to authenticated
         using (private.user_owns_outing(outing_id))', t);
  end loop;
end
$do$;

-- ============================================================
-- 15. Météo et Conditions personnelles — aucune policy organisation
-- ============================================================
-- §49, §50 : ces objets appartiennent au scope personnel. §51 : une
-- organisation ne voit pas si le coureur a accepté une suggestion froid.

create policy weather_forecast_runs__select__owner on public.weather_forecast_runs
  for select to authenticated using (private.user_owns_weather_run(id));

create policy weather_forecast_points__select__owner on public.weather_forecast_points
  for select to authenticated using (private.user_owns_weather_run(weather_run_id));

create policy condition_periods__select__owner on public.condition_periods
  for select to authenticated using (private.user_owns_weather_run(weather_run_id));

create policy condition_proposals__select__owner on public.condition_proposals
  for select to authenticated using (user_id = (select auth.uid()));

create policy condition_proposals__update__owner on public.condition_proposals
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ============================================================
-- 16. Q&A — aucune policy organisation
-- ============================================================
-- §63 : conversations personnelles, propriétaire seulement. §64 :
-- l'organisation ne reconstruit pas les questions individuelles ; les
-- Insights passent par un pipeline agrégé séparé.

create policy pluka_conversations__select__owner on public.pluka_conversations
  for select to authenticated using (user_id = (select auth.uid()));

create policy pluka_conversations__insert__owner on public.pluka_conversations
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy pluka_conversations__update__owner on public.pluka_conversations
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy pluka_conversations__delete__owner on public.pluka_conversations
  for delete to authenticated using (user_id = (select auth.uid()));

create policy pluka_messages__select__owner on public.pluka_messages
  for select to authenticated using (private.user_owns_conversation(conversation_id));

create policy pluka_answer_sources__select__owner on public.pluka_answer_sources
  for select to authenticated
  using (
    exists (
      select 1 from public.pluka_messages m
      where m.id = message_id and private.user_owns_conversation(m.conversation_id)
    )
  );

-- ============================================================
-- 17. Après-course — aucune policy organisation
-- ============================================================
-- §56 : le retour brut est privé. §57 : publier ne rend public que le
-- snapshot de publication, jamais les notes privées.

create policy post_race_reviews__select__owner on public.post_race_reviews
  for select to authenticated using (private.user_owns_participant_race(participant_race_id));

create policy post_race_reviews__insert__owner on public.post_race_reviews
  for insert to authenticated with check (private.user_owns_participant_race(participant_race_id));

create policy post_race_reviews__update__owner on public.post_race_reviews
  for update to authenticated
  using (private.user_owns_participant_race(participant_race_id))
  with check (private.user_owns_participant_race(participant_race_id));

create policy post_race_reviews__delete__owner on public.post_race_reviews
  for delete to authenticated using (private.user_owns_participant_race(participant_race_id));

create policy post_race_review_publications__select__owner on public.post_race_review_publications
  for select to authenticated using (private.user_owns_post_race_review(review_id));

create policy post_race_review_publications__select__published on public.post_race_review_publications
  for select to authenticated
  using (
    is_published
    and community_thread_id is not null
    and private.user_can_read_community_thread(community_thread_id)
  );

create policy post_race_review_publications__insert__owner on public.post_race_review_publications
  for insert to authenticated with check (private.user_owns_post_race_review(review_id));

create policy post_race_review_publications__update__owner on public.post_race_review_publications
  for update to authenticated
  using (private.user_owns_post_race_review(review_id))
  with check (private.user_owns_post_race_review(review_id));

create policy post_race_review_publications__delete__owner on public.post_race_review_publications
  for delete to authenticated using (private.user_owns_post_race_review(review_id));

comment on policy post_race_review_publications__select__published on public.post_race_review_publications is
  'Seul le snapshot publié devient visible. Le retour brut reste privé (§57).';

-- ============================================================
-- 18. Communauté
-- ============================================================
-- §53 : lecture réservée aux participants autorisés de la Race, aux
-- modérateurs et à l'admin. Pas de communauté publique globale.

create policy community_threads__select__scope on public.community_threads
  for select to authenticated
  using (status = 'published' and private.user_can_read_community_thread(id));

create policy community_threads__select__author on public.community_threads
  for select to authenticated using (author_user_id = (select auth.uid()));

create policy community_threads__insert__participant on public.community_threads
  for insert to authenticated
  with check (
    author_user_id = (select auth.uid())
    and (race_id is null or private.user_can_read_race(race_id))
  );

create policy community_threads__update__author on public.community_threads
  for update to authenticated
  using (author_user_id = (select auth.uid()))
  with check (author_user_id = (select auth.uid()));

create policy community_threads__update__moderator on public.community_threads
  for update to authenticated
  using (private.user_can_moderate_community_thread(id))
  with check (private.user_can_moderate_community_thread(id));

create policy community_posts__select__scope on public.community_posts
  for select to authenticated
  using (status = 'published' and private.user_can_read_community_thread(thread_id));

create policy community_posts__select__author on public.community_posts
  for select to authenticated using (author_user_id = (select auth.uid()));

create policy community_posts__insert__participant on public.community_posts
  for insert to authenticated
  with check (
    author_user_id = (select auth.uid())
    and private.user_can_read_community_thread(thread_id)
  );

create policy community_posts__update__author on public.community_posts
  for update to authenticated
  using (author_user_id = (select auth.uid()))
  with check (author_user_id = (select auth.uid()));

create policy community_posts__update__moderator on public.community_posts
  for update to authenticated
  using (private.user_can_moderate_community_thread(thread_id))
  with check (private.user_can_moderate_community_thread(thread_id));

create policy community_reactions__select__owner on public.community_reactions
  for select to authenticated using (user_id = (select auth.uid()));

create policy community_reactions__insert__owner on public.community_reactions
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy community_reactions__delete__owner on public.community_reactions
  for delete to authenticated using (user_id = (select auth.uid()));

-- §55 : un signalement est visible du signaleur et des modérateurs.
create policy community_reports__select__reporter on public.community_reports
  for select to authenticated using (reporter_user_id = (select auth.uid()));

create policy community_reports__select__moderator on public.community_reports
  for select to authenticated
  using (
    (thread_id is not null and private.user_can_moderate_community_thread(thread_id))
    or (
      post_id is not null
      and exists (
        select 1 from public.community_posts p
        where p.id = post_id and private.user_can_moderate_community_thread(p.thread_id)
      )
    )
  );

create policy community_reports__insert__reporter on public.community_reports
  for insert to authenticated with check (reporter_user_id = (select auth.uid()));

-- ============================================================
-- 19. Imports et invitations organisation
-- ============================================================
-- §58 à §61 : organisation concernée uniquement. §59 : l'import de PII n'est
-- pas un droit `viewer` — le rôle minimum est `admin`.
-- §113 : le scope organisation prime sur `created_by_user_id`, sinon un
-- ancien membre garderait l'accès indéfiniment.

create policy participant_imports__select__org_admin on public.participant_imports
  for select to authenticated
  using (
    private.user_has_org_role(organization_id, 'admin')
    and private.user_can_manage_edition(edition_id, 'admin')
  );

create policy participant_imports__insert__org_admin on public.participant_imports
  for insert to authenticated
  with check (
    private.user_has_org_role(organization_id, 'admin')
    and private.user_can_manage_edition(edition_id, 'admin')
  );

create policy participant_imports__update__org_admin on public.participant_imports
  for update to authenticated
  using (private.user_has_org_role(organization_id, 'admin'))
  with check (private.user_has_org_role(organization_id, 'admin'));

comment on policy participant_imports__select__org_admin on public.participant_imports is
  'Le scope organisation prime sur le créateur : un ancien membre perd l''accès (§113, §114).';

create policy participant_import_rows__select__org_admin on public.participant_import_rows
  for select to authenticated
  using (
    exists (
      select 1 from public.participant_imports i
      where i.id = import_id and private.user_has_org_role(i.organization_id, 'admin')
    )
  );

create policy participant_import_rows__insert__org_admin on public.participant_import_rows
  for insert to authenticated
  with check (
    exists (
      select 1 from public.participant_imports i
      where i.id = import_id and private.user_has_org_role(i.organization_id, 'admin')
    )
  );

create policy participant_import_rows__update__org_admin on public.participant_import_rows
  for update to authenticated
  using (
    exists (
      select 1 from public.participant_imports i
      where i.id = import_id and private.user_has_org_role(i.organization_id, 'admin')
    )
  )
  with check (
    exists (
      select 1 from public.participant_imports i
      where i.id = import_id and private.user_has_org_role(i.organization_id, 'admin')
    )
  );

create policy enrichment_imports__select__org_admin on public.enrichment_imports
  for select to authenticated
  using (
    private.user_has_org_role(organization_id, 'admin')
    and private.user_can_manage_race(race_id, 'admin')
  );

create policy enrichment_imports__insert__org_admin on public.enrichment_imports
  for insert to authenticated
  with check (
    private.user_has_org_role(organization_id, 'admin')
    and private.user_can_manage_race(race_id, 'admin')
  );

create policy enrichment_imports__update__org_admin on public.enrichment_imports
  for update to authenticated
  using (private.user_has_org_role(organization_id, 'admin'))
  with check (private.user_has_org_role(organization_id, 'admin'));

create policy enrichment_import_rows__select__org_admin on public.enrichment_import_rows
  for select to authenticated
  using (
    exists (
      select 1 from public.enrichment_imports i
      where i.id = enrichment_import_id and private.user_has_org_role(i.organization_id, 'admin')
    )
  );

create policy enrichment_import_rows__insert__org_admin on public.enrichment_import_rows
  for insert to authenticated
  with check (
    exists (
      select 1 from public.enrichment_imports i
      where i.id = enrichment_import_id and private.user_has_org_role(i.organization_id, 'admin')
    )
  );

create policy enrichment_import_rows__update__org_admin on public.enrichment_import_rows
  for update to authenticated
  using (
    exists (
      select 1 from public.enrichment_imports i
      where i.id = enrichment_import_id and private.user_has_org_role(i.organization_id, 'admin')
    )
  )
  with check (
    exists (
      select 1 from public.enrichment_imports i
      where i.id = enrichment_import_id and private.user_has_org_role(i.organization_id, 'admin')
    )
  );

-- §115, §116 : le jeton d'invitation n'est jamais comparé côté client. Le
-- destinataire lit l'invitation qui le concerne une fois authentifié ;
-- l'organisation suit l'état de ses invitations.
create policy participant_invitations__select__invitee on public.participant_invitations
  for select to authenticated
  using (private.user_owns_participant_race(participant_race_id));

create policy participant_invitations__select__org_admin on public.participant_invitations
  for select to authenticated
  using (
    exists (
      select 1 from public.participant_races pr
      where pr.id = participant_race_id
        and private.user_can_manage_race(pr.race_id, 'admin')
    )
  );

comment on policy participant_invitations__select__invitee on public.participant_invitations is
  'Aucune policy ne compare un token_hash : la réclamation passe par un endpoint serveur (§115, §116).';

-- ============================================================
-- 20. Agrégats B2B
-- ============================================================
-- §68, §70 : agrégats safe uniquement. Les seuils de groupe minimum sont
-- portés par le schéma (`participant_count >= 10`) et par le pipeline ; la
-- RLS décide de la portée organisation, pas de la statistique.

create policy race_intelligence_runs__select__org_member on public.race_intelligence_runs
  for select to authenticated using (private.user_can_manage_race(race_id, 'viewer'));

do $do$
declare t text;
begin
  foreach t in array array[
    'race_intelligence_wave_summaries', 'race_intelligence_waypoint_flows',
    'race_intelligence_cutoff_summaries', 'race_intelligence_weather_exposures'
  ] loop
    execute format(
      'create policy %1$s__select__org_member on public.%1$I
         for select to authenticated
         using (
           exists (
             select 1 from public.race_intelligence_runs r
             where r.id = run_id and private.user_can_manage_race(r.race_id, ''viewer'')
           )
         )', t);
  end loop;
end
$do$;

create policy question_insight_snapshots__select__org_member on public.question_insight_snapshots
  for select to authenticated using (private.user_can_manage_race(race_id, 'viewer'));

create policy organization_adoption_snapshots__select__org_member
  on public.organization_adoption_snapshots
  for select to authenticated using (private.user_can_manage_race(race_id, 'viewer'));

-- §76, §77 : le Brief partagé passe par un endpoint serveur qui résout le
-- token. Aucune policy ne compare `share_token_hash`.
create policy organizer_briefs__select__org_member on public.organizer_briefs
  for select to authenticated
  using (private.user_is_org_member(private.organization_of_edition(edition_id)));

comment on policy organizer_briefs__select__org_member on public.organizer_briefs is
  'Le partage tokenisé est résolu côté serveur : aucune comparaison de hash dans une policy (§76, §78).';

-- ============================================================
-- 21. Index au service des policies
-- ============================================================
-- §175 : une policy qui filtre sur une colonne non indexée transforme chaque
-- lecture en parcours séquentiel.

create index if not exists ix_organization_members_user
  on public.organization_members (user_id, organization_id);
create index if not exists ix_participant_races_user_race
  on public.participant_races (user_id, race_id) where user_id is not null;
create index if not exists ix_race_plans_participant_race
  on public.race_plans (participant_race_id);
create index if not exists ix_outings_user
  on public.outings (user_id);
create index if not exists ix_weather_runs_race_plan
  on public.weather_forecast_runs (race_plan_id) where race_plan_id is not null;
create index if not exists ix_weather_runs_outing
  on public.weather_forecast_runs (outing_id) where outing_id is not null;
create index if not exists ix_library_templates_user
  on public.library_templates (user_id, template_type);
create index if not exists ix_pluka_conversations_user
  on public.pluka_conversations (user_id);
create index if not exists ix_community_posts_thread
  on public.community_posts (thread_id, created_at);

commit;
