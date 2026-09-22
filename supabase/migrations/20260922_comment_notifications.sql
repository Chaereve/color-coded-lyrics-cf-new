-- Comment & Reply & Mention Notifications + Admin Comment Moderation (2026-09-22)
--
-- Run after 20260920_request_comments.sql and 20260921_replies_request_expiry.sql.

begin;

-- =========================================================
-- 1. NOTIFICATIONS KIND CHECK
-- =========================================================
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('near','lead','approved','picked','started','progress','done','denied','votes','expired','comment','reply','mention'));

-- =========================================================
-- 2. ADMIN POLICIES FOR COMMENTS & COMMENT INDEX
-- =========================================================
-- Faster batch comment counting for homepage cards
create index if not exists idx_request_comments_req_active
  on public.request_comments (request_id)
  where deleted_at is null;

-- Admins can delete any comment for moderation; users can delete their own
drop policy if exists request_comments_owner_delete on public.request_comments;
drop policy if exists request_comments_owner_or_admin_delete on public.request_comments;
create policy request_comments_owner_or_admin_delete
  on public.request_comments for delete to authenticated
  using (auth.uid() = user_id or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

-- =========================================================
-- 3. LEADERBOARD SEASON REWARD SUPPORT & AUDIT LOG
-- =========================================================
alter table public.profiles add column if not exists bonus_requests int not null default 0;

create table if not exists public.season_rewards_log (
  id uuid primary key default gen_random_uuid(),
  season_type text not null check (season_type in ('week', 'month')),
  period_key text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rank int not null check (rank between 1 and 3),
  bonus_votes int not null default 0,
  bonus_requests int not null default 0,
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

create or replace function public.grant_season_reward(
  p_user_id text,
  p_bonus_votes int default 0,
  p_bonus_requests int default 0,
  p_title text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set bonus_credits = bonus_credits + coalesce(p_bonus_votes, 0),
         bonus_requests = coalesce(bonus_requests, 0) + coalesce(p_bonus_requests, 0)
   where id = p_user_id;

  if coalesce(p_bonus_votes, 0) > 0 or coalesce(p_bonus_requests, 0) > 0 then
    insert into public.notifications(user_id, song_key, kind, title, reason, sig)
    values (
      p_user_id,
      'season-reward',
      'votes',
      'Season Reward: ' || coalesce(p_title, 'Top Rank'),
      'You earned ' || coalesce(p_bonus_votes, 0) || ' bonus votes' ||
        case when coalesce(p_bonus_requests, 0) > 0 then ' and ' || p_bonus_requests || ' bonus request!' else '!' end,
      'reward|' || p_user_id || '|' || extract(epoch from now())::text
    ) on conflict (user_id, sig) where sig is not null do nothing;
  end if;
end $$;

grant execute on function public.grant_season_reward(text, int, int, text) to authenticated, service_role;

-- Tự động tính toán và chốt thưởng mùa (Idempotent - không bao giờ cộng trùng)
create or replace function public.settle_season_rewards(
  p_season_type text,
  p_period_key text,
  p_start timestamptz,
  p_end timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_winners record;
  v_rank int := 1;
  v_votes int;
  v_reqs int;
  v_title text;
  v_results jsonb := '[]'::jsonb;
begin
  if auth.uid() is not null and not exists (select 1 from public.profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Unauthorized';
  end if;

  for v_winners in (
    select
      r.user_id,
      count(*) filter (where r.status = 'completed') as completed_count,
      sum(r.votes) as total_votes,
      count(*) as total_submitted,
      min(r.created_at) as earliest_request
    from public.requests r
    where r.user_id is not null
      and r.status <> 'denied'
      and (
        (r.status = 'completed' and coalesce(r.updated_at, r.created_at) >= p_start and coalesce(r.updated_at, r.created_at) < p_end)
        or (r.created_at >= p_start and r.created_at < p_end)
      )
    group by r.user_id
    order by
      completed_count desc,
      total_votes desc,
      total_submitted desc,
      earliest_request asc
    limit 3
  ) loop
    if p_season_type = 'week' then
      if v_rank = 1 then v_votes := 15; v_reqs := 0; v_title := 'Weekly #1 Winner';
      elsif v_rank = 2 then v_votes := 10; v_reqs := 0; v_title := 'Weekly #2 Winner';
      elsif v_rank = 3 then v_votes := 5;  v_reqs := 0; v_title := 'Weekly #3 Winner';
      end if;
    else
      if v_rank = 1 then v_votes := 50; v_reqs := 1; v_title := 'Monthly Champion';
      elsif v_rank = 2 then v_votes := 30; v_reqs := 0; v_title := 'Monthly Runner-up';
      elsif v_rank = 3 then v_votes := 20; v_reqs := 0; v_title := 'Monthly #3 Winner';
      end if;
    end if;

    insert into public.season_rewards_log(season_type, period_key, user_id, rank, bonus_votes, bonus_requests, title)
    values (p_season_type, p_period_key, v_winners.user_id, v_rank, v_votes, v_reqs, v_title)
    on conflict on constraint uq_season_rewards_rank do nothing;

    if found then
      perform public.grant_season_reward(v_winners.user_id::text, v_votes, v_reqs, v_title);
      v_results := v_results || jsonb_build_object(
        'rank', v_rank,
        'user_id', v_winners.user_id,
        'bonus_votes', v_votes,
        'bonus_requests', v_reqs,
        'title', v_title
      );
    end if;

    v_rank := v_rank + 1;
  end loop;

  return v_results;
end $$;

grant execute on function public.settle_season_rewards(text, text, timestamptz, timestamptz) to authenticated, service_role;

-- Helper chốt theo kỳ hiện tại (Giờ VN - Asia/Ho_Chi_Minh UTC+7)
create or replace function public.settle_current_season_rewards(p_season_type text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_now_vn timestamp := timezone('Asia/Ho_Chi_Minh', now());
  v_key text;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_season_type = 'week' then
    v_key := to_char(v_now_vn, 'IYYY-"W"IW');
    v_start := (date_trunc('week', v_now_vn) at time zone 'Asia/Ho_Chi_Minh');
    v_end := v_start + interval '7 days';
  elsif p_season_type = 'month' then
    v_key := to_char(v_now_vn, 'YYYY-MM');
    v_start := (date_trunc('month', v_now_vn) at time zone 'Asia/Ho_Chi_Minh');
    v_end := v_start + interval '1 month';
  else
    raise exception 'Invalid season_type: %', p_season_type;
  end if;

  return public.settle_season_rewards(p_season_type, v_key, v_start, v_end);
end $$;

grant execute on function public.settle_current_season_rewards(text) to authenticated, service_role;

-- =========================================================
-- 4. NOTIFY ON COMMENT INSERT (Comment, Reply, Mention)
-- =========================================================
create or replace function public.notify_on_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_req public.requests;
  v_parent public.request_comments;
  v_author text;
  v_mentioned record;
begin
  select name into v_author from public.profiles where id = NEW.user_id;
  v_author := coalesce(v_author, 'Member');

  select * into v_req from public.requests where id = NEW.request_id;

  -- 1) New comment on request (notify request owner)
  if NEW.parent_id is null then
    if v_req.user_id is not null and v_req.user_id <> NEW.user_id then
      insert into public.notifications(user_id, song_key, kind, request_id, title, artist, reason, sig)
      values (
        v_req.user_id,
        public.song_key(v_req.artist, v_req.title),
        'comment',
        v_req.id,
        v_req.title,
        v_req.artist,
        v_author || ': ' || left(NEW.body, 120),
        'comment|' || NEW.id::text
      ) on conflict (user_id, sig) where sig is not null do nothing;
    end if;
  else
    -- 2) Reply to an existing comment (notify parent comment author)
    select * into v_parent from public.request_comments where id = NEW.parent_id;
    if v_parent.user_id is not null and v_parent.user_id <> NEW.user_id then
      insert into public.notifications(user_id, song_key, kind, request_id, title, artist, reason, sig)
      values (
        v_parent.user_id,
        public.song_key(v_req.artist, v_req.title),
        'reply',
        v_req.id,
        v_req.title,
        v_req.artist,
        v_author || ' replied: ' || left(NEW.body, 120),
        'reply|' || NEW.id::text
      ) on conflict (user_id, sig) where sig is not null do nothing;
    end if;
  end if;

  -- 3) Mentions @username in comment body
  for v_mentioned in
    select id, name from public.profiles
     where id <> NEW.user_id
       and (
         position('@' || lower(name) in lower(NEW.body)) > 0
         or position('@' || lower(replace(name, ' ', '')) in lower(NEW.body)) > 0
       )
  loop
    insert into public.notifications(user_id, song_key, kind, request_id, title, artist, reason, sig)
    values (
      v_mentioned.id,
      public.song_key(v_req.artist, v_req.title),
      'mention',
      v_req.id,
      v_req.title,
      v_req.artist,
      v_author || ' mentioned you: ' || left(NEW.body, 120),
      'mention|' || NEW.id::text || '|' || v_mentioned.id::text
    ) on conflict (user_id, sig) where sig is not null do nothing;
  end loop;

  return NEW;
end $$;

drop trigger if exists tr_notify_on_comment on public.request_comments;
create trigger tr_notify_on_comment
  after insert on public.request_comments
  for each row execute function public.notify_on_comment();

commit;
notify pgrst, 'reload schema';
