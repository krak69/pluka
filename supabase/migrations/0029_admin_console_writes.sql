-- PLUKA V1 — Écritures de la console d'administration
-- File target: supabase/migrations/0029_admin_console_writes.sql
-- Référence : docs/03_PRIVACY_RLS.md §8, §55, §91, §92, §104 ·
--             docs/01_ARCHITECTURE.md §22.1, §22.2 · migration 0028
--
-- POURQUOI
--
-- 0028 a ouvert la console en lecture et annoncé que les écritures
-- « arriveront avec leur use case, branchées sur `private.record_audit` ».
-- Ce lot en livre cinq, et aucune ne peut passer par une policy :
--
-- - `community_reports` n'a aucune policy UPDATE (0005 : select et insert) ;
-- - `nutrition_products` n'a que `grant select` ;
-- - `private.ingestion_jobs` et `private.outbox_events` sont `service only`.
--
-- Les policies modérateur de 0005 sur `community_posts` et `community_threads`
-- couvrent bien `pluka_admin`, mais une écriture directe ne serait ni auditée,
-- ni atomique avec la clôture des signalements. Une policy de plus ne
-- résoudrait ni l'un ni l'autre.
--
-- CE QUE CETTE MIGRATION FAIT
--
-- Cinq fonctions `security definer`, une par geste. Même contrat que 0028 :
--
-- 1. `private.assert_pluka_admin` en **première instruction** — un non-admin
--    reçoit `42501` avant qu'une ligne soit lue ;
-- 2. la ligne visée est verrouillée (`for update`), et la transition vérifiée
--    sur l'état verrouillé : deux administrateurs qui cliquent ensemble ne
--    produisent pas deux effets ;
-- 3. l'écriture et `private.record_audit` dans la même transaction — si le
--    journal échoue, l'écriture est annulée. Une action d'administration non
--    journalisée n'existe pas.
--
-- Aucune nouvelle policy. Aucune nouvelle table.
--
-- CODES D'ERREUR
--
-- `42501` refus d'accès, comme 0028 ;
-- `P0002` (`no_data_found`) objet introuvable ;
-- `55000` (`object_not_in_prerequisite_state`) transition refusée — le code
--         que 0012 emploie déjà pour un candidat déjà tranché.
--
-- L'AUDIT
--
-- `after_data` est minimal (§92) : des statuts, des identifiants, des
-- compteurs. Jamais le contenu signalé, jamais un email, jamais la dernière
-- erreur d'un job — elle peut citer une URL de source.
--
-- MODÉRATION — décisions du lot 4b
--
-- Masquer un contenu clôt **tous** les signalements ouverts sur ce contenu,
-- dans la même transaction, sous **une seule** entrée d'audit ; masquer un fil
-- clôt aussi ceux de ses messages. Classer sans suite ne clôt que le
-- signalement traité. Chaque signalement garde son motif et son déclarant :
-- seuls `status` et `resolved_at` changent.
--
-- L'entrée d'audit du masquage porte la liste des signalements qu'il a clos
-- (`closedReportIds`). Ce lot ne livre pas de restauration ; si elle arrive,
-- elle ne rouvrira rien automatiquement, et c'est cette liste qui permettra de
-- retrouver les signalements concernés.

begin;

-- ============================================================
-- 1. Modération — masquer le contenu signalé
-- ============================================================

/*
 * Un fil ou un message passe `published → hidden`, et les signalements ouverts
 * qui le visent passent `→ resolved`.
 *
 * « Ouverts » veut dire `open` ou `reviewed` : `reviewed` est un état
 * intermédiaire de 0001 qu'aucun geste ne pose encore, mais un signalement
 * examiné et pas encore tranché n'est pas clos.
 *
 * Un contenu déjà masqué — par un modérateur d'organisation, via la policy de
 * 0005 — n'est pas une erreur : le geste clôt alors les signalements sans
 * changer le contenu, et l'audit le dit (`contentStatusFrom = hidden`).
 *
 * `deleted` n'est jamais posé ici. Supprimer un contenu touche à la rétention
 * (§93), que ce lot ne tranche pas.
 */
create or replace function public.admin_hide_reported_content(p_report_id uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_report record;
  v_kind text;
  v_target_id uuid;
  v_from public.community_content_status;
  v_to public.community_content_status;
  v_closed uuid[];
begin
  perform private.assert_pluka_admin('admin_hide_reported_content');

  select r.id, r.status, r.thread_id, r.post_id into v_report
  from public.community_reports r
  where r.id = p_report_id
  for update;

  if not found then
    raise exception 'signalement introuvable' using errcode = 'P0002';
  end if;

  if v_report.status not in ('open', 'reviewed') then
    raise exception 'signalement deja traite (%)', v_report.status
      using errcode = '55000';
  end if;

  if v_report.post_id is not null then
    v_kind := 'post';
    v_target_id := v_report.post_id;

    select p.status into v_from
    from public.community_posts p
    where p.id = v_target_id
    for update;
  else
    v_kind := 'thread';
    v_target_id := v_report.thread_id;

    select t.status into v_from
    from public.community_threads t
    where t.id = v_target_id
    for update;
  end if;

  if v_from is null then
    raise exception 'le contenu signale n''existe plus' using errcode = '55000';
  end if;

  v_to := case when v_from = 'published' then 'hidden' else v_from end;

  if v_from = 'published' then
    if v_kind = 'post' then
      update public.community_posts set status = 'hidden' where id = v_target_id;
    else
      update public.community_threads set status = 'hidden' where id = v_target_id;
    end if;
  end if;

  -- Les signalements frères. Pour un fil, ceux de ses messages aussi : masquer
  -- le fil retire ses messages de la lecture, les laisser ouverts ferait
  -- traiter deux fois la même décision.
  with closed as (
    update public.community_reports r
    set status = 'resolved', resolved_at = now()
    where r.status in ('open', 'reviewed')
      and (
        (v_kind = 'post' and r.post_id = v_target_id)
        or (
          v_kind = 'thread'
          and (
            r.thread_id = v_target_id
            or r.post_id in (select p.id from public.community_posts p where p.thread_id = v_target_id)
          )
        )
      )
    returning r.id
  )
  select coalesce(array_agg(id order by id), '{}') into v_closed from closed;

  perform private.record_audit(
    'report.hide_content',
    'community_reports',
    p_report_id,
    jsonb_build_object(
      'targetKind', v_kind,
      'targetId', v_target_id,
      'contentStatusFrom', v_from,
      'contentStatusTo', v_to,
      'closedReportIds', to_jsonb(v_closed)
    )
  );

  return coalesce(array_length(v_closed, 1), 0);
end;
$$;

comment on function public.admin_hide_reported_content(uuid) is
  'Masque le contenu signale et clot tous les signalements ouverts qui le visent (et ceux des messages d''un fil), sous une seule entree d''audit qui liste les signalements clos.';

-- ============================================================
-- 2. Modération — classer sans suite
-- ============================================================

/*
 * Le seul signalement traité passe `→ dismissed`. Les autres signalements sur
 * le même contenu restent ouverts : un motif écarté n'en écarte pas un autre.
 */
create or replace function public.admin_dismiss_report(p_report_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_report record;
begin
  perform private.assert_pluka_admin('admin_dismiss_report');

  select r.id, r.status, r.post_id into v_report
  from public.community_reports r
  where r.id = p_report_id
  for update;

  if not found then
    raise exception 'signalement introuvable' using errcode = 'P0002';
  end if;

  if v_report.status not in ('open', 'reviewed') then
    raise exception 'signalement deja traite (%)', v_report.status
      using errcode = '55000';
  end if;

  update public.community_reports
  set status = 'dismissed', resolved_at = now()
  where id = p_report_id;

  perform private.record_audit(
    'report.dismiss',
    'community_reports',
    p_report_id,
    jsonb_build_object(
      'targetKind', case when v_report.post_id is not null then 'post' else 'thread' end,
      'statusFrom', v_report.status,
      'statusTo', 'dismissed'
    )
  );
end;
$$;

comment on function public.admin_dismiss_report(uuid) is
  'Classe un signalement sans suite. Ne touche ni au contenu, ni aux autres signalements. Audite.';

-- ============================================================
-- 3. Traitements — relancer un job en échec
-- ============================================================

/*
 * Seul un job `failed` se relance : `queued` et `running` sont déjà en cours,
 * `completed` n'a rien à refaire, `cancelled` a été arrêté exprès.
 *
 * Le job repasse `queued`, ses tentatives à zéro — `fail_ingestion_job` le
 * déclarerait sinon `failed` dès le premier échec, puisque `attempts` vaut
 * déjà `max_attempts`. La dernière erreur est conservée : c'est elle qui a
 * motivé la relance, et le prochain passage du worker l'écrasera.
 *
 * Le message de file est rejoué depuis l'événement outbox d'origine, retrouvé
 * par la clé du job (0008 : la clé de l'événement est celle du job). Le
 * worker reçoit donc la même charge utile, avec la même `idempotencyKey`, et
 * `claim_ingestion_job` retrouve le même job. L'événement rejoué prend une clé
 * à part — `<clé>:retry:<n>` — parce que `outbox_events.idempotency_key` est
 * unique et que l'événement d'origine est déjà publié.
 *
 * Idempotence (§22.1) : le job verrouillé est `queued` après le premier appel,
 * donc un second appel est refusé en `55000` au lieu d'émettre un second
 * événement.
 */
create or replace function public.admin_retry_job(p_job_id uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_job record;
  v_origin record;
  v_prefix text;
  v_retry integer;
begin
  perform private.assert_pluka_admin('admin_retry_job');

  select j.id, j.job_type, j.status, j.idempotency_key, j.attempts into v_job
  from private.ingestion_jobs j
  where j.id = p_job_id
  for update;

  if not found then
    raise exception 'traitement introuvable' using errcode = 'P0002';
  end if;

  if v_job.status <> 'failed' then
    raise exception 'seul un traitement en echec se relance (%)', v_job.status
      using errcode = '55000';
  end if;

  select o.event_type, o.aggregate_type, o.aggregate_id, o.payload into v_origin
  from private.outbox_events o
  where o.idempotency_key = v_job.idempotency_key;

  if not found then
    -- Sans événement d'origine, il n'y a pas de charge utile à rejouer : en
    -- reconstruire une ici dupliquerait la connaissance du worker.
    raise exception 'aucun evenement d''origine pour ce traitement'
      using errcode = '55000';
  end if;

  -- `left(…) = …` plutôt que `like` : une clé peut contenir `_` ou `%`.
  v_prefix := v_job.idempotency_key || ':retry:';

  select count(*) + 1 into v_retry
  from private.outbox_events o
  where left(o.idempotency_key, length(v_prefix)) = v_prefix;

  update private.ingestion_jobs
  set status = 'queued',
      attempts = 0,
      available_at = now(),
      started_at = null,
      completed_at = null
  where id = p_job_id;

  -- §22.2 : l'événement part dans la même transaction que la mutation.
  insert into private.outbox_events
    (event_type, aggregate_type, aggregate_id, payload, idempotency_key)
  values
    (v_origin.event_type, v_origin.aggregate_type, v_origin.aggregate_id, v_origin.payload,
     v_prefix || v_retry::text);

  perform private.record_audit(
    'job.retry',
    'ingestion_jobs',
    p_job_id,
    jsonb_build_object(
      'jobType', v_job.job_type,
      'previousAttempts', v_job.attempts,
      'retry', v_retry
    )
  );

  return v_retry;
end;
$$;

comment on function public.admin_retry_job(uuid) is
  'Relance un job failed : remis en file, tentatives a zero, evenement outbox d''origine rejoue sous une cle propre. Refuse tout autre statut, donc idempotent. Audite.';

-- ============================================================
-- 4. Banque Nutrition — valider une fiche
-- ============================================================

/*
 * `draft → validated`, et `verified_at` posé : c'est ce qui rend la fiche
 * lisible par tous via `nutrition_products__select__validated`.
 */
create or replace function public.admin_validate_nutrition_product(p_product_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.nutrition_product_status;
begin
  perform private.assert_pluka_admin('admin_validate_nutrition_product');

  select p.status into v_status
  from public.nutrition_products p
  where p.id = p_product_id
  for update;

  if not found then
    raise exception 'fiche introuvable' using errcode = 'P0002';
  end if;

  if v_status <> 'draft' then
    raise exception 'seule une fiche a verifier se valide (%)', v_status
      using errcode = '55000';
  end if;

  update public.nutrition_products
  set status = 'validated', verified_at = now()
  where id = p_product_id;

  perform private.record_audit(
    'nutrition_product.validate',
    'nutrition_products',
    p_product_id,
    jsonb_build_object('statusFrom', v_status, 'statusTo', 'validated')
  );
end;
$$;

comment on function public.admin_validate_nutrition_product(uuid) is
  'Valide une fiche draft : visible de tous les coureurs. Audite.';

-- ============================================================
-- 5. Banque Nutrition — archiver une fiche
-- ============================================================

/*
 * `draft → archived` (refuser une proposition) ou `validated → archived`
 * (retirer une fiche du catalogue). Rien n'est supprimé : une stratégie déjà
 * confirmée garde son instantané (NUTRITION_ENGINE §734), et la fiche reste
 * lisible de l'administration.
 *
 * Il n'y a pas de désarchivage : aucune spécification ne le décrit.
 */
create or replace function public.admin_archive_nutrition_product(p_product_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.nutrition_product_status;
begin
  perform private.assert_pluka_admin('admin_archive_nutrition_product');

  select p.status into v_status
  from public.nutrition_products p
  where p.id = p_product_id
  for update;

  if not found then
    raise exception 'fiche introuvable' using errcode = 'P0002';
  end if;

  if v_status = 'archived' then
    raise exception 'fiche deja archivee' using errcode = '55000';
  end if;

  update public.nutrition_products
  set status = 'archived'
  where id = p_product_id;

  perform private.record_audit(
    'nutrition_product.archive',
    'nutrition_products',
    p_product_id,
    jsonb_build_object('statusFrom', v_status, 'statusTo', 'archived')
  );
end;
$$;

comment on function public.admin_archive_nutrition_product(uuid) is
  'Archive une fiche draft (refus) ou validated (retrait du catalogue). Aucune suppression. Audite.';

-- ============================================================
-- 6. Droits d'exécution
-- ============================================================

-- `anon` est nommé explicitement : les privilèges par défaut de Supabase lui
-- accordent `execute` directement, et `revoke … from public` ne le retire pas.
revoke all on function public.admin_hide_reported_content(uuid) from public, anon;
revoke all on function public.admin_dismiss_report(uuid) from public, anon;
revoke all on function public.admin_retry_job(uuid) from public, anon;
revoke all on function public.admin_validate_nutrition_product(uuid) from public, anon;
revoke all on function public.admin_archive_nutrition_product(uuid) from public, anon;

grant execute on function public.admin_hide_reported_content(uuid) to authenticated;
grant execute on function public.admin_dismiss_report(uuid) to authenticated;
grant execute on function public.admin_retry_job(uuid) to authenticated;
grant execute on function public.admin_validate_nutrition_product(uuid) to authenticated;
grant execute on function public.admin_archive_nutrition_product(uuid) to authenticated;

commit;
