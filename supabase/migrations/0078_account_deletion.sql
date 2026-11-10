-- PLUKA V1 — Suppression de compte et export de ses données
-- File target: supabase/migrations/0078_account_deletion.sql
-- Référence : docs/03_PRIVACY_RLS.md §94, §96 · pluka.run/confidentialite ·
--             docs/legal/RGPD_AUTO_EVALUATION.md (droits des personnes)
--
-- DÉCISIONS DU 2026-11-09
--
-- - Délai de 30 jours. La demande ferme le compte (l'application déconnecte
--   toutes les sessions) ; une reconnexion dans les 30 jours l'annule ; après,
--   la purge de la nuit efface tout. Le RGPD laisse un mois pour répondre.
-- - Participation venue d'une organisation : détachée, pas effacée. La ligne
--   redevient la ligne importée, sans compte ni préparation ; elle suit ensuite
--   la purge des listes (0077, 12 mois après l'édition). Une participation que
--   le coureur a créée lui-même disparaît.
-- - Contenus de communauté que d'autres lisent : anonymisés. Fils, messages et
--   signalements restent, sans auteur ; les réactions disparaissent.
--
-- CE QUI EMPÊCHE UNE SUPPRESSION
--
-- La base refuse plutôt que de casser ce qui est partagé (§94) :
-- - membre de l'équipe PLUKA ;
-- - seul propriétaire d'une organisation non supprimée : elle resterait sans
--   personne pour la gérer ;
-- - auteur d'une publication de faits officiels : l'acte de publication est un
--   historique qui ne s'efface pas (AGENTS §14).
-- Ces cas passent par le support.
--
-- LE GARDE-FOU
--
-- Chaque table qui pointe vers un compte ou une participation est classée
-- (pgTAP 55). Une table nouvelle fait échouer le test tant qu'on n'a pas
-- décidé si elle part avec le compte, reste à l'organisation, ou s'anonymise.

begin;

-- ============================================================
-- 1. Les demandes
-- ============================================================

create table private.account_deletion_requests (
  user_id uuid primary key references public.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  purge_after timestamptz not null,
  constraint account_deletion_after_request check (purge_after > requested_at)
);

alter table private.account_deletion_requests enable row level security;

create index ix_account_deletion_due on private.account_deletion_requests (purge_after);

comment on table private.account_deletion_requests is
  'Comptes fermés en attente d''effacement (0078). Une reconnexion annule ; la purge de la nuit efface après purge_after.';

-- ============================================================
-- 2. Les contenus partagés s'anonymisent
-- ============================================================

alter table public.community_threads alter column author_user_id drop not null;
alter table public.community_threads drop constraint community_threads_author_user_id_fkey;
alter table public.community_threads add constraint community_threads_author_user_id_fkey
  foreign key (author_user_id) references public.users(id) on delete set null;

alter table public.community_posts alter column author_user_id drop not null;
alter table public.community_posts drop constraint community_posts_author_user_id_fkey;
alter table public.community_posts add constraint community_posts_author_user_id_fkey
  foreign key (author_user_id) references public.users(id) on delete set null;

alter table public.community_reports alter column reporter_user_id drop not null;
alter table public.community_reports drop constraint community_reports_reporter_user_id_fkey;
alter table public.community_reports add constraint community_reports_reporter_user_id_fkey
  foreign key (reporter_user_id) references public.users(id) on delete set null;

-- Le déclarant peut avoir supprimé son compte : le signalement reste lisible.
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
  left join public.users reporter on reporter.id = r.reporter_user_id
  left join public.community_posts po on po.id = r.post_id
  left join public.community_threads th on th.id = r.thread_id
  left join public.users author on author.id = po.author_user_id
  where r.id = p_report_id;
end;
$$;

-- ============================================================
-- 3. Ce qui empêche
-- ============================================================

create or replace function private.account_deletion_blocker(p_user uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (
      select 1 from public.users u
      where u.id = p_user and (u.platform_role <> 'user' or u.staff_role is not null)
    ) then 'pluka_staff'
    when exists (
      select 1
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id and o.deleted_at is null
      where m.user_id = p_user and m.role::text = 'owner'
        and not exists (
          select 1 from public.organization_members other
          where other.organization_id = m.organization_id
            and other.user_id <> p_user and other.role::text = 'owner'
        )
    ) then 'sole_owner'
    when exists (select 1 from private.fact_publication_acts a where a.actor_user_id = p_user)
      or exists (select 1 from public.race_fact_versions v where v.published_by_user_id = p_user)
      then 'publisher'
  end;
$$;

-- ============================================================
-- 4. La demande et son annulation, sous la session du coureur
-- ============================================================

create or replace function public.request_account_deletion()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_blocker text;
  v_purge_after timestamptz;
begin
  if v_user is null then
    raise exception 'session requise' using errcode = '42501';
  end if;

  v_blocker := private.account_deletion_blocker(v_user);
  if v_blocker is not null then
    return jsonb_build_object('status', 'blocked', 'reason', v_blocker);
  end if;

  -- Redemander ne repousse pas l'échéance.
  insert into private.account_deletion_requests (user_id, purge_after)
  values (v_user, now() + interval '30 days')
  on conflict (user_id) do nothing;

  select r.purge_after into v_purge_after
  from private.account_deletion_requests r where r.user_id = v_user;

  perform private.record_audit('account.deletion_requested', 'users', v_user);

  return jsonb_build_object('status', 'scheduled', 'purgeAfter', v_purge_after);
end;
$$;

create or replace function public.cancel_account_deletion()
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_count integer;
begin
  if v_user is null then
    return false;
  end if;

  delete from private.account_deletion_requests where user_id = v_user;
  get diagnostics v_count = row_count;

  if v_count > 0 then
    perform private.record_audit('account.deletion_cancelled', 'users', v_user);
  end if;

  return v_count > 0;
end;
$$;

-- ============================================================
-- 5. L'effacement
-- ============================================================

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

-- ============================================================
-- 6. La purge de la nuit efface les comptes arrivés à échéance
-- ============================================================

create or replace function private.purge_expired_data(p_now timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cutoff date := (p_now - interval '12 months')::date;
  v_rows integer;
  v_demographics integer;
  v_signals integer;
  v_audit integer;
  v_editions uuid[];
  v_request record;
  v_deleted integer := 0;
  v_cancelled integer := 0;
  v_blocked integer := 0;
begin
  -- Comptes d'abord : une participation détachée rejoint la liste de
  -- l'organisation, et suit la purge des listes juste après.
  for v_request in
    select r.user_id, r.requested_at, au.last_sign_in_at
    from private.account_deletion_requests r
    left join auth.users au on au.id = r.user_id
    where r.purge_after <= p_now
  loop
    if v_request.last_sign_in_at is not null
       and v_request.last_sign_in_at > v_request.requested_at then
      -- Revenu entre-temps : la demande tombe.
      delete from private.account_deletion_requests where user_id = v_request.user_id;
      v_cancelled := v_cancelled + 1;
    elsif private.account_deletion_blocker(v_request.user_id) is not null then
      -- Devenu non supprimable (une organisation, une publication) : on garde
      -- la demande, le support tranche.
      v_blocked := v_blocked + 1;
    else
      perform private.delete_user_account(v_request.user_id);
      v_deleted := v_deleted + 1;
    end if;
  end loop;

  v_editions := array(
    select ed.id from public.editions ed
    where coalesce(ed.end_date, ed.start_date) < v_cutoff
  );

  delete from private.participant_demographics d
  using public.participant_races pr, public.races r
  where d.participant_race_id = pr.id
    and r.id = pr.race_id
    and r.edition_id = any(v_editions);
  get diagnostics v_demographics = row_count;

  delete from private.participant_performance_signals s
  using public.participant_races pr, public.races r
  where s.participant_race_id = pr.id
    and r.id = pr.race_id
    and r.edition_id = any(v_editions);
  get diagnostics v_signals = row_count;

  delete from public.participant_races pr
  using public.races r
  where r.id = pr.race_id
    and r.edition_id = any(v_editions)
    and pr.user_id is null;
  get diagnostics v_rows = row_count;

  delete from private.audit_logs where created_at < p_now - interval '1 year';
  get diagnostics v_audit = row_count;

  return jsonb_build_object(
    'accountsDeleted', v_deleted,
    'deletionsCancelled', v_cancelled,
    'deletionsBlocked', v_blocked,
    'participantRows', v_rows,
    'demographics', v_demographics,
    'performanceSignals', v_signals,
    'auditLogs', v_audit
  );
end;
$$;

-- ============================================================
-- 7. L'export : tout ce que PLUKA garde sur le coureur
-- ============================================================

/*
 * Droit d'accès et portabilité (RGPD art. 15 et 20). Le coureur reçoit ses
 * propres lignes, y compris ce qu'une organisation a importé à son sujet
 * (données déclaratives, indices) : c'est une donnée le concernant. Aucune
 * empreinte de jeton ne sort, et rien d'un autre compte : les assistants sont
 * ceux que le coureur a lui-même saisis.
 */
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

-- ============================================================
-- 8. Droits, fonction par fonction (jamais tout le schéma : 0071)
-- ============================================================

revoke all on function private.account_deletion_blocker(uuid) from public, anon, authenticated;
revoke all on function private.delete_user_account(uuid) from public, anon, authenticated;
revoke all on function private.purge_expired_data(timestamptz) from public, anon, authenticated;

revoke all on function public.request_account_deletion() from public, anon;
revoke all on function public.cancel_account_deletion() from public, anon;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;
grant execute on function public.cancel_account_deletion() to authenticated;
grant execute on function public.export_my_data() to authenticated;

comment on function public.request_account_deletion() is
  'Ferme le compte de la session ; effacement 30 jours plus tard sauf reconnexion (0078).';
comment on function public.export_my_data() is
  'Toutes les données du compte de la session, en JSON (RGPD art. 15 et 20, 0078).';

commit;
