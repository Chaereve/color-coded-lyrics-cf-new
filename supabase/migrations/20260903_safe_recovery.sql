-- Color Coded Lyrics — safe recovery/migration
--
-- Run this in Supabase SQL Editor when the app reports PGRST205 for `media`,
-- or when the project was created from an older version of schema.sql.
-- This migration is intentionally additive: it does not drop, truncate, or
-- replace any user-data table. Existing requests, votes, orders and profiles
-- remain untouched.

-- Preserve custom profile fields when Supabase refreshes auth provider data.
-- The old trigger upserted Google name/avatar on every auth.users UPDATE and
-- could silently undo a user's saved profile.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles as profile (id, name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',
             new.raw_user_meta_data->>'name',
             split_part(new.email,'@',1), 'Anonymous'),
    coalesce(new.raw_user_meta_data->>'avatar_url',
             new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do update
     set name = case
       when profile.name is null or profile.name = 'Anonymous'
         then excluded.name else profile.name end,
         avatar_url = coalesce(profile.avatar_url, excluded.avatar_url);
  return new;
end $$;

create table if not exists public.media (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'video'
              check (kind in ('featured','video','playlist')),
  title       text not null,
  note        text,
  url         text not null,
  thumb       text,
  position    int not null default 0,
  is_hidden   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.media add column if not exists note text;
alter table public.media add column if not exists thumb text;
alter table public.media add column if not exists position int not null default 0;
alter table public.media add column if not exists is_hidden boolean not null default false;
create index if not exists media_kind_idx on public.media (kind, position);

create or replace function public.admin_media_save(
  p_id uuid default null,
  p_kind text default null,
  p_title text default null,
  p_note text default null,
  p_url text default null,
  p_thumb text default null,
  p_hidden boolean default null
) returns public.media
language plpgsql security definer set search_path = public as $$
declare
  v public.media;
  v_kind text;
  v_title text;
  v_url text;
  v_thumb text;
  v_pos int;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;

  v_kind := coalesce(nullif(btrim(p_kind), ''), 'video');
  v_title := left(btrim(coalesce(p_title, '')), 120);
  v_url := left(btrim(coalesce(p_url, '')), 300);
  v_thumb := nullif(btrim(coalesce(p_thumb, '')), '');

  if v_kind not in ('featured','video','playlist') then
    raise exception 'err.kindBad';
  end if;
  if length(v_title) < 2 then raise exception 'err.nameShort'; end if;
  if v_url !~* '^https?://([a-z0-9-]+\.)*(youtube\.com|youtu\.be)/' then
    raise exception 'err.mediaUrl';
  end if;
  if v_thumb is not null and v_thumb !~* '^https?://' then
    raise exception 'err.mediaThumb';
  end if;

  if p_id is null then
    select coalesce(max(position), -1) + 1 into v_pos from public.media;
    insert into public.media (kind, title, note, url, thumb, is_hidden, position)
    values (v_kind, v_title, left(btrim(coalesce(p_note, '')), 200), v_url,
            v_thumb, coalesce(p_hidden, false), v_pos)
    returning * into v;
  else
    update public.media
       set kind = v_kind,
           title = v_title,
           note = left(btrim(coalesce(p_note, '')), 200),
           url = v_url,
           thumb = v_thumb,
           is_hidden = coalesce(p_hidden, is_hidden),
           updated_at = now()
     where id = p_id
    returning * into v;
    if v.id is null then raise exception 'err.mediaMissing'; end if;
  end if;
  return v;
end $$;

create or replace function public.admin_media_delete(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  delete from public.media where id = p_id;
end $$;

create or replace function public.admin_media_reorder(p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_i int := 0;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  if p_ids is null then return; end if;
  foreach v_id in array p_ids loop
    update public.media set position = v_i, updated_at = now() where id = v_id;
    v_i := v_i + 1;
  end loop;
end $$;

alter table public.media enable row level security;
drop policy if exists "read media" on public.media;
create policy "read media" on public.media for select
  using (not is_hidden or public.is_admin());

grant select on public.media to anon, authenticated;
grant execute on function public.admin_media_save(uuid,text,text,text,text,text,boolean) to authenticated;
grant execute on function public.admin_media_delete(uuid) to authenticated;
grant execute on function public.admin_media_reorder(uuid[]) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.media;
exception when duplicate_object then null;
end $$;

-- Refresh PostgREST's schema cache without touching rows.
notify pgrst, 'reload schema';
