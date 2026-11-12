-- PLUKA V1 — Source d'entitlement « partner_sale »
-- File target: supabase/migrations/0085_partner_sale_source.sql
-- Référence : docs/04_ENTITLEMENTS.md §67, §73.2 · docs/00_PRODUCT_SPEC.md §6.5.5
--
-- Un Race Pass payé par le coureur, encaissé par l'organisation (canal B).
-- Seule dans sa migration : une valeur d'enum ajoutée ne peut servir qu'une
-- fois sa transaction validée, et 0086 s'en sert.

alter type public.entitlement_source add value if not exists 'partner_sale';
