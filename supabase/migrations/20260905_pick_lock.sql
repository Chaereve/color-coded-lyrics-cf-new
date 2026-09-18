-- Color Coded Lyrics — Up next vote lock (2026-09-05)
--
-- Chay 1 lan trong Supabase SQL Editor cho project da chay schema cu.
-- Additive only: khong DROP/TRUNCATE bang nao, du lieu giu nguyen.
--
-- Nhung gi file nay them:
--   1. requests.picked_at — moc cron/admin chot vao Up next
--   2. bang settings (key 'pick') — dem nguoc lan chot ke tiep
--   3. cast_vote chan ca vote them lan rut lai khi da chot
--   4. delete_my_request chan user xoa hang da chot
--   5. ham admin_pick(p_id, p_picked) — nut Pick/Unpick trong bang Admin
--   6. admin_update tu xoa picked_at khi completed/denied

-- 1. cot picked_at -------------------------------------------------------
alter table public.requests add column if not exists picked_at timestamptz;
create index if not exists requests_picked_idx
  on public.requests (picked_at) where picked_at is not null;

-- 2. bang settings --------------------------------------------------------
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.settings enable row level security;
drop policy if exists "read settings" on public.settings;
create policy "read settings" on public.settings for select using (true);
grant select on public.settings to anon, authenticated;
insert into public.settings (key, value)
values ('pick', '{"interval_days": 4, "last_pick_at": null, "next_pick_at": null}'::jsonb)
on conflict (key) do nothing;

-- 3. cast_vote: khoa Up next ------------------------------------------------
--    (dinh nghia day du giong schema.sql de project cu duoc cap nhat)
create or replace function public.cast_vote(p_request_id uuid, p_delta int default 1)
returns table (votes int, my_votes int, free_used int, credits int)
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_new      int;
  v_free     int;
  v_credit   int;
  v_status   text;
  v_picked   timestamptz;
  v_mine     int;
  v_n        int;
  v_freeLeft int;
  v_useFree  int;
  v_useCred  int;
  v_refund   int;
begin
  if v_uid is null then raise exception 'err.voteAuth'; end if;
  if p_delta = 0 or abs(p_delta) > 100 then raise exception 'err.voteQty'; end if;

  select r.status, r.picked_at into v_status, v_picked from public.requests r where r.id = p_request_id;
  if v_status is null then raise exception 'err.requestMissing'; end if;
  if v_status not in ('queued','in_progress') then
    raise exception 'err.voteClosed';
  end if;
  -- Up next khoa vote ca hai chieu (vote them lan rut lai): so vote luc chot
  -- la con so lam viec, khong cho doi nua.
  if v_picked is not null then
    raise exception 'err.voteLocked';
  end if;

  v_n := abs(p_delta);
  select s.free_used, s.credits into v_free, v_credit from public.my_vote_status() s;

  if p_delta < 0 then
    select count(*) into v_mine from public.votes
     where request_id = p_request_id and user_id = v_uid;
    if v_mine < v_n then raise exception 'err.notVoted'; end if;

    with doomed as (
      select id, used_credit from public.votes
       where request_id = p_request_id and user_id = v_uid
       order by created_at desc, id desc
       limit v_n
    ), gone as (
      delete from public.votes v using doomed d where v.id = d.id
      returning v.used_credit
    )
    select count(*) filter (where used_credit) into v_refund from gone;

    if v_refund > 0 then
      update public.profiles set vote_credits = vote_credits + v_refund where id = v_uid;
    end if;
    update public.requests r set votes = greatest(r.votes - v_n, 0), updated_at = now()
      where r.id = p_request_id returning r.votes into v_new;
  else
    v_freeLeft := greatest(3 - v_free, 0);
    v_useFree  := least(v_n, v_freeLeft);
    v_useCred  := v_n - v_useFree;

    if v_useCred > v_credit then
      RAISE EXCEPTION 'Not enough votes. % left.', (v_freeLeft + v_credit);
    end if;

    if v_useCred > 0 then
      update public.profiles set vote_credits = vote_credits - v_useCred where id = v_uid;
    end if;

    insert into public.votes (request_id, user_id, used_credit)
    select p_request_id, v_uid, g.i > v_useFree
      from generate_series(1, v_n) as g(i);

    update public.requests r set votes = r.votes + v_n, updated_at = now()
      where r.id = p_request_id returning r.votes into v_new;
  end if;

  select count(*)::int into v_mine from public.votes
   where request_id = p_request_id and user_id = v_uid;
  select s.free_used, s.credits into v_free, v_credit from public.my_vote_status() s;
  return query select v_new, v_mine, v_free, v_credit;
end $$;

-- 4. delete_my_request: chan user xoa hang da chot --------------------------
create or replace function public.delete_my_request(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_status text; v_owner uuid; v_picked timestamptz;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  select user_id, status, picked_at into v_owner, v_status, v_picked from public.requests where id = p_id;
  if v_owner is null then raise exception 'err.requestMissing'; end if;
  if v_owner <> v_uid and not public.is_admin() then
    raise exception 'err.notOwner';
  end if;
  if v_status in ('in_progress','completed') and not public.is_admin() then
    raise exception 'err.deleteLocked';
  end if;
  -- hang da chot Up next thi khoa ca xoa (user tu xoa lam vo ke hoach lam viec)
  if v_picked is not null and not public.is_admin() then
    raise exception 'err.deleteLocked';
  end if;
  delete from public.requests where id = p_id;
end $$;

-- 5. admin_pick --------------------------------------------------------------
create or replace function public.admin_pick(p_id uuid, p_picked boolean default true)
returns public.requests language plpgsql security definer set search_path = public as $$
declare r public.requests;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  update public.requests
     set picked_at  = case when p_picked then coalesce(picked_at, now()) else null end,
         updated_at = now()
   where id = p_id
     and status in ('queued','in_progress')
  returning * into r;
  if r.id is null then raise exception 'err.requestMissing'; end if;
  return r;
end $$;
grant execute on function public.admin_pick(uuid,boolean) to authenticated;

-- 6. admin_update: xong/tu choi thi tu roi khoi Up next -----------------------
create or replace function public.admin_update(
  p_id uuid, p_status text default null, p_progress int default null, p_video_url text default null,
  p_layout boolean default null, p_lyrics boolean default null, p_edit boolean default null
) returns public.requests language plpgsql security definer set search_path = public as $$
declare r public.requests; v_pct int;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;

  update public.requests
     set status      = coalesce(p_status, status),
         video_url   = coalesce(p_video_url, video_url),
         done_layout = coalesce(p_layout, done_layout),
         done_lyrics = coalesce(p_lyrics, done_lyrics),
         done_edit   = coalesce(p_edit,   done_edit),
         updated_at  = now()
   where id = p_id
  returning * into r;

  v_pct := (case when r.done_layout then 40 else 0 end)
         + (case when r.done_lyrics then 40 else 0 end)
         + (case when r.done_edit   then 20 else 0 end);
  if p_progress is not null then v_pct := p_progress; end if;
  if r.status = 'completed' then v_pct := 100; end if;

  update public.requests set progress = v_pct where id = p_id returning * into r;

  -- xong / bi tu choi thi tu roi khoi Up next (picked_at xoa, lich su vote giu nguyen)
  if r.status in ('completed','denied') and r.picked_at is not null then
    update public.requests set picked_at = null where id = p_id returning * into r;
  end if;
  return r;
end $$;

-- Refresh PostgREST schema cache without touching rows.
notify pgrst, 'reload schema';
