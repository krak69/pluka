-- PLUKA — Bibliothèque : « Mon matériel »
-- Référence : docs/00_PRODUCT_SPEC.md §20 · docs/02_DATA_MODEL.md §17 ·
--             docs/03_PRIVACY_RLS.md §37 · docs/04_ENTITLEMENTS.md §48, §58, §59 ·
--             migrations 0005, 0078, 0091
--
-- L'inventaire du matériel que le coureur possède, une pièce par ligne, pour
-- l'ajouter à la Préparation d'une course sans le retaper (décision produit du
-- 2026-11-13). Une pièce saisie dans une course y entre aussi, avec PLUKA+.
--
-- Une table plutôt qu'un modèle JSON dans `library_templates` : on ajoute et on
-- retire une pièce, et le doublon se refuse en base, à la casse près.
--
-- Privé : propriétaire seulement, aucune policy organisation (§37). Le droit
-- d'écrire (PLUKA+, `library.edit`) se décide dans le domaine ; le lire est
-- gratuit (`library.read`) — un PLUKA+ expiré garde son matériel.

create table public.user_equipment_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_equipment_items_label_length check (char_length(btrim(label)) between 1 and 120)
);

comment on table public.user_equipment_items is
  'Mon matériel : ce que le coureur possède, à reprendre dans la Préparation d''une course (0092). Privé, propriétaire seulement.';

-- Une pièce n'existe qu'une fois par coureur, quelle que soit la casse.
create unique index ux_user_equipment_items_label
  on public.user_equipment_items (user_id, lower(btrim(label)));

create trigger trg_user_equipment_items_updated_at
  before update on public.user_equipment_items
  for each row execute function private.set_updated_at();

alter table public.user_equipment_items enable row level security;
revoke all on public.user_equipment_items from public, anon, authenticated;
grant select, insert, update, delete on public.user_equipment_items to authenticated;

create policy user_equipment_items__select__owner on public.user_equipment_items
  for select to authenticated using (user_id = (select auth.uid()));

create policy user_equipment_items__insert__owner on public.user_equipment_items
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy user_equipment_items__update__owner on public.user_equipment_items
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy user_equipment_items__delete__owner on public.user_equipment_items
  for delete to authenticated using (user_id = (select auth.uid()));

-- ============================================================
-- L'export du compte inclut « Mon matériel » (RGPD art. 15 et 20)
-- ============================================================
-- Reprise à l'identique de 0078, avec la clé `equipmentLibrary`.

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
          'tasks', (select jsonb_agg(to_jsonb(tk)) from public.tasks tk where tk.participant_race_id = pr.id),
          'assistants', (
            select jsonb_agg(to_jsonb(a) || jsonb_build_object(
              'assignments', (select jsonb_agg(to_jsonb(aa)) from public.assistance_assignments aa where aa.assistant_id = a.id)))
            from public.race_assistants a where a.participant_race_id = pr.id
          ),
          'emergencyContacts', (select jsonb_agg(to_jsonb(ec)) from public.emergency_contacts ec where ec.participant_race_id = pr.id),
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
