-- Rollback for 20261227_legacy_bonus_reclass. Apply only after approval.
--
-- Undo the funding LABEL for the same nine UUIDs, and only while the latest
-- payment_source audit for a row is still this migration's legacy -> bonus
-- change. A genuine bonus request that was never reclassified, or a row with a
-- later funding decision, is left alone. Both audit directions are kept.
--
-- This never restores or spends a reward: the forward migration did neither.
-- It does not touch status, picked_at, votes, wallets, orders or notifications.
-- A live money order or a missing/changed target blocks the whole rollback.
begin;

create temp table legacy_bonus_rollback_scope on commit drop as
select e.id, a.id as audit_id, a.created_at as audit_at
  from (values
    ('596f9161-9de0-46c8-97ce-8bd86a9f47de'::uuid),
    ('602aacfc-6c08-4f05-bc8d-1665e09f8195'::uuid),
    ('c83afaf1-80dc-4b34-a5e8-356867f493d9'::uuid),
    ('ba31835f-a0c9-45aa-b85a-099fc406a229'::uuid),
    ('8f07c0c1-137b-49ca-b7f7-4ce524dc7d9e'::uuid),
    ('d1f642d5-fc7e-4ccd-8a06-ad22d9b330dd'::uuid),
    ('3cbecd66-2541-40a5-be8a-35045f7ac43f'::uuid),
    ('3a5cb17d-17ea-42d6-986b-6d7b74ede002'::uuid),
    ('584cbc31-1d40-4179-b04b-9f0f4c2cf07f'::uuid)
  ) as e(id)
  join lateral (
    select a.id, a.created_at, a.detail
      from public.admin_actions a
     where a.target_id = e.id
       and a.detail ? 'payment_source'
     order by a.created_at desc, a.id desc
     limit 1
  ) a on true
 where a.detail->>'migration' = '20261227_legacy_bonus_reclass'
   and a.detail->'payment_source' = '["legacy","bonus"]'::jsonb;

do $$
declare
  bad int;
begin
  perform r.id
    from public.requests r
    join legacy_bonus_rollback_scope s on s.id = r.id
   order by r.id
     for update of r;

  select count(*) into bad
    from legacy_bonus_rollback_scope s
    left join public.requests r on r.id = s.id
   where r.id is null
      or r.is_paid is distinct from true
      or r.payment_status is distinct from 'paid'
      or r.payment_source is distinct from 'bonus'
      or exists (
        select 1 from public.orders o
         where o.request_id = s.id
           and o.kind = 'paid_request'
           and o.status in ('awaiting', 'paid')
      );

  if bad > 0 then
    raise exception 'err.paymentRollbackBlocked' using detail = bad::text;
  end if;
end $$;

with changed as (
  update public.requests r
     set payment_source = 'legacy'
    from legacy_bonus_rollback_scope s
   where r.id = s.id
     and r.payment_source = 'bonus'
     and r.is_paid = true
     and r.payment_status = 'paid'
  returning r.id, r.artist, r.title
)
insert into public.admin_actions (actor, action, target_id, label, detail)
select null, 'edit', c.id,
       left(coalesce(c.artist, '') || ' — ' || coalesce(c.title, ''), 200),
       jsonb_build_object(
         'payment_source', jsonb_build_array('bonus', 'legacy'),
         'reason', 'Rollback of owner-confirmed bonus-funded legacy request',
         'migration', '20261227_legacy_bonus_reclass',
         'direction', 'rollback'
       )
  from changed c;

commit;
