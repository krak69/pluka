-- PLUKA V1 — Le site de l'événement : la liste des documents de l'éditeur
-- File target: supabase/migrations/0053_event_site_documents.sql
-- Référence : docs/features/EVENT_SITE.md §8 · docs/03_PRIVACY_RLS.md §84
--
-- POURQUOI
--
-- L'éditeur lisait `sources` directement, sous la session du membre. Mais
-- `authenticated` n'a sur cette table qu'un `select` par colonnes, qui exclut
-- `storage_path` et `public_download_at` : la requête était refusée et la page
-- Paramètres › Site ne s'ouvrait pas.
--
-- Le chemin du fichier reste fermé à dessein. On n'ouvre donc pas la colonne :
-- cette fonction dit aux membres de l'organisation si un fichier existe, et
-- jamais où il se trouve. Tout membre la lit, viewer compris : il voit le même
-- écran que les autres, champs désactivés.

begin;

create function public.event_site_documents(p_edition_id uuid)
returns table (
  id uuid,
  title text,
  source_type public.source_type,
  has_file boolean,
  url text,
  public_download_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    private.user_is_org_member(private.organization_of_edition(p_edition_id))
    or private.is_pluka_admin()
  ) then
    raise exception 'documents réservés aux membres de l''organisation' using errcode = '42501';
  end if;

  return query
  select s.id, s.title, s.source_type, s.storage_path is not null, s.url, s.public_download_at
  from public.sources s
  where s.edition_id = p_edition_id
    and s.status <> 'archived'
    and s.source_type <> 'gpx'
  order by s.title;
end;
$$;

revoke all on function public.event_site_documents(uuid) from public, anon, authenticated;
grant execute on function public.event_site_documents(uuid) to authenticated;

commit;
