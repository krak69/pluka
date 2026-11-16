-- ============================================================
-- 0096 — Suggestions de sacs : suppression de compte et export
-- ============================================================
--
-- `bag_suggestion_dismissals` (0095) est de la préparation privée. Elle part
-- avec le reste quand une participation importée redevient une ligne de
-- l'organisation (0078, 0082 : « la préparation du coureur part »), et figure
-- dans l'export de ses données (0078, 0092 ; RGPD, art. 15 et 20).
--
-- Une participation supprimée l'emporte déjà par `on delete cascade`. Les deux
-- fonctions sont reprises de leur dernière version, une ligne en plus chacune.

create or replace function private.delete_user_account(p_user uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_detached uuid[];
begin
  if private.account_deletion_blocker(p_user) is not null then
    raise exception 'compte non supprimable : %', private.account_deletion_blocker(p_user)
      using errcode = '55000';
  end if;

  -- La Nutrition d'abord. En cascade, les points du Plan ou de la sortie
  -- partiraient avant ceux de la Nutrition, et la clé qui les relie, remise à
  -- vide, violerait `nutrition_waypoints_origin_link_check`.
  delete from public.nutrition_plans n
  where n.race_plan_id in (
          select p.id from public.race_plans p
          join public.participant_races pr on pr.id = p.participant_race_id
          where pr.user_id = p_user)
     or n.outing_id in (select o.id from public.outings o where o.user_id = p_user);

  -- Une participation venue d'une organisation porte l'adresse de son fichier.
  -- Si une ligne non réclamée existe déjà pour la même adresse, la détacher la
  -- doublerait : celle-là disparaît.
  delete from public.participant_races pr
  where pr.user_id = p_user
    and (
      pr.invite_email is null
      or exists (
        select 1 from public.participant_races other
        where other.race_id = pr.race_id and other.user_id is null
          and other.invite_email = pr.invite_email
      )
    );

  v_detached := array(
    select pr.id from public.participant_races pr where pr.user_id = p_user
  );

  -- La préparation du coureur part. Ce que l'organisation a importé reste :
  -- invitations, lignes d'import, données déclaratives et indices, purgés avec
  -- sa liste (0077).
  delete from public.race_plans where participant_race_id = any(v_detached);
  delete from public.participant_race_settings where participant_race_id = any(v_detached);
  delete from public.participant_change_impacts where participant_race_id = any(v_detached);
  delete from public.tasks where participant_race_id = any(v_detached);
  delete from public.participant_equipment where participant_race_id = any(v_detached);
  delete from public.bags where participant_race_id = any(v_detached);
  delete from public.bag_suggestion_dismissals where participant_race_id = any(v_detached);
  delete from public.race_assistants where participant_race_id = any(v_detached);
  delete from public.emergency_contacts where participant_race_id = any(v_detached);
  delete from public.condition_proposals where participant_race_id = any(v_detached);
  delete from public.post_race_reviews where participant_race_id = any(v_detached);
  delete from public.pluka_conversations where participant_race_id = any(v_detached);
  delete from public.repere_estimates where participant_race_id = any(v_detached);
  delete from public.entitlements where participant_race_id = any(v_detached);
  delete from public.beta_access_grants where participant_race_id = any(v_detached);
  delete from private.race_intelligence_run_members where participant_race_id = any(v_detached);
  delete from private.notification_deliveries where participant_race_id = any(v_detached);
  delete from public.participant_start_changes where participant_race_id = any(v_detached);

  update public.participant_races
  set user_id = null, joined_at = null, preparation_state = 'to_prepare', updated_at = now()
  where id = any(v_detached);

  -- Le reste suit les règles des clés : le profil, les sorties, les produits,
  -- les conversations et les droits partent ; les contenus partagés et les
  -- traces d'action (journal, publications, imports) perdent leur auteur.
  -- L'entrée du journal passe avant : écrite après, elle nommerait un acteur
  -- qui n'existe plus.
  perform private.record_audit('account.deleted', 'users', p_user);

  delete from auth.users where id = p_user;
end;
$$;

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
