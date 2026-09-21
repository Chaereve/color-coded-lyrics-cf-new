-- Short community comments under requests.
-- Deliberately separate from requests so comments can be moderated without
-- mutating vote/request data.
create table if not exists public.request_comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 180),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists request_comments_request_created_idx
  on public.request_comments (request_id, created_at desc);

alter table public.request_comments enable row level security;

drop policy if exists request_comments_public_read on public.request_comments;
create policy request_comments_public_read
  on public.request_comments for select
  using (deleted_at is null);

drop policy if exists request_comments_authenticated_insert on public.request_comments;
create policy request_comments_authenticated_insert
  on public.request_comments for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists request_comments_owner_delete on public.request_comments;
create policy request_comments_owner_delete
  on public.request_comments for delete
  to authenticated
  using (auth.uid() = user_id or public.is_admin());

grant select on public.request_comments to anon, authenticated;
grant insert, delete on public.request_comments to authenticated;
