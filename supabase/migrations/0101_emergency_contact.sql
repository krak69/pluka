-- ============================================================
-- 0101 — Contact d'urgence, et son partage choisi avec l'organisation
-- ============================================================
--
-- 00_PRODUCT_SPEC §15.5 ; 03_PRIVACY_RLS §48 ; AC-ASST-09 ; décisions du
-- 2026-11-17.
--
-- LE CONTACT
--
-- Distinct de l'Assistance, gratuit (une information de sécurité, AGENTS §22).
-- Un par participation. `explicit_consent_at` (0001) atteste que la personne a
-- accepté d'être le contact d'urgence du coureur : il enregistre le numéro de
-- quelqu'un d'autre.
--
-- LE PARTAGE AVEC L'ORGANISATION
--
-- 03 §48 refuse tout accès organisation automatique, et n'admet un accès
-- futur qu'avec consentement explicite, finalité déterminée, accès restreint
-- et audit. Décision du 2026-11-17 : le coureur peut cocher « autoriser
-- l'organisation à voir ce contact, en cas d'urgence liée à cette course » ;
-- un contact à jour vaut mieux que celui d'un formulaire d'inscription rempli
-- huit mois plus tôt. Les quatre conditions :
--
-- - consentement : `organization_share_consent_at`, daté, retiré en décochant ;
-- - finalité : l'urgence liée à cette course, dite au coureur et à l'organisateur ;
-- - accès restreint : propriétaire et admin de l'organisation de la course,
--   un contact à la fois, sur demande — jamais dans la liste ni les exports ;
-- - audit : chaque consultation écrit `private.audit_logs`.
--
-- La table elle-même ne gagne aucune policy organisation : l'accès passe par
-- `org_view_emergency_contact`, qui vérifie tout, journalise, et ne rend que
-- le nécessaire.

alter table public.emergency_contacts
  add column organization_share_consent_at timestamptz;

comment on column public.emergency_contacts.organization_share_consent_at is
  'Le coureur autorise l''organisation de la course à voir ce contact, en cas d''urgence liée à cette course (0101). Nul : aucun accès organisation.';

alter table public.emergency_contacts
  add constraint emergency_contacts_one_per_participation unique (participant_race_id),
  add constraint emergency_contacts_first_name_length
    check (char_length(btrim(first_name)) between 1 and 60),
  add constraint emergency_contacts_last_name_length
    check (last_name is null or char_length(btrim(last_name)) between 1 and 60),
  add constraint emergency_contacts_phone_length
    check (char_length(btrim(phone)) between 3 and 30),
  add constraint emergency_contacts_relationship_length
    check (relationship_label is null or char_length(btrim(relationship_label)) between 1 and 60);

-- ------------------------------------------------------------
-- Côté organisation : qui a partagé, puis un contact sur demande
-- ------------------------------------------------------------

/*
 * Les participations d'une édition dont le coureur a partagé son contact :
 * de quoi afficher le bouton « Contact d'urgence ». Ni nom ni numéro ici.
 */
create or replace function public.org_list_shared_emergency_contacts(p_edition_id uuid)
returns table (participant_race_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.user_can_manage_edition(p_edition_id, 'admin') then
    raise exception 'réservé au propriétaire et aux admins de l''organisation' using errcode = '42501';
  end if;

  return query
  select ec.participant_race_id
  from public.emergency_contacts ec
  join public.participant_races pr on pr.id = ec.participant_race_id
  join public.races r on r.id = pr.race_id
  where r.edition_id = p_edition_id
    and ec.organization_share_consent_at is not null;
end;
$$;

/*
 * Le contact d'un participant, s'il l'a partagé. Chaque appel est journalisé :
 * qui, quand, quelle participation. Rien d'autre que le contact.
 */
create or replace function public.org_view_emergency_contact(p_participant_race_id uuid)
returns table (
  first_name text,
  last_name text,
  phone text,
  relationship_label text,
  shared_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
  v_race_id uuid;
  v_contact public.emergency_contacts%rowtype;
begin
  select pr.race_id into v_race_id
  from public.participant_races pr where pr.id = p_participant_race_id;

  if v_race_id is null or not private.user_can_manage_race(v_race_id, 'admin') then
    raise exception 'réservé au propriétaire et aux admins de l''organisation' using errcode = '42501';
  end if;

  select * into v_contact
  from public.emergency_contacts ec
  where ec.participant_race_id = p_participant_race_id
    and ec.organization_share_consent_at is not null;

  if not found then
    return;
  end if;

  insert into private.audit_logs
    (actor_user_id, organization_id, action, entity_table, entity_id)
  values (
    (select auth.uid()),
    private.organization_of_race(v_race_id),
    'emergency_contact.viewed',
    'emergency_contacts',
    v_contact.id
  );

  return query
  select v_contact.first_name, v_contact.last_name, v_contact.phone,
    v_contact.relationship_label, v_contact.organization_share_consent_at;
end;
$$;

revoke all on function public.org_list_shared_emergency_contacts(uuid) from public, anon;
revoke all on function public.org_view_emergency_contact(uuid) from public, anon;
grant execute on function public.org_list_shared_emergency_contacts(uuid) to authenticated;
grant execute on function public.org_view_emergency_contact(uuid) to authenticated;
