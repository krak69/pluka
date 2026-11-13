-- PLUKA — L'offre PLUKA+, pour l'écran de choix
-- Référence : docs/00_PRODUCT_SPEC.md §6.3 · docs/04_ENTITLEMENTS.md §72 · migration 0088
--
-- L'écran d'offre montre PLUKA+ à côté du Race Pass (prototype, écran `offre`).
-- Son prix vit dans `billing_products` comme les autres (0088 : jamais dans le
-- code), et ce catalogue reste fermé au client. Cette fonction en lit une ligne,
-- plus le fait que le coureur a déjà un PLUKA+ actif.
--
-- Lecture seule : PLUKA+ n'est pas encore en vente (05_ROUTES_FLOWS §12.8),
-- rien ici n'ouvre d'achat.

create function public.get_plus_offer()
returns table (
  amount_minor integer,
  currency text,
  active boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'session requise' using errcode = '42501';
  end if;

  return query
  select
    (select p.amount_minor from public.billing_products p
     where p.product_key = 'plus_annual' and p.active),
    (select p.currency::text from public.billing_products p
     where p.product_key = 'plus_annual'),
    exists (
      select 1 from public.entitlements e
      where e.user_id = (select auth.uid()) and e.status = 'active'
        and e.kind = 'plus' and (e.ends_at is null or e.ends_at > now()));
end;
$$;

comment on function public.get_plus_offer() is
  'L''offre PLUKA+ du coureur de la session : prix du catalogue (nul si le produit est inactif) et PLUKA+ déjà actif. Lecture seule (0090).';

revoke all on function public.get_plus_offer() from public, anon;
grant execute on function public.get_plus_offer() to authenticated;
