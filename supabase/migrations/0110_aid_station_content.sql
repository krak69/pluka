-- ============================================================
-- 0110 — Contenu des ravitaillements
-- ============================================================
--
-- NUTRITION_ENGINE §31, §32 ; décisions du 2026-11-19 :
--
-- - l'organisation (dans /org) et l'équipe PLUKA (dans l'admin) disent, point
--   par point, ce que propose un ravitaillement : eau, boisson d'effort, cola,
--   soupe, fruits, sucré, salé, repas chaud, ou autre chose en clair. C'est
--   `race_aid_station_items` (0001), lisible avec la course (0005, §42) ;
-- - rien n'est supposé : sans contenu annoncé, l'écran dit « non communiqué »,
--   et le coureur peut noter pour lui ce qu'il y trouvera
--   (`participant_aid_notes`), jamais présenté comme officiel ;
-- - quand une boisson d'effort est annoncée (ou notée), le coureur peut la
--   prendre sur place : ce remplissage ne demande ni dose à préparer ni dose à
--   emporter (`nutrition_plans.aid_drink_waypoint_ids`).

-- ------------------------------------------------------------
-- 1. Ce que propose un ravitaillement
-- ------------------------------------------------------------

alter table public.race_aid_station_items
  add column kind text not null default 'other'
    constraint race_aid_station_items_kind check (
      kind in ('water', 'sports_drink', 'cola', 'soup', 'fruit', 'sweet', 'salty', 'hot_meal', 'other')
    ),
  add constraint race_aid_station_items_label_length
    check (char_length(btrim(label)) between 1 and 80);

-- Un même genre une seule fois par point ; « autre » autant que nécessaire.
create unique index ux_race_aid_station_items_kind
  on public.race_aid_station_items(race_waypoint_id, kind)
  where kind <> 'other';

create index ix_race_aid_station_items_waypoint
  on public.race_aid_station_items(race_waypoint_id);

comment on column public.race_aid_station_items.kind is
  'Genre de ce qui est proposé (0110) ; « sports_drink » permet au coureur de prendre la boisson sur place.';

/*
 * Remplace ce que propose un point : `p_items` est un tableau
 * `[{ "kind": "water", "label": "Eau" }, …]`, dans l'ordre d'affichage. Vide,
 * le point n'annonce plus rien. Même garde que `set_race_waypoints` (0098) :
 * l'organisation éditrice de la course, ou l'administration PLUKA.
 */
create or replace function public.set_race_aid_station_items(
  p_race_waypoint_id uuid,
  p_items jsonb
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_race_id uuid;
begin
  select w.race_id into v_race_id from public.race_waypoints w where w.id = p_race_waypoint_id;
  if v_race_id is null then
    raise exception 'point introuvable' using errcode = 'P0002';
  end if;

  if (select auth.uid()) is not null and not (
    private.user_can_manage_race(v_race_id, 'editor') or private.is_pluka_admin()
  ) then
    raise exception 'action non autorisée sur cette épreuve' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 30 then
    raise exception 'contenu de ravitaillement invalide' using errcode = '22023';
  end if;

  delete from public.race_aid_station_items i where i.race_waypoint_id = p_race_waypoint_id;

  insert into public.race_aid_station_items (race_waypoint_id, kind, label, sort_order)
  select p_race_waypoint_id, item.value ->> 'kind', btrim(item.value ->> 'label'),
         (item.position - 1)::smallint
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as item(value, position);
end;
$$;

revoke all on function public.set_race_aid_station_items(uuid, jsonb) from public, anon;
grant execute on function public.set_race_aid_station_items(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 2. La note du coureur, quand rien n'est annoncé
-- ------------------------------------------------------------

create table public.participant_aid_notes (
  id uuid primary key default gen_random_uuid(),
  participant_race_id uuid not null references public.participant_races(id) on delete cascade,
  race_waypoint_id uuid not null references public.race_waypoints(id) on delete cascade,
  kinds text[] not null default '{}'
    constraint participant_aid_notes_kinds check (
      kinds <@ array['water', 'sports_drink', 'cola', 'soup', 'fruit', 'sweet', 'salty', 'hot_meal']::text[]
    ),
  note text constraint participant_aid_notes_note check (note is null or char_length(btrim(note)) between 1 and 200),
  updated_at timestamptz not null default now(),
  unique (participant_race_id, race_waypoint_id)
);

create index ix_participant_aid_notes_waypoint on public.participant_aid_notes(race_waypoint_id);

alter table public.participant_aid_notes enable row level security;

-- Privée comme la préparation : le coureur seul, jamais l'organisation (03 §5).
create policy participant_aid_notes__select__owner on public.participant_aid_notes
  for select to authenticated
  using (private.user_owns_participant_race(participant_race_id));

grant select on public.participant_aid_notes to authenticated;

/* La note d'un point de la course du coureur ; vide (ni genre ni texte), elle s'efface. */
create or replace function public.set_participant_aid_note(
  p_participant_race_id uuid,
  p_race_waypoint_id uuid,
  p_kinds text[],
  p_note text
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.user_owns_participant_race(p_participant_race_id) then
    raise exception 'participation introuvable' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.race_waypoints w
    join public.participant_races pr on pr.race_id = w.race_id
    where w.id = p_race_waypoint_id and pr.id = p_participant_race_id
  ) then
    raise exception 'point introuvable' using errcode = '42501';
  end if;

  if cardinality(coalesce(p_kinds, '{}')) = 0 and nullif(btrim(coalesce(p_note, '')), '') is null then
    delete from public.participant_aid_notes n
    where n.participant_race_id = p_participant_race_id and n.race_waypoint_id = p_race_waypoint_id;
    return;
  end if;

  insert into public.participant_aid_notes (participant_race_id, race_waypoint_id, kinds, note)
  values (p_participant_race_id, p_race_waypoint_id, coalesce(p_kinds, '{}'),
          nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (participant_race_id, race_waypoint_id) do update
    set kinds = excluded.kinds, note = excluded.note, updated_at = now();
end;
$$;

revoke all on function public.set_participant_aid_note(uuid, uuid, text[], text) from public, anon;
grant execute on function public.set_participant_aid_note(uuid, uuid, text[], text) to authenticated;

-- ------------------------------------------------------------
-- 3. « Je prends la boisson du ravito ici »
-- ------------------------------------------------------------

alter table public.nutrition_plans
  add column aid_drink_waypoint_ids uuid[] not null default '{}'
    constraint nutrition_plans_aid_drink_size check (cardinality(aid_drink_waypoint_ids) <= 100);

comment on column public.nutrition_plans.aid_drink_waypoint_ids is
  'Ravitaillements où le coureur prend la boisson d''effort fournie, sans dose à lui (0110).';

create or replace function public.set_nutrition_aid_drink(
  p_participant_race_id uuid,
  p_race_waypoint_id uuid,
  p_use boolean
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.user_owns_participant_race(p_participant_race_id) then
    raise exception 'participation introuvable' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.race_waypoints w
    join public.participant_races pr on pr.race_id = w.race_id
    where w.id = p_race_waypoint_id and pr.id = p_participant_race_id
  ) then
    raise exception 'point introuvable' using errcode = '42501';
  end if;

  update public.nutrition_plans n
  set aid_drink_waypoint_ids =
        array_remove(n.aid_drink_waypoint_ids, p_race_waypoint_id)
        || case when coalesce(p_use, false) then array[p_race_waypoint_id] else '{}'::uuid[] end,
      updated_at = now()
  from public.race_plans rp
  where n.race_plan_id = rp.id
    and rp.participant_race_id = p_participant_race_id
    and rp.status = 'active';

  if not found then
    raise exception 'aucune stratégie Nutrition sur le Plan actif' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_nutrition_aid_drink(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_nutrition_aid_drink(uuid, uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- 4. export_my_data : les notes de ravitaillement rejoignent la participation
-- ------------------------------------------------------------

create or replace function public.export_my_data()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_races uuid[];
begin
  if v_user is null then
    raise exception 'session requise' using errcode = '42501';
  end if;

  v_races := array(select id from public.participant_races where user_id = v_user);

  return jsonb_build_object(
    'exportedAt', now(),
    'account', (select to_jsonb(u) from public.users u where u.id = v_user),
    'trailProfile', (select to_jsonb(t) from public.trail_profiles t where t.user_id = v_user),
    'participations', coalesce((
      select jsonb_agg(
        to_jsonb(pr) || jsonb_build_object(
          'race', (select jsonb_build_object('id', r.id, 'name', r.name) from public.races r where r.id = pr.race_id),
          'settings', (select jsonb_agg(to_jsonb(s)) from public.participant_race_settings s where s.participant_race_id = pr.id),
          'plans', (
            select jsonb_agg(
              (to_jsonb(p) - 'input_hash') || jsonb_build_object(
                'waypoints', (select jsonb_agg(to_jsonb(w) order by w.sort_order) from public.plan_waypoints w where w.race_plan_id = p.id),
                'segments', (select jsonb_agg(to_jsonb(sg)) from public.plan_segments sg where sg.race_plan_id = p.id),
                'nutrition', (
                  select jsonb_agg(
                    (to_jsonb(n) - 'input_hash') || jsonb_build_object(
                      'waypoints', (
                        select jsonb_agg(
                          to_jsonb(nw) || jsonb_build_object(
                            'items', (select jsonb_agg(to_jsonb(ni)) from public.nutrition_waypoint_items ni where ni.nutrition_waypoint_id = nw.id)
                          ) order by nw.sort_order)
                        from public.nutrition_waypoints nw where nw.nutrition_plan_id = n.id
                      )
                    ))
                  from public.nutrition_plans n where n.race_plan_id = p.id
                )
              ) order by p.version)
            from public.race_plans p where p.participant_race_id = pr.id
          ),
          'equipment', (select jsonb_agg(to_jsonb(e)) from public.participant_equipment e where e.participant_race_id = pr.id),
          'bags', (
            select jsonb_agg(to_jsonb(b) || jsonb_build_object(
              'items', (select jsonb_agg(to_jsonb(bi)) from public.bag_items bi where bi.bag_id = b.id)))
            from public.bags b where b.participant_race_id = pr.id
          ),
          'bag_suggestions_dismissed', (
            select jsonb_agg(d.suggestion_key order by d.created_at)
            from public.bag_suggestion_dismissals d where d.participant_race_id = pr.id
          ),
          'tasks', (select jsonb_agg(to_jsonb(tk)) from public.tasks tk where tk.participant_race_id = pr.id),
          'assistants', (
            select jsonb_agg(to_jsonb(a) || jsonb_build_object(
              'assignments', (
                select jsonb_agg(to_jsonb(aa) || jsonb_build_object(
                  'items', (select jsonb_agg(to_jsonb(ai)) from public.assistance_items ai where ai.assistance_assignment_id = aa.id)))
                from public.assistance_assignments aa where aa.assistant_id = a.id)))
            from public.race_assistants a where a.participant_race_id = pr.id
          ),
          'emergencyContacts', (select jsonb_agg(to_jsonb(ec)) from public.emergency_contacts ec where ec.participant_race_id = pr.id),
          'aidNotes', (select jsonb_agg(to_jsonb(an)) from public.participant_aid_notes an where an.participant_race_id = pr.id),
          'postRaceReviews', (select jsonb_agg(to_jsonb(rv)) from public.post_race_reviews rv where rv.participant_race_id = pr.id),
          'repereEstimates', (select jsonb_agg(to_jsonb(re)) from public.repere_estimates re where re.participant_race_id = pr.id),
          'importedByOrganizer', jsonb_build_object(
            'demographics', (select to_jsonb(d) from private.participant_demographics d where d.participant_race_id = pr.id),
            'performanceSignals', (select jsonb_agg(to_jsonb(ps)) from private.participant_performance_signals ps where ps.participant_race_id = pr.id)
          )
        ) order by pr.created_at)
      from public.participant_races pr where pr.id = any(v_races)
    ), '[]'::jsonb),
    'outings', coalesce((
      select jsonb_agg(to_jsonb(o) || jsonb_build_object(
        'waypoints', (select jsonb_agg(to_jsonb(ow)) from public.outing_waypoints ow where ow.outing_id = o.id),
        'equipment', (select jsonb_agg(to_jsonb(oe)) from public.outing_equipment oe where oe.outing_id = o.id),
        'feedback', (select jsonb_agg(to_jsonb(ofb)) from public.outing_feedback ofb where ofb.outing_id = o.id)
      ) order by o.created_at)
      from public.outings o where o.user_id = v_user
    ), '[]'::jsonb),
    'nutritionProducts', (select jsonb_agg(to_jsonb(np)) from public.user_nutrition_products np where np.user_id = v_user),
    'libraryTemplates', (select jsonb_agg(to_jsonb(lt)) from public.library_templates lt where lt.user_id = v_user),
    'equipmentLibrary', (select jsonb_agg(to_jsonb(ei) order by ei.label) from public.user_equipment_items ei where ei.user_id = v_user),
    'conversations', (
      select jsonb_agg(to_jsonb(c) || jsonb_build_object(
        'messages', (select jsonb_agg(to_jsonb(m) order by m.created_at) from public.pluka_messages m where m.conversation_id = c.id)))
      from public.pluka_conversations c where c.user_id = v_user
    ),
    'community', jsonb_build_object(
      'threads', (select jsonb_agg(to_jsonb(th)) from public.community_threads th where th.author_user_id = v_user),
      'posts', (select jsonb_agg(to_jsonb(po)) from public.community_posts po where po.author_user_id = v_user),
      'reactions', (select jsonb_agg(to_jsonb(cr)) from public.community_reactions cr where cr.user_id = v_user),
      'reports', (select jsonb_agg(to_jsonb(rp)) from public.community_reports rp where rp.reporter_user_id = v_user)
    ),
    'access', jsonb_build_object(
      'entitlements', (select jsonb_agg(to_jsonb(en)) from public.entitlements en where en.user_id = v_user),
      'betaAccess', (select jsonb_agg(to_jsonb(bg)) from public.beta_access_grants bg where bg.user_id = v_user),
      'purchases', (select jsonb_agg(to_jsonb(pu)) from public.purchases pu where pu.user_id = v_user),
      'usage', (select jsonb_agg(to_jsonb(us)) from public.entitlement_usage us where us.user_id = v_user)
    ),
    'repereCalibration', (select jsonb_agg(to_jsonb(rc)) from public.repere_calibration_pairs rc where rc.user_id = v_user),
    'organizations', (
      select jsonb_agg(jsonb_build_object('organizationId', m.organization_id, 'name', o.name, 'role', m.role, 'since', m.created_at))
      from public.organization_members m join public.organizations o on o.id = m.organization_id
      where m.user_id = v_user
    )
  );
end;
$$;
