-- PLUKA V1 — Ouvrir l'accès inclus vaut aussi pour les participants déjà activés
-- File target: supabase/migrations/0072_edition_included_retroactive.sql
-- Référence : docs/04_ENTITLEMENTS.md §12, §65, §66, §70 · migration 0069
--
-- POURQUOI
--
-- 0069 n'accordait l'Organizer Included qu'à l'activation d'une invitation :
-- ouvrir l'accès d'une édition après coup laissait de côté les participants
-- déjà sur PLUKA. Décision produit du 2026-11-09 : l'organisation qui finance
-- son édition la finance pour tous ses participants.
--
-- QUI LE REÇOIT
--
-- Les participations actives de l'édition rattachées à un compte et venues de
-- la liste de l'organisation (`invite_email` renseigné : import, invitation, ou
-- fusion d'une inscription personnelle). Un coureur inscrit seul, hors de la
-- liste, n'est pas un participant que l'organisation a choisi de financer.
--
-- FERMER NE RETIRE RIEN
--
-- §66 : « Révocation accès ≠ suppression donnée », et un accès donné reste. Fermer
-- n'atteint que les ouvertures et activations suivantes.

begin;

create or replace function public.admin_set_edition_participants_included(
  p_edition_id uuid,
  p_included boolean
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_before boolean;
  v_granted integer := 0;
begin
  if not private.is_pluka_admin() then
    raise exception 'réservé à l''équipe PLUKA' using errcode = '42501';
  end if;

  select participants_included into v_before
  from public.editions where id = p_edition_id for update;

  if not found then
    raise exception 'édition introuvable' using errcode = 'P0002';
  end if;

  if v_before = p_included then
    return;
  end if;

  update public.editions set participants_included = p_included where id = p_edition_id;

  if p_included then
    -- §70 : un seul Organizer Included actif par participation, l'index unique
    -- le garantit ; un participant déjà couvert est laissé tel quel.
    insert into public.entitlements
      (kind, source, status, scope_type, user_id, participant_race_id, organization_id, metadata)
    select
      'organizer_included', 'organization', 'active', 'participant_race',
      pr.user_id, pr.id, e.organization_id,
      jsonb_build_object('editionId', p_edition_id, 'grantedOn', 'edition_opened')
    from public.participant_races pr
    join public.races r on r.id = pr.race_id
    join public.editions ed on ed.id = r.edition_id
    join public.events e on e.id = ed.event_id
    where r.edition_id = p_edition_id
      and pr.user_id is not null
      and pr.status = 'active'
      and pr.invite_email is not null
      and e.organization_id is not null
    on conflict do nothing;

    get diagnostics v_granted = row_count;
  end if;

  perform private.record_audit(
    'edition.participants_included',
    'editions',
    p_edition_id,
    jsonb_build_object('included', p_included, 'granted', v_granted)
  );
end;
$$;

revoke all on function public.admin_set_edition_participants_included(uuid, boolean) from public, anon;
grant execute on function public.admin_set_edition_participants_included(uuid, boolean) to authenticated;

commit;
