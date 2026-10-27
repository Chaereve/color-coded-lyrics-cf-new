-- Rollback for 20261219_homepage_video_limit.sql
begin;

create or replace function public.enforce_media_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(20260919, 20);
  if (select count(*) from public.media) >= 20 then
    raise exception 'err.mediaLimit';
  end if;
  return new;
end $$;
revoke all on function public.enforce_media_limit() from public;
drop trigger if exists media_limit on public.media;
create trigger media_limit before insert on public.media
for each row execute function public.enforce_media_limit();

notify pgrst, 'reload schema';
commit;
