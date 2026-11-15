-- Owner-confirmed reclassification of nine legacy priority requests.
--
-- Before 20261224 the schema had no payment_source column. Requests funded by
-- earned request rewards (bonus_requests) were stored only as is_paid=true /
-- payment_status='paid', with no order. 20261224 deliberately did NOT guess
-- those rows: it marked them payment_source='legacy' so the UI would say
-- PAYMENT UNVERIFIED instead of inventing revenue or a reward spend.
--
-- The owner has since confirmed that exactly these nine requests were free
-- bonus paid requests. The wallet arithmetic agrees: for every affected user,
-- granted bonus_requests minus current bonus_requests equals the number of
-- legacy requests listed here. This migration therefore changes the funding
-- LABEL only. It does not create orders, does not grant credits, and does not
-- decrement bonus_requests a second time.
--
-- Safe to rerun: rows already reclassified are skipped, and the audit insert
-- only covers rows actually changed by this run. A fresh database with none of
-- these UUIDs is a no-op; a partially missing production set aborts. Any present
-- row that is no longer a paid priority request or has a live money order also
-- aborts the whole transaction. Row locks are taken BEFORE the guard so a
-- concurrent order insertion cannot slip between the check and the update.
begin;

create temp table legacy_bonus_expected (
  id uuid primary key
) on commit drop;

insert into legacy_bonus_expected (id) values
  ('596f9161-9de0-46c8-97ce-8bd86a9f47de'), -- Linda Mía — idntt
  ('602aacfc-6c08-4f05-bc8d-1665e09f8195'), -- Guilty — ChRocktikal
  ('c83afaf1-80dc-4b34-a5e8-356867f493d9'), -- Green — ChRocktikal
  ('ba31835f-a0c9-45aa-b85a-099fc406a229'), -- ¡Corre! — ChRocktikal
  ('8f07c0c1-137b-49ca-b7f7-4ce524dc7d9e'), -- BBUU! — PLAVE
  ('d1f642d5-fc7e-4ccd-8a06-ad22d9b330dd'), -- Bongsoong-a — PLAVE
  ('3cbecd66-2541-40a5-be8a-35045f7ac43f'), -- Hide and Seek (Korean Ver.) — PLAVE
  ('3a5cb17d-17ea-42d6-986b-6d7b74ede002'), -- Star Trace — PLAVE
  ('584cbc31-1d40-4179-b04b-9f0f4c2cf07f'); -- TOOTH GEM CHIWAWA — XLOV

do $$
declare
  present_count int;
  bad int;
begin
  -- Deterministic lock order; FOR UPDATE also conflicts with the KEY SHARE lock
  -- an FK-checked orders insert takes on the referenced request.
  perform r.id
    from public.requests r
    join legacy_bonus_expected e on e.id = r.id
   order by r.id
     for update of r;

  select count(*) into present_count
    from public.requests r
    join legacy_bonus_expected e on e.id = r.id;

  -- Fresh-install/test databases do not contain production UUIDs. Do not seed
  -- them. But if this is the production set, all nine must still be present.
  if present_count > 0 and present_count <> 9 then
    raise exception 'err.paymentMigrationConflict'
      using detail = 'expected 9 legacy requests, found ' || present_count;
  end if;

  select count(*) into bad
    from public.requests r
    join legacy_bonus_expected e on e.id = r.id
   where r.is_paid is distinct from true
      or r.payment_status is distinct from 'paid'
      or r.payment_source not in ('legacy', 'bonus')
      or r.payment_source is null
      or exists (
        select 1 from public.orders o
         where o.request_id = r.id
           and o.kind = 'paid_request'
           and o.status in ('awaiting', 'paid')
      );

  if bad > 0 then
    raise exception 'err.paymentMigrationConflict' using detail = bad::text;
  end if;
end $$;

with changed as (
  update public.requests r
     set payment_source = 'bonus'
    from legacy_bonus_expected e
   where r.id = e.id
     and r.payment_source = 'legacy'
     and r.is_paid = true
     and r.payment_status = 'paid'
  returning r.id, r.artist, r.title
)
insert into public.admin_actions (actor, action, target_id, label, detail)
select null, 'edit', c.id,
       left(coalesce(c.artist, '') || ' — ' || coalesce(c.title, ''), 200),
       jsonb_build_object(
         'payment_source', jsonb_build_array('legacy', 'bonus'),
         'reason', 'Owner confirmed bonus-funded legacy request',
         'migration', '20261227_legacy_bonus_reclass'
       )
  from changed c;

commit;
