-- Protect pending/paid order history from request deletion.
-- cancel_my_order deletes an awaiting order first and then its linked request;
-- all other delete paths must not orphan an active payment record.
begin;

create or replace function public.prevent_request_delete_with_active_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.orders o
    where o.request_id = old.id
      and o.status in ('awaiting', 'paid')
  ) then
    raise exception 'err.requestHasActiveOrder';
  end if;
  return old;
end;
$$;

revoke all on function public.prevent_request_delete_with_active_order() from public, anon, authenticated;

drop trigger if exists requests_prevent_active_order_delete on public.requests;
create trigger requests_prevent_active_order_delete
before delete on public.requests
for each row execute function public.prevent_request_delete_with_active_order();

commit;
