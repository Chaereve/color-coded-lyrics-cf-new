-- Color Coded Lyrics — security audit hardening (2026-09-22)
--
-- Additive and rerunnable. This migration closes the reward-RPC privilege
-- escalation, makes achievement rewards server-authoritative and idempotent,
-- consumes free paid-request rewards atomically, validates avatar URLs, fixes
-- reply ownership checks, and adds a small server-side comment rate limit.
-- No user-data table is dropped or truncated.

begin;

-- =========================================================
-- 1. PROFILE LEAST PRIVILEGE + AVATAR VALIDATION
-- =========================================================
-- `is_admin` is a server-side permission flag, not public profile data. The
-- client now asks the is_admin() RPC for the current user's own role.
revoke select on public.profiles from anon, authenticated;
grant select (id, name, avatar_url) on public.profiles to anon, authenticated;

alter table public.profiles
  add column if not exists bonus_requests int not null default 0;
update public.profiles set bonus_credits = 0 where bonus_credits < 0;
update public.profiles set bonus_requests = 0 where bonus_requests < 0;
alter table public.profiles
  drop constraint if exists profiles_bonus_credits_nonneg;
alter table public.profiles
  add constraint profiles_bonus_credits_nonneg check (bonus_credits >= 0);
alter table public.profiles
  drop constraint if exists profiles_bonus_requests_nonneg;
alter table public.profiles
  add constraint profiles_bonus_requests_nonneg check (bonus_requests >= 0);

create or replace function public.update_my_profile(p_name text, p_avatar text default null)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  pr public.profiles;
begin
  if v_uid is null then raise exception 'err.signin'; end if;

  v_name := left(btrim(coalesce(p_name,'')), 40);
  if length(v_name) < 2 then raise exception 'err.nameShort'; end if;

  -- Only Google/Cloudinary HTTPS URLs or our own processed base64 raster
  -- images are accepted. SVG/HTML/javascript/data URLs cannot be stored.
  if p_avatar is not null and
     p_avatar !~* '^https://([a-z0-9-]+\.)*(googleusercontent\.com|cloudinary\.com)/' and
     p_avatar !~* '^data:image/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$' then
    raise exception 'err.avatarType';
  end if;
  if p_avatar is not null and length(p_avatar) > 200000 then
    raise exception 'err.avatarBig';
  end if;

  update public.profiles
     set name = v_name, avatar_url = p_avatar
   where id = v_uid
  returning * into pr;

  if pr.id is null then raise exception 'err.signin'; end if;
  update public.requests set requester = v_name where user_id = v_uid;
  return pr;
end $$;

revoke all on function public.update_my_profile(text,text) from public, anon, authenticated;
grant execute on function public.update_my_profile(text,text) to authenticated;

-- Keep admin progress input within the invariant used by the UI and reports.
update public.requests set progress = greatest(0, least(100, progress)) where progress < 0 or progress > 100;
alter table public.requests drop constraint if exists requests_progress_range;
alter table public.requests add constraint requests_progress_range check (progress between 0 and 100);

-- =========================================================
-- 2. ACTIVITY PRIVACY: OWNER RAW DAYS, PUBLIC AGGREGATES
-- =========================================================
-- Public profiles need streak totals, not the exact calendar of another user.
-- Keep raw dates for the owner/achievement engine and expose only aggregates.
drop policy if exists "read activity days"
  on public.activity_days;

drop policy if exists "read own activity days"
  on public.activity_days;

create policy "read own activity days"
  on public.activity_days
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
  );

revoke select
  on public.activity_days
  from anon, authenticated;

grant select
  on public.activity_days
  to authenticated;

create or replace function public.public_streak(p_user_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_latest date;
  v_current int := 0;
  v_longest int := 0;
  v_earned jsonb;
begin
  if p_user_id is null then return jsonb_build_object('current', 0, 'longest', 0, 'earned', '[]'::jsonb); end if;
  select max(day) into v_latest from public.activity_days where user_id = p_user_id;

  select coalesce(max(run_len), 0)::int into v_longest
    from (
      select count(*)::int as run_len
        from (
          select day, day - (row_number() over (order by day))::int as grp
            from public.activity_days where user_id = p_user_id
        ) grouped
       group by grp
    ) runs;

  if v_latest is not null and v_latest >= v_today - 1 then
    select count(*)::int into v_current
      from (
        select day, day + (row_number() over (order by day desc))::int as grp
          from public.activity_days where user_id = p_user_id
      ) tail
     where grp = v_latest + 1;
  end if;

  select coalesce(jsonb_agg(m order by m), '[]'::jsonb) into v_earned
    from unnest(array[7, 30, 100]) as m where m <= v_longest;
  return jsonb_build_object('current', v_current, 'longest', v_longest, 'earned', v_earned);
end $$;
revoke all on function public.public_streak(uuid) from public, anon, authenticated;
grant execute on function public.public_streak(uuid) to anon, authenticated;

-- =========================================================
-- 3. COMMENTS: SAME-REQUEST REPLIES + ANTI-SPAM
-- =========================================================
-- The old unqualified `request_id = request_id` was tautological inside the
-- subquery. Qualify the outer table so a reply cannot attach across requests.
drop policy if exists request_comments_authenticated_insert on public.request_comments;
create policy request_comments_authenticated_insert
  on public.request_comments for insert to authenticated
  with check (
    auth.uid() = user_id
    and (
      parent_id is null
      or exists (
        select 1 from public.request_comments p
         where p.id = request_comments.parent_id
           and p.request_id = request_comments.request_id
      )
    )
  );

create or replace function public.enforce_comment_limits()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- The RLS policy remains the authority for identity. This lock only makes
  -- count-then-insert deterministic across several tabs of one account.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 20260922));
  if (
    select count(*) from public.request_comments
     where user_id = new.user_id
       and created_at >= now() - interval '1 minute'
  ) >= 10 then
    raise exception 'err.commentRate';
  end if;
  if new.parent_id is not null and not exists (
    select 1 from public.request_comments p
     where p.id = new.parent_id and p.request_id = new.request_id
  ) then
    raise exception 'err.commentParent';
  end if;
  return new;
end $$;

revoke all on function public.enforce_comment_limits() from public, anon, authenticated;
drop trigger if exists request_comments_limits on public.request_comments;
create trigger request_comments_limits
  before insert on public.request_comments
  for each row execute function public.enforce_comment_limits();

-- At most five parsed mentions per comment prevents a short message from
-- becoming a notification fan-out attack.
create or replace function public.notify_on_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_req public.requests;
  v_parent public.request_comments;
  v_author text;
  v_mentioned record;
  v_mentions int := 0;
begin
  select name into v_author from public.profiles where id = NEW.user_id;
  v_author := coalesce(v_author, 'Member');
  select * into v_req from public.requests where id = NEW.request_id;

  if NEW.parent_id is null then
    if v_req.user_id is not null and v_req.user_id <> NEW.user_id then
      insert into public.notifications(user_id, song_key, kind, request_id, title, artist, reason, sig)
      values (v_req.user_id, public.song_key(v_req.artist, v_req.title), 'comment',
              v_req.id, v_req.title, v_req.artist,
              v_author || ': ' || left(NEW.body, 120), 'comment|' || NEW.id::text)
      on conflict (user_id, sig) where sig is not null do nothing;
    end if;
  else
    select * into v_parent from public.request_comments where id = NEW.parent_id;
    if v_parent.user_id is not null and v_parent.user_id <> NEW.user_id then
      insert into public.notifications(user_id, song_key, kind, request_id, title, artist, reason, sig)
      values (v_parent.user_id, public.song_key(v_req.artist, v_req.title), 'reply',
              v_req.id, v_req.title, v_req.artist,
              v_author || ' replied: ' || left(NEW.body, 120), 'reply|' || NEW.id::text)
      on conflict (user_id, sig) where sig is not null do nothing;
    end if;
  end if;

  for v_mentioned in
    select id, name from public.profiles
     where id <> NEW.user_id
       and (
         position('@' || lower(name) in lower(NEW.body)) > 0
         or position('@' || lower(replace(name, ' ', '')) in lower(NEW.body)) > 0
       )
     order by id
     limit 5
  loop
    v_mentions := v_mentions + 1;
    insert into public.notifications(user_id, song_key, kind, request_id, title, artist, reason, sig)
    values (v_mentioned.id, public.song_key(v_req.artist, v_req.title), 'mention',
            v_req.id, v_req.title, v_req.artist,
            v_author || ' mentioned you: ' || left(NEW.body, 120),
            'mention|' || NEW.id::text || '|' || v_mentioned.id::text)
    on conflict (user_id, sig) where sig is not null do nothing;
  end loop;
  return NEW;
end $$;

revoke all on function public.notify_on_comment() from public, anon, authenticated;
drop trigger if exists tr_notify_on_comment on public.request_comments;
create trigger tr_notify_on_comment after insert on public.request_comments
  for each row execute function public.notify_on_comment();

-- =========================================================
-- 3. SEASON REWARD PRIVILEGE ESCALATION
-- =========================================================
-- A normal authenticated user used to be able to call this low-level helper
-- directly with an arbitrary user_id and amount. Only the trusted scheduler
-- may call it; the public admin entry point remains settle_current_season_rewards.
create or replace function public.grant_season_reward(
  p_user_id text,
  p_bonus_votes int default 0,
  p_bonus_requests int default 0,
  p_title text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_target uuid;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'err.adminOnly';
  end if;
  if coalesce(p_bonus_votes, 0) < 0 or coalesce(p_bonus_requests, 0) < 0
     or coalesce(p_bonus_votes, 0) > 1000 or coalesce(p_bonus_requests, 0) > 100 then
    raise exception 'err.rewardInvalid';
  end if;
  v_target := p_user_id::uuid;

  update public.profiles
     set bonus_credits = bonus_credits + coalesce(p_bonus_votes, 0),
         bonus_requests = bonus_requests + coalesce(p_bonus_requests, 0)
   where id = v_target;
  if not found then raise exception 'err.requestMissing'; end if;

  if coalesce(p_bonus_votes, 0) > 0 or coalesce(p_bonus_requests, 0) > 0 then
    insert into public.notifications(user_id, song_key, kind, title, reason, sig)
    values (
      v_target, 'season-reward', 'votes', 'Season Reward: ' || coalesce(p_title, 'Top Rank'),
      'You earned ' || coalesce(p_bonus_votes, 0) || ' bonus votes' ||
        case when coalesce(p_bonus_requests, 0) > 0
             then ' and ' || p_bonus_requests || ' bonus request!' else '!' end,
      'reward|' || v_target::text || '|' || coalesce(p_title, 'Top Rank')
    ) on conflict (user_id, sig) where sig is not null do nothing;
  end if;
end $$;

revoke all on function public.grant_season_reward(text,int,int,text) from public, anon, authenticated;
grant execute on function public.grant_season_reward(text,int,int,text) to service_role;

create table if not exists public.season_rewards_log (
  id uuid primary key default gen_random_uuid(),
  season_type text not null check (season_type in ('week', 'month')),
  period_key text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rank int not null check (rank between 1 and 3),
  bonus_votes int not null default 0 check (bonus_votes >= 0),
  bonus_requests int not null default 0 check (bonus_requests >= 0),
  title text,
  created_at timestamptz not null default now(),
  constraint uq_season_rewards_rank unique (season_type, period_key, rank),
  constraint uq_season_rewards_user unique (season_type, period_key, user_id)
);
create index if not exists idx_season_rewards_user on public.season_rewards_log(user_id);
alter table public.season_rewards_log enable row level security;
drop policy if exists season_rewards_public_read on public.season_rewards_log;
create policy season_rewards_public_read on public.season_rewards_log for select using (true);
grant select on public.season_rewards_log to anon, authenticated;

create or replace function public.settle_season_rewards(
  p_season_type text, p_period_key text,
  p_start timestamptz, p_end timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_winners record;
  v_rank int := 1;
  v_votes int;
  v_reqs int;
  v_title text;
  v_results jsonb := '[]'::jsonb;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'err.adminOnly';
  end if;
  if p_season_type not in ('week', 'month') or p_start is null or p_end is null or p_start >= p_end then
    raise exception 'err.rewardPeriod';
  end if;

  for v_winners in (
    select r.user_id,
      count(*) filter (where r.status = 'completed') as completed_count,
      coalesce(sum(r.votes), 0) as total_votes,
      count(*) as total_submitted,
      min(r.created_at) as earliest_request
      from public.requests r
     where r.user_id is not null and r.status <> 'denied'
       and ((r.status = 'completed' and coalesce(r.updated_at, r.created_at) >= p_start
             and coalesce(r.updated_at, r.created_at) < p_end)
         or (r.created_at >= p_start and r.created_at < p_end))
     group by r.user_id
     order by completed_count desc, total_votes desc, total_submitted desc,
              earliest_request asc, r.user_id asc
     limit 3
  ) loop
    if p_season_type = 'week' then
      if v_rank = 1 then v_votes := 15; v_reqs := 0; v_title := 'Weekly #1 Winner';
      elsif v_rank = 2 then v_votes := 10; v_reqs := 0; v_title := 'Weekly #2 Winner';
      else v_votes := 5; v_reqs := 0; v_title := 'Weekly #3 Winner'; end if;
    else
      if v_rank = 1 then v_votes := 50; v_reqs := 1; v_title := 'Monthly Champion';
      elsif v_rank = 2 then v_votes := 30; v_reqs := 0; v_title := 'Monthly Runner-up';
      else v_votes := 20; v_reqs := 0; v_title := 'Monthly #3 Winner'; end if;
    end if;

    insert into public.season_rewards_log
      (season_type, period_key, user_id, rank, bonus_votes, bonus_requests, title)
    values (p_season_type, p_period_key, v_winners.user_id, v_rank,
            v_votes, v_reqs, v_title)
    on conflict on constraint uq_season_rewards_rank do nothing;
    if found then
      perform public.grant_season_reward(v_winners.user_id::text, v_votes, v_reqs, v_title);
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rank', v_rank, 'user_id', v_winners.user_id,
        'bonus_votes', v_votes, 'bonus_requests', v_reqs, 'title', v_title));
    end if;
    v_rank := v_rank + 1;
  end loop;
  return v_results;
end $$;

revoke all on function public.settle_season_rewards(text,text,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.settle_season_rewards(text,text,timestamptz,timestamptz)
  to service_role;

create or replace function public.settle_current_season_rewards(p_season_type text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_now_vn timestamp := timezone('Asia/Ho_Chi_Minh', now());
  v_key text;
  v_start timestamptz;
  v_end timestamptz;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'err.adminOnly';
  end if;
  if p_season_type = 'week' then
    v_key := to_char(v_now_vn, 'IYYY-"W"IW');
    v_start := (date_trunc('week', v_now_vn) at time zone 'Asia/Ho_Chi_Minh');
    v_end := v_start + interval '7 days';
  elsif p_season_type = 'month' then
    v_key := to_char(v_now_vn, 'YYYY-MM');
    v_start := (date_trunc('month', v_now_vn) at time zone 'Asia/Ho_Chi_Minh');
    v_end := v_start + interval '1 month';
  else
    raise exception 'err.rewardPeriod';
  end if;
  return public.settle_season_rewards(p_season_type, v_key, v_start, v_end);
end $$;

revoke all on function public.settle_current_season_rewards(text)
  from public, anon, authenticated;
grant execute on function public.settle_current_season_rewards(text) to authenticated, service_role;

-- =========================================================
-- 4. PAYMENT ORDER QUEUE CAP
-- =========================================================
-- Payment is manual (there is no webhook in this repository). Keep the order
-- endpoint from being used to flood the admin queue, and serialize the count.
create or replace function public.buy_votes(p_pack text, p_qty int, p_usd numeric, p_vnd int)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_waiting int;
  o public.orders;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if p_qty <= 0 or p_qty > 100 then raise exception 'err.qty'; end if;
  if not (
    (p_pack = 'v3' and p_qty = 3 and p_usd = 0.49 and p_vnd = 13000) or
    (p_pack = 'v10' and p_qty = 10 and p_usd = 1.29 and p_vnd = 34000) or
    (p_pack = 'v30' and p_qty = 30 and p_usd = 2.99 and p_vnd = 78000) or
    (p_pack = 'custom' and p_usd = round(0.19 * p_qty, 2) and p_vnd = 5000 * p_qty)
  ) then raise exception 'err.priceChanged'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 20260924));
  select count(*) into v_waiting from public.orders
   where user_id = v_uid and kind = 'votes' and status = 'awaiting';
  if v_waiting >= 20 then raise exception 'err.orderQueueLimit'; end if;

  insert into public.orders (user_id, kind, pack, qty, amount_usd, amount_vnd)
  values (v_uid, 'votes', left(p_pack, 40), p_qty, p_usd, p_vnd)
  returning * into o;
  return o;
end $$;

revoke all on function public.buy_votes(text,int,numeric,int) from public, anon, authenticated;
grant execute on function public.buy_votes(text,int,numeric,int) to authenticated;

-- =========================================================
-- 5. SERVER-AUTHORITATIVE ACHIEVEMENT REWARDS
-- =========================================================
create table if not exists public.achievement_definitions (
  id             text primary key check (id ~ '^[A-Za-z][A-Za-z0-9_]{1,63}$'),
  source         text not null check (source in ('streak','requests','completed','paid','votes','leaderboard')),
  threshold      int not null check (threshold > 0),
  bonus_votes    int not null default 0 check (bonus_votes between 0 and 1000),
  bonus_requests int not null default 0 check (bonus_requests between 0 and 100),
  badge          text not null,
  active         boolean not null default true
);

create table if not exists public.achievement_rewards (
  user_id        uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null references public.achievement_definitions(id),
  bonus_votes    int not null check (bonus_votes >= 0),
  bonus_requests int not null check (bonus_requests >= 0),
  badge          text not null,
  granted_at     timestamptz not null default now(),
  primary key (user_id, achievement_id)
);
create index if not exists achievement_rewards_user_idx
  on public.achievement_rewards (user_id, granted_at desc);

alter table public.achievement_definitions enable row level security;
alter table public.achievement_rewards enable row level security;
drop policy if exists achievement_definitions_read on public.achievement_definitions;
create policy achievement_definitions_read on public.achievement_definitions
  for select using (true);
drop policy if exists achievement_rewards_read on public.achievement_rewards;
create policy achievement_rewards_read on public.achievement_rewards
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.achievement_definitions from public, anon, authenticated;
revoke insert, update, delete on public.achievement_rewards from public, anon, authenticated;
grant select on public.achievement_definitions to anon, authenticated;
grant select on public.achievement_rewards to authenticated;

insert into public.achievement_definitions
  (id, source, threshold, bonus_votes, bonus_requests, badge)
values
  ('streak3', 'streak', 3, 1, 0, 'streak3'),
  ('streak7', 'streak', 7, 3, 0, 'streak7'),
  ('streak14', 'streak', 14, 5, 0, 'streak14'),
  ('streak30', 'streak', 30, 10, 0, 'streak30'),
  ('streak60', 'streak', 60, 20, 0, 'streak60'),
  ('streak100', 'streak', 100, 35, 0, 'streak100'),
  ('streak180', 'streak', 180, 50, 0, 'streak180'),
  ('streak365', 'streak', 365, 100, 0, 'streak365'),
  ('firstRequest', 'requests', 1, 1, 0, 'firstRequest'),
  ('request3', 'requests', 3, 2, 0, 'request3'),
  ('request5', 'requests', 5, 3, 0, 'request5'),
  ('request10', 'requests', 10, 5, 0, 'request10'),
  ('request25', 'requests', 25, 10, 0, 'request25'),
  ('request50', 'requests', 50, 20, 0, 'request50'),
  ('request100', 'requests', 100, 35, 0, 'request100'),
  ('request250', 'requests', 250, 50, 0, 'request250'),
  ('firstCompletion', 'completed', 1, 0, 1, 'firstCompletion'),
  ('completion3', 'completed', 3, 3, 0, 'completion3'),
  ('completion5', 'completed', 5, 0, 1, 'completion5'),
  ('completion10', 'completed', 10, 10, 0, 'completion10'),
  ('completion25', 'completed', 25, 0, 2, 'completion25'),
  ('completion50', 'completed', 50, 30, 0, 'completion50'),
  ('completion100', 'completed', 100, 0, 3, 'completion100'),
  ('firstPaidRequest', 'paid', 1, 0, 1, 'firstPaidRequest'),
  ('paid3', 'paid', 3, 0, 1, 'paid3'),
  ('paid5', 'paid', 5, 0, 2, 'paid5'),
  ('paid10', 'paid', 10, 0, 2, 'paid10'),
  ('paid25', 'paid', 25, 0, 3, 'paid25'),
  ('paid50', 'paid', 50, 0, 5, 'paid50'),
  ('votesCast1', 'votes', 1, 1, 0, 'votesCast1'),
  ('votesCast10', 'votes', 10, 3, 0, 'votesCast10'),
  ('votesCast25', 'votes', 25, 5, 0, 'votesCast25'),
  ('votesCast50', 'votes', 50, 10, 0, 'votesCast50'),
  ('votesCast100', 'votes', 100, 20, 0, 'votesCast100'),
  ('votesCast250', 'votes', 250, 35, 0, 'votesCast250'),
  ('votesCast500', 'votes', 500, 50, 0, 'votesCast500'),
  ('votesCast1000', 'votes', 1000, 0, 2, 'votesCast1000'),
  ('top10', 'leaderboard', 10, 10, 0, 'top10'),
  ('top5', 'leaderboard', 5, 20, 0, 'top5'),
  ('podium', 'leaderboard', 3, 0, 1, 'podium'),
  ('runnerUp', 'leaderboard', 2, 30, 0, 'runnerUp'),
  ('champion', 'leaderboard', 1, 0, 3, 'champion')
on conflict (id) do update set
  source = excluded.source,
  threshold = excluded.threshold,
  bonus_votes = excluded.bonus_votes,
  bonus_requests = excluded.bonus_requests,
  badge = excluded.badge,
  active = true;

create or replace function public.claim_achievements()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_streak int := 0;
  v_requests int := 0;
  v_completed int := 0;
  v_paid int := 0;
  v_votes int := 0;
  v_rank int;
  v_progress int;
  v_earned boolean;
  v_inserted boolean;
  d record;
  v_new jsonb := '[]'::jsonb;
  p public.profiles;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  select * into p from public.profiles where id = v_uid for update;
  if p.id is null then raise exception 'err.signin'; end if;

  select coalesce(max(run_len), 0)::int into v_streak
    from (
      select count(*)::int as run_len
        from (
          select day, day - (row_number() over (order by day))::int as grp
            from public.activity_days where user_id = v_uid
        ) runs
       group by grp
    ) grouped_runs;

  select count(*)::int,
         count(*) filter (where status = 'completed')::int,
         count(*) filter (where is_paid)::int
    into v_requests, v_completed, v_paid
    from public.requests where user_id = v_uid and status <> 'denied';
  select count(*)::int into v_votes from public.votes where user_id = v_uid;

  with scores as (
    select user_id, count(*)::int as total,
           coalesce(sum(votes), 0)::int as total_votes
      from public.requests
     where status <> 'denied'
     group by user_id
  ), me as (
    select * from scores where user_id = v_uid
  )
  select case when me.user_id is null then null else
    (1 + count(*) filter (
      where s.total > me.total
         or (s.total = me.total and s.total_votes > me.total_votes)
         or (s.total = me.total and s.total_votes = me.total_votes
             and s.user_id::text < me.user_id::text)
    ))::int end
    into v_rank
    from scores s cross join me
   group by me.user_id, me.total, me.total_votes;

  for d in select * from public.achievement_definitions where active order by id loop
    v_progress := case d.source
      when 'streak' then v_streak
      when 'requests' then v_requests
      when 'completed' then v_completed
      when 'paid' then v_paid
      when 'votes' then v_votes
      when 'leaderboard' then coalesce(v_rank, 0)
      else 0 end;
    v_earned := case when d.source = 'leaderboard'
      then v_rank is not null and v_rank <= d.threshold
      else v_progress >= d.threshold end;

    if v_earned then
      insert into public.achievement_rewards
        (user_id, achievement_id, bonus_votes, bonus_requests, badge)
      values (v_uid, d.id, d.bonus_votes, d.bonus_requests, d.badge)
      on conflict (user_id, achievement_id) do nothing;
      v_inserted := found;
      if v_inserted then
        update public.profiles
           set bonus_credits = bonus_credits + d.bonus_votes,
               bonus_requests = bonus_requests + d.bonus_requests
         where id = v_uid;
      end if;
      v_new := v_new || jsonb_build_array(jsonb_build_object(
        'id', d.id, 'progress', v_progress, 'need', d.threshold,
        'badge', d.badge, 'bonus_votes', d.bonus_votes,
        'bonus_requests', d.bonus_requests, 'newly_granted', v_inserted
      ));
    end if;
  end loop;

  select * into p from public.profiles where id = v_uid;
  return jsonb_build_object(
    'earned', v_new,
    'bonus_credits', p.bonus_credits,
    'purchased', p.vote_credits,
    'credits', p.vote_credits + p.bonus_credits,
    'bonus_requests', p.bonus_requests
  );
end $$;

revoke all on function public.claim_achievements() from public, anon, authenticated;
grant execute on function public.claim_achievements() to authenticated;

-- =========================================================
-- 5. FREE PAID REQUEST REDEMPTION (ATOMIC)
-- =========================================================
drop function if exists public.create_request(text,text,text,text,text,boolean);
create or replace function public.create_request(
  p_kind text, p_artist text, p_title text,
  p_link text, p_note text, p_paid boolean default false,
  p_use_bonus boolean default false
) returns public.requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_cnt int;
  v_bonus_requests int;
  r public.requests;
begin
  if v_uid is null then raise exception 'err.requestAuth'; end if;
  if length(trim(coalesce(p_artist,''))) = 0 or length(trim(coalesce(p_title,''))) = 0 then
    raise exception 'err.needFields';
  end if;
  if coalesce(p_use_bonus, false) and not coalesce(p_paid, false) then
    raise exception 'err.rewardType';
  end if;

  if not coalesce(p_paid, false) then
    select count(*) into v_cnt from public.requests
     where user_id = v_uid and is_paid = false
       and created_at > now() - interval '1 hour';
    if v_cnt >= 3 then raise exception 'err.rateLimit' using detail = '3'; end if;
  elsif not coalesce(p_use_bonus, false) then
    select count(*) into v_cnt from public.orders
     where user_id = v_uid and kind = 'paid_request' and status = 'awaiting';
    if v_cnt >= 5 then raise exception 'err.paidPending' using detail = '5'; end if;
  end if;

  select name, bonus_requests into v_name, v_bonus_requests
    from public.profiles where id = v_uid for update;
  if v_name is null then raise exception 'err.requestAuth'; end if;
  if coalesce(p_use_bonus, false) and coalesce(v_bonus_requests, 0) < 1 then
    raise exception 'err.noBonusRequest';
  end if;

  insert into public.requests (user_id, kind, artist, title, link, note, requester,
                               is_paid, payment_status, status)
  values (
    v_uid,
    coalesce(nullif(p_kind,''), 'Color Coded Lyrics'),
    left(trim(p_artist),120), left(trim(p_title),160),
    left(coalesce(p_link,''),500), left(coalesce(p_note,''),500),
    coalesce(v_name,'Anonymous'), coalesce(p_paid,false),
    case when p_use_bonus then 'paid' when p_paid then 'awaiting' else 'none' end,
    case when p_use_bonus then 'queued' else 'pending' end
  ) returning * into r;

  if p_use_bonus then
    update public.profiles
       set bonus_requests = bonus_requests - 1
     where id = v_uid and bonus_requests > 0;
    if not found then raise exception 'err.noBonusRequest'; end if;
  elsif p_paid then
    insert into public.orders (user_id, kind, qty, amount_usd, amount_vnd, request_id)
    values (v_uid, 'paid_request', 0, 0.75, 20000, r.id);
  end if;
  return r;
end $$;

revoke all on function public.create_request(text,text,text,text,text,boolean,boolean)
  from public, anon, authenticated;
grant execute on function public.create_request(text,text,text,text,text,boolean,boolean)
  to authenticated;

notify pgrst, 'reload schema';
commit;
