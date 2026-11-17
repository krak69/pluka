-- ============================================================
-- 0098 — Assistance autorisée, point par point
-- ============================================================
--
-- AC-ASST-03 : un rendez-vous d'assistance ne se crée qu'à un point où les
-- règles de course l'autorisent. Jusqu'ici, seul le type `assistance` (« Base
-- de vie ») le laissait entendre, et `race_assistance_rules` n'est remplie
-- nulle part.
--
-- Décision produit du 2026-11-17 : comme le drop bag (0094), l'organisation
-- coche « Assistance » sur les points intermédiaires où elle l'autorise,
-- ravitaillements compris. Ni le départ ni l'arrivée : on y retrouve ses
-- proches sans que ce soit un rendez-vous d'assistance en course.
--
-- Les points déjà saisis comme « Base de vie » gardent l'assistance : c'est ce
-- qu'ils disaient.

alter table public.race_waypoints
  add column assistance_allowed boolean not null default false;

update public.race_waypoints
set assistance_allowed = true
where waypoint_type = 'assistance';

alter table public.race_waypoints
  add constraint race_waypoints_assistance_intermediate
  check (not assistance_allowed or waypoint_type not in ('start', 'finish'));

comment on column public.race_waypoints.assistance_allowed is
  'Vrai quand l''organisation autorise l''assistance à ce point (AC-ASST-03, décision du 2026-11-17). Jamais au départ ni à l''arrivée.';

-- ------------------------------------------------------------
-- Les sacs d'assistance suivent la même règle
-- ------------------------------------------------------------
-- 0095 rattachait un sac d'assistance aux points de type `assistance` ; il se
-- rattache désormais aux points où l'assistance est autorisée.

create or replace function private.check_bag_waypoint()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_waypoint record;
begin
  if new.bag_type in ('start', 'finish', 'other') then
    if new.race_waypoint_id is not null then
      raise exception 'ce sac ne se rattache à aucun point' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.race_waypoint_id is null then
    if tg_op = 'INSERT' then
      raise exception 'un drop bag ou un sac d''assistance se rattache à un point'
        using errcode = '23514';
    end if;
    return new;
  end if;

  select w.drop_bag_allowed, w.assistance_allowed into v_waypoint
  from public.race_waypoints w
  join public.participant_races pr on pr.race_id = w.race_id
  where w.id = new.race_waypoint_id and pr.id = new.participant_race_id;

  if not found then
    raise exception 'ce point n''appartient pas à la course de cette participation'
      using errcode = '23514';
  end if;

  if new.bag_type = 'drop_bag' and not v_waypoint.drop_bag_allowed then
    raise exception 'l''organisation n''accepte pas de drop bag à ce point'
      using errcode = '23514';
  end if;

  if new.bag_type = 'assistance' and not v_waypoint.assistance_allowed then
    raise exception 'l''organisation n''autorise pas l''assistance à ce point'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.check_bag_waypoint() from public;

-- ------------------------------------------------------------
-- set_race_waypoints : la clé `assistanceAllowed` rejoint la chaîne
-- ------------------------------------------------------------
-- Absente, elle vaut faux, comme `dropBagAllowed`.

create or replace function public.set_race_waypoints(p_race_id uuid, p_waypoints jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_geometry_id uuid;
  v_fingerprint text;
  v_key text;
begin
  -- Même garde que `enqueue_race_gpx` (0008) : écrire le référentiel de
  -- parcours, c'est modifier le contenu de course. Sans session — worker,
  -- reprise de données — l'appelant est `service_role`, tenu de vérifier
  -- lui-même ce qu'il fait (03_PRIVACY_RLS §8).
  if (select auth.uid()) is not null and not (
    private.user_can_manage_race(p_race_id, 'editor') or private.is_pluka_admin()
  ) then
    raise exception 'action non autorisée sur cette épreuve'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.races r where r.id = p_race_id) then
    raise exception 'épreuve introuvable' using errcode = 'P0002';
  end if;

  -- La chaîne demandée, numérotée par sa position. L'ordre du tableau fait foi :
  -- c'est lui que l'écran manipule.
  --
  -- `on commit drop` ne suffit pas : deux appels dans une même transaction —
  -- corriger deux épreuves d'affilée — trouveraient la table encore là.
  drop table if exists wanted;

  create temporary table wanted on commit drop as
  select
    row_number() over () as sort_order,
    nullif(entry ->> 'id', '')::uuid as id,
    entry ->> 'name' as name,
    (entry ->> 'waypointType')::public.waypoint_type as waypoint_type,
    (entry ->> 'distanceKm')::numeric(7, 2) as distance_km,
    nullif(entry ->> 'cutoffAt', '')::timestamptz as cutoff_at,
    coalesce(nullif(entry ->> 'cutoffType', ''), 'hard')::public.cutoff_type as cutoff_type,
    coalesce((entry ->> 'dropBagAllowed')::boolean, false) as drop_bag_allowed,
    coalesce((entry ->> 'assistanceAllowed')::boolean, false) as assistance_allowed
  from jsonb_array_elements(p_waypoints) as entry;

  select count(*) into v_count from wanted;

  -- L'ordre des écritures est contraint par les `restrict` du schéma. Un
  -- waypoint ne peut partir qu'une fois que plus aucun segment ne le désigne,
  -- et les segments ne peuvent être redirigés qu'une fois les nouveaux
  -- waypoints présents. D'où : barrières, waypoints, segments, puis les
  -- waypoints retirés — dans cet ordre et pas un autre.

  -- Les barrières dont le waypoint n'a plus d'heure, ou disparaît.
  delete from public.race_cutoffs c
  where c.race_id = p_race_id
    and not exists (
      select 1 from wanted w where w.id = c.race_waypoint_id and w.cutoff_at is not null
    );

  -- Rangs mis au négatif avant d'être réattribués : `(race_id, sort_order)`
  -- est unique et non différable, et permuter deux waypoints en une passe
  -- violerait la contrainte au milieu de l'instruction. Les rangs négatifs
  -- servent ensuite de marque : ce qui reste négatif n'est plus voulu.
  update public.race_waypoints
  set sort_order = -sort_order - 1
  where race_id = p_race_id;

  update public.race_waypoints w
  set name = x.name,
      waypoint_type = x.waypoint_type,
      distance_km = x.distance_km,
      sort_order = x.sort_order,
      drop_bag_allowed = x.drop_bag_allowed,
      assistance_allowed = x.assistance_allowed,
      updated_at = now()
  from wanted x
  where w.id = x.id and w.race_id = p_race_id;

  insert into public.race_waypoints (race_id, name, waypoint_type, distance_km, sort_order, drop_bag_allowed, assistance_allowed)
  select p_race_id, x.name, x.waypoint_type, x.distance_km, x.sort_order, x.drop_bag_allowed, x.assistance_allowed
  from wanted x
  where x.id is null or not exists (
    select 1 from public.race_waypoints w where w.id = x.id and w.race_id = p_race_id
  );

  -- ----------------------------------------------------------
  -- Segments dérivés : un par intervalle, dans l'ordre de la chaîne.
  -- ----------------------------------------------------------
  -- Mis à jour en place plutôt que remplacés : `plan_segments` les référence
  -- en `restrict`, et un Plan existant ne doit pas être détruit par une
  -- correction de référentiel (§46).
  --
  -- Seuls les waypoints conservés entrent dans la chaîne : ceux qui gardent un
  -- rang négatif sont sur le départ, et les faire figurer ici recréerait un
  -- segment vers ce qu'on s'apprête à retirer.
  with chain as (
    select
      w.id,
      w.sort_order,
      w.distance_km,
      lead(w.id) over (order by w.sort_order) as next_id,
      lead(w.distance_km) over (order by w.sort_order) as next_distance
    from public.race_waypoints w
    where w.race_id = p_race_id and w.sort_order > 0
  ),
  intervals as (
    select
      (row_number() over (order by sort_order) - 1)::smallint as sort_order,
      id as from_id,
      next_id as to_id,
      next_distance - distance_km as distance_km
    from chain
    where next_id is not null
  ),
  updated as (
    update public.race_segments s
    set from_waypoint_id = i.from_id,
        to_waypoint_id = i.to_id,
        distance_km = i.distance_km
    from intervals i
    where s.race_id = p_race_id and s.sort_order = i.sort_order
    returning s.sort_order
  )
  insert into public.race_segments (race_id, from_waypoint_id, to_waypoint_id, distance_km, sort_order)
  select p_race_id, i.from_id, i.to_id, i.distance_km, i.sort_order
  from intervals i
  where i.sort_order not in (select sort_order from updated);

  -- Les segments surnuméraires, qui pointaient encore vers l'ancienne chaîne.
  delete from public.race_segments s
  where s.race_id = p_race_id and s.sort_order >= greatest(v_count - 1, 0);

  -- Plus rien ne les désigne : les waypoints retirés peuvent partir. Un sac ou
  -- une assistance qui les référencerait encore fait échouer la réécriture, et
  -- c'est voulu (§46).
  delete from public.race_waypoints w
  where w.race_id = p_race_id and w.sort_order < 0;

  -- ----------------------------------------------------------
  -- Barrières horaires.
  -- ----------------------------------------------------------
  insert into public.race_cutoffs (race_id, race_waypoint_id, cutoff_datetime, cutoff_type)
  select p_race_id, w.id, x.cutoff_at, x.cutoff_type
  from wanted x
  join public.race_waypoints w on w.race_id = p_race_id and w.sort_order = x.sort_order
  where x.cutoff_at is not null
  on conflict (race_id, race_waypoint_id, cutoff_type)
  do update set cutoff_datetime = excluded.cutoff_datetime;

  -- ----------------------------------------------------------
  -- Relance du prétraitement — §22.2.
  -- ----------------------------------------------------------
  -- `drop_bag_allowed` et `assistance_allowed` n'entrent pas dans l'empreinte : ils ne changent rien au
  -- calcul du parcours, et cocher un drop bag ne relance aucun traitement.
  select r.current_course_geometry_id into v_geometry_id
  from public.races r where r.id = p_race_id;

  select md5(string_agg(
           w.sort_order || ':' || w.waypoint_type || ':' || w.distance_km, '|'
           order by w.sort_order))
  into v_fingerprint
  from public.race_waypoints w
  where w.race_id = p_race_id;

  v_key := 'course.waypoints:' || p_race_id::text || ':' ||
           coalesce(v_geometry_id::text, 'sans-geometrie') || ':' || coalesce(v_fingerprint, '');

  -- `do nothing` : réenregistrer la même chaîne sur la même géométrie ne
  -- redemande pas un traitement qui produirait exactement le même résultat.
  insert into private.outbox_events
    (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
  values (
    'course.waypoints.changed',
    'race',
    p_race_id,
    jsonb_build_object(
      'eventType', 'course.waypoints.changed',
      'raceId', p_race_id,
      'courseGeometryId', v_geometry_id,
      'waypointCount', v_count,
      'idempotencyKey', v_key
    ),
    v_key
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'raceId', p_race_id,
    'waypointCount', v_count,
    'courseGeometryId', v_geometry_id,
    'preprocessingRequested', v_geometry_id is not null
  );
end;
$$;

comment on function public.set_race_waypoints(uuid, jsonb) is
  'Réécrit le référentiel de parcours d''une épreuve — waypoints, segments dérivés, barrières — et enfile la relance du prétraitement, en une transaction (§31, §22.2). Les segments ne sont pas saisis : ce sont les intervalles entre waypoints consécutifs (PLAN_ENGINE §7).';

revoke all on function public.set_race_waypoints(uuid, jsonb) from public, anon;
grant execute on function public.set_race_waypoints(uuid, jsonb) to authenticated, service_role;

-- ------------------------------------------------------------
-- Un rendez-vous d'assistance, à un point autorisé de sa course
-- ------------------------------------------------------------
-- AC-ASST-03, gardé par la base comme par le domaine. Seulement à l'écriture
-- du point : si l'organisation retire l'assistance ensuite, le rendez-vous
-- reste, et l'écran le signale — comme un drop bag retiré (0095).

create function private.check_assistance_waypoint()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_allowed boolean;
begin
  select w.assistance_allowed into v_allowed
  from public.race_assistants a
  join public.participant_races pr on pr.id = a.participant_race_id
  join public.race_waypoints w on w.race_id = pr.race_id
  where a.id = new.assistant_id and w.id = new.race_waypoint_id;

  if not found then
    raise exception 'ce point n''appartient pas à la course de cette participation'
      using errcode = '23514';
  end if;

  if not v_allowed then
    raise exception 'l''organisation n''autorise pas l''assistance à ce point'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.check_assistance_waypoint() from public;

create trigger trg_assistance_assignments_waypoint
  before insert or update of race_waypoint_id, assistant_id on public.assistance_assignments
  for each row execute function private.check_assistance_waypoint();
