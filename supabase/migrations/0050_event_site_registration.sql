-- PLUKA V1 — Le site de l'événement : l'inscription s'enregistre avec le reste
-- File target: supabase/migrations/0050_event_site_registration.sql
-- Référence : docs/features/EVENT_SITE.md §5 · migration 0049
--
-- L'éditeur du site (`/org/[id]/parametres/site`) enregistre en un geste
-- l'identité, le contact, les blocs de texte et les liens d'inscription. Les
-- écrire en deux appels laisserait un enregistrement à moitié fait quand le
-- second échoue. `save_event_site` (0049) prend donc trois paramètres de
-- plus, facultatifs : un appel de 0049 garde le même sens.
--
-- `p_edition_id` nul : les liens d'inscription ne sont pas touchés.
-- `p_race_registration_urls` : tableau de `{raceId, url}`, `url` nul retirant
-- le lien propre de l'épreuve. Une épreuve hors de l'édition est refusée.

begin;

drop function if exists public.save_event_site(uuid, text, text, text, jsonb);

create or replace function public.save_event_site(
  p_event_id uuid,
  p_accent_color text,
  p_heading_font text,
  p_contact_email text,
  p_sections jsonb,
  p_edition_id uuid default null,
  p_edition_registration_url text default null,
  p_race_registration_urls jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := private.assert_can_edit_event_site(p_event_id, 'editor');
  v_section jsonb;
  v_item jsonb;
  v_race_id uuid;
begin
  if jsonb_typeof(p_sections) is distinct from 'array' then
    raise exception 'blocs de texte attendus en tableau' using errcode = '22023';
  end if;

  if jsonb_array_length(p_sections) > 20 then
    raise exception 'TOO_MANY_SECTIONS' using errcode = '22023';
  end if;

  for v_section in select * from jsonb_array_elements(p_sections) loop
    if jsonb_typeof(v_section -> 'title') is distinct from 'string'
      or jsonb_typeof(v_section -> 'body') is distinct from 'string' then
      raise exception 'bloc de texte invalide' using errcode = '22023';
    end if;
  end loop;

  if p_edition_id is not null then
    if not exists (
      select 1 from public.editions ed where ed.id = p_edition_id and ed.event_id = p_event_id
    ) then
      raise exception 'édition hors de l''événement' using errcode = '22023';
    end if;

    if p_race_registration_urls is not null then
      if jsonb_typeof(p_race_registration_urls) is distinct from 'array' then
        raise exception 'liens d''épreuve attendus en tableau' using errcode = '22023';
      end if;

      for v_item in select * from jsonb_array_elements(p_race_registration_urls) loop
        v_race_id := (v_item ->> 'raceId')::uuid;
        if not exists (
          select 1 from public.races r where r.id = v_race_id and r.edition_id = p_edition_id
        ) then
          raise exception 'épreuve hors de l''édition' using errcode = '22023';
        end if;
      end loop;
    end if;
  end if;

  insert into public.event_sites (event_id, accent_color, heading_font, contact_email, updated_by_user_id)
  values (p_event_id, lower(nullif(btrim(p_accent_color), '')), nullif(p_heading_font, ''),
          nullif(btrim(p_contact_email), ''), (select auth.uid()))
  on conflict (event_id) do update set
    accent_color = excluded.accent_color,
    heading_font = excluded.heading_font,
    contact_email = excluded.contact_email,
    updated_by_user_id = excluded.updated_by_user_id;

  delete from public.event_site_sections s where s.event_id = p_event_id;

  insert into public.event_site_sections (event_id, title, body, sort_order)
  select p_event_id, btrim(item ->> 'title'), btrim(item ->> 'body'), (ordinality - 1)::smallint
  from jsonb_array_elements(p_sections) with ordinality as t(item, ordinality);

  if p_edition_id is not null then
    update public.editions ed
    set registration_url = nullif(btrim(p_edition_registration_url), '')
    where ed.id = p_edition_id
      and ed.registration_url is distinct from nullif(btrim(p_edition_registration_url), '');

    if p_race_registration_urls is not null then
      update public.races r
      set registration_url = nullif(btrim(item ->> 'url'), '')
      from jsonb_array_elements(p_race_registration_urls) as t(item)
      where r.id = (item ->> 'raceId')::uuid
        and r.registration_url is distinct from nullif(btrim(item ->> 'url'), '');
    end if;
  end if;

  insert into private.audit_logs (actor_user_id, organization_id, action, entity_table, entity_id, after_data)
  values ((select auth.uid()), v_organization_id, 'event_site.save', 'event_sites', p_event_id,
          jsonb_build_object('sections', jsonb_array_length(p_sections),
                             'accentColor', p_accent_color, 'headingFont', p_heading_font,
                             'editionId', p_edition_id,
                             'editionRegistrationUrl', p_edition_registration_url,
                             'raceRegistrationUrls', p_race_registration_urls));
end;
$$;

comment on function public.save_event_site(uuid, text, text, text, jsonb, uuid, text, jsonb) is
  'Identité, contact, blocs de texte et liens d''inscription d''un site, en une transaction (EVENT_SITE §4, §5). Owner, admin, editor ou admin PLUKA.';

revoke all on function public.save_event_site(uuid, text, text, text, jsonb, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_event_site(uuid, text, text, text, jsonb, uuid, text, jsonb)
  to authenticated;

commit;
