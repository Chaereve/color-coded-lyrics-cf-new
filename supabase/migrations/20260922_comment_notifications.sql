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
-- 3. LEADERBOARD SEASON REWARD SUPPORT
-- =========================================================
alter table public.profiles add column if not exists bonus_requests int not null default 0;

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
