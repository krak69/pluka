-- PLUKA V1 — Saisie du référentiel de parcours, et relance du prétraitement
-- File target: supabase/migrations/0025_race_waypoints_authoring.sql
-- Référence : docs/engines/PLAN_ENGINE.md §7, §8.1 · docs/01_ARCHITECTURE.md §22.1, §22.2, §31 ·
--             docs/02_DATA_MODEL.md §6.6, §6.7 · docs/00_PRODUCT_SPEC.md §4.1
--
-- POURQUOI
--
-- 0021 a donné au prétraitement son chemin d'écriture, et le worker sait le
-- refuser proprement : « un GPX déposé avant ses waypoints est un ordre
-- d'import légitime […] le prétraitement reste `pending` et attend que
-- quelqu'un le relance ». Personne ne pouvait ni saisir ces waypoints, ni
-- relancer quoi que ce soit. Tout import s'arrêtait donc en `skipped`, et
-- aucun Plan ne pouvait être calculé.
--
-- 01. UNE SEULE ÉCRITURE, PAS UNE PAR LIGNE
--
-- Les waypoints ne sont pas des lignes indépendantes : ils forment une chaîne,
-- dont PLAN_ENGINE §7 exige la cohérence — « les waypoints sont ordonnés de
-- façon monotone », « les RaceSegments forment une chaîne cohérente ». Les
-- éditer un par un par PostgREST laisserait, entre deux requêtes, un
-- référentiel dont les segments ne relient plus les bons points.
--
-- D'où une fonction unique qui réécrit la chaîne entière : waypoints, segments
-- dérivés, barrières, et l'événement de relance. C'est le cas que §31 vise —
-- « utiliser une transaction PostgreSQL lorsque plusieurs écritures doivent
-- réussir ensemble ».
--
-- Les segments ne sont pas saisis : ils *sont* les intervalles entre waypoints
-- consécutifs, et `validateInput` du moteur le vérifie littéralement
-- (segment[i] relie waypoint[i] à waypoint[i+1]). Les faire saisir à la main
-- créerait une seconde vérité qui divergerait dès la première insertion.
--
-- 02. CE QUI RÉSISTE, ET POURQUOI C'EST BIEN
--
-- `race_waypoints`, `race_segments` et `race_cutoffs` sont référencés en
-- `on delete restrict` par les sacs, l'assistance, les Plans. Retirer un
-- waypoint sur lequel un coureur a déjà planifié échoue donc, et doit échouer :
-- §46 ne permet pas de modifier un objet personnel sous prétexte que la course
-- a changé. L'erreur remonte en `conflict`, pas en corruption silencieuse.
--
-- 03. LA RELANCE
--
-- `course.waypoints.changed` part dans l'outbox, dans la même transaction que
-- l'écriture (§22.2). Sa clé d'idempotence porte l'empreinte de la chaîne et
-- la géométrie courante : sauver deux fois le même référentiel n'enfile qu'un
-- traitement, et un nouveau GPX en redemande un (§22.1).

begin;

-- ============================================================
-- 01. Routage de l'événement vers la file géo
-- ============================================================
-- Le dispatcher de 0008 ne connaît que `gpx.%` et `source.%` ; un événement
-- sans destination y est marqué `failed`. Le prétraitement d'un parcours est
-- du travail géométrique : il rejoint `pluka_geo`.

create or replace function private.dispatch_outbox_events(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event record;
  v_queue text;
  v_dispatched integer := 0;
begin
  for v_event in
    select id, event_type, payload
    from private.outbox_events
    where status = 'pending' and available_at <= now()
    order by created_at
    limit p_limit
    for update skip locked
  loop
    v_queue := case
      when v_event.event_type like 'gpx.%' then 'pluka_geo'
      -- Le référentiel de parcours nourrit le même prétraitement que le GPX,
      -- et sur la même géométrie : même file.
      when v_event.event_type like 'course.%' then 'pluka_geo'
      when v_event.event_type like 'source.%' then 'pluka_sources'
      else null
    end;

    if v_queue is null then
      update private.outbox_events
      set status = 'failed',
          attempts = attempts + 1,
          last_error = 'aucune queue pour ' || v_event.event_type
      where id = v_event.id;
      continue;
    end if;

    perform pgmq.send(v_queue, v_event.payload);

    update private.outbox_events
    set status = 'published', published_at = now(), attempts = attempts + 1
    where id = v_event.id;

    v_dispatched := v_dispatched + 1;
  end loop;

  return v_dispatched;
end;
$$;

-- ============================================================
-- 02. Réécriture du référentiel de parcours
-- ============================================================

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
    coalesce(nullif(entry ->> 'cutoffType', ''), 'hard')::public.cutoff_type as cutoff_type
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
      updated_at = now()
  from wanted x
  where w.id = x.id and w.race_id = p_race_id;

  insert into public.race_waypoints (race_id, name, waypoint_type, distance_km, sort_order)
  select p_race_id, x.name, x.waypoint_type, x.distance_km, x.sort_order
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

-- ============================================================
-- 03. Ce que le worker relit pour relancer
-- ============================================================
-- Il lui faut la géométrie courante et le fichier dont elle provient : le
-- prétraitement repart de la trace, que 0008 n'a pas persistée point par point.

create or replace function public.worker_race_course_source(p_race_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'courseGeometryId', g.id,
    'storagePath', sn.snapshot_storage_path
  )
  from public.races r
  join public.race_course_geometries g on g.id = r.current_course_geometry_id
  join public.source_snapshots sn on sn.id = g.source_snapshot_id
  where r.id = p_race_id;
$$;

comment on function public.worker_race_course_source(uuid) is
  'Géométrie courante d''une épreuve et chemin du GPX dont elle provient. Le prétraitement repart du fichier : la trace normalisée n''est pas persistée point par point (0008).';

revoke all on function public.worker_race_course_source(uuid) from public, anon, authenticated;
grant execute on function public.worker_race_course_source(uuid) to service_role;

commit;
