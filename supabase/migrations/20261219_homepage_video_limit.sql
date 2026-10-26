-- Give the homepage 20 Latest-video slots plus its separate Featured slot.
-- Hidden Latest videos remain in the count; Featured does not consume a slot.
begin;

create or replace function public.enforce_media_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  perform pg_advisory_xact_lock(20260919, 20);
  if new.kind in ('video', 'playlist') then
    select count(*) into v_count from public.media
     where kind in ('video', 'playlist') and id is distinct from new.id;
    if v_count >= 20 then raise exception 'err.mediaLimit'; end if;
  elsif new.kind = 'featured' then
    select count(*) into v_count from public.media
     where kind = 'featured' and id is distinct from new.id;
    if v_count >= 1 then raise exception 'err.mediaFeaturedLimit'; end if;
  end if;
  return new;
end $$;
revoke all on function public.enforce_media_limit() from public;
drop trigger if exists media_limit on public.media;
create trigger media_limit before insert or update of kind on public.media
for each row execute function public.enforce_media_limit();

notify pgrst, 'reload schema';
commit;
