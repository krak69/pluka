-- PLUKA V1 — Ma course : un fichier déjà déposé se dit
-- File target: supabase/migrations/0066_edition_file_already_added.sql
-- Référence : docs/00_PRODUCT_SPEC.md §28.2
--
-- POURQUOI
--
-- Le chemin d'un dépôt dérive du contenu : un fichier identique, même renommé,
-- retrouve sa source et ne crée rien. C'est juste, mais l'écran annonçait un
-- document ajouté et en cours d'analyse, alors qu'aucun des deux n'avait lieu. La
-- fonction dit maintenant si elle a créé quelque chose.

begin;

drop function public.add_edition_file(uuid, text, text, character, bigint, uuid);

create function public.add_edition_file(p_edition_id uuid, p_title text, p_storage_path text, p_content_hash character, p_size_bytes bigint, p_race_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_source_id uuid;
  v_organization_id uuid;
begin
  if not (private.user_can_manage_edition(p_edition_id, 'editor') or private.is_pluka_admin()) then
    raise exception 'action non autorisée sur cette édition' using errcode = '42501';
  end if;

  if p_storage_path is distinct from
     'editions/' || p_edition_id::text || '/documents/' || p_content_hash || '.pdf' then
    raise exception 'chemin de dépôt invalide' using errcode = '22023';
  end if;

  select e.organization_id into v_organization_id
  from public.editions ed join public.events e on e.id = ed.event_id
  where ed.id = p_edition_id;
  if not found then
    raise exception 'édition introuvable' using errcode = 'P0002';
  end if;

  if p_race_id is not null and not exists (
    select 1 from public.races r where r.id = p_race_id and r.edition_id = p_edition_id
  ) then
    raise exception 'épreuve hors de cette édition' using errcode = '22023';
  end if;

  select s.id into v_source_id from public.sources s
  where s.edition_id = p_edition_id and s.storage_path = p_storage_path;
  if v_source_id is not null then
    return jsonb_build_object('sourceId', v_source_id, 'created', false);
  end if;

  insert into public.sources
    (edition_id, organization_id, source_type, title, storage_path, status, created_by_user_id)
  values
    (p_edition_id, v_organization_id, 'pdf', left(btrim(p_title), 300), p_storage_path,
     'uploaded', (select auth.uid()))
  returning id into v_source_id;

  if p_race_id is not null then
    insert into public.source_race_scopes (source_id, race_id) values (v_source_id, p_race_id);
  end if;

  perform private.record_source_snapshot(
    v_source_id, p_content_hash, p_storage_path, 'application/pdf', p_size_bytes, null, null
  );

  perform private.record_audit(
    'edition.add_file', 'sources', v_source_id, jsonb_build_object('editionId', p_edition_id)
  );

  return jsonb_build_object('sourceId', v_source_id, 'created', true);
end;
$$;

revoke all on function public.add_edition_file(uuid, text, text, character, bigint, uuid) from public, anon;
grant execute on function public.add_edition_file(uuid, text, text, character, bigint, uuid) to authenticated;

commit;
