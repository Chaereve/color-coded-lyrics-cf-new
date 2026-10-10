-- Read-only monthly history for the daily box page.
-- Does not change open_mystery_box odds, caps, or the one-box-per-day rule.
begin;

create or replace function public.my_mystery_month(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_start date;
  v_end date;
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'err.signin';
  end if;
  v_start := date_trunc('month', coalesce(p_month, (
    clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date))::date;
  v_end := (v_start + interval '1 month')::date;
  return jsonb_build_object(
    'user_id', v_uid,
    'month', to_char(v_start, 'YYYY-MM'),
    'opens', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', o.day,
        'result', o.result,
        'reward_kind', o.reward_kind,
        'reward_votes', o.reward_votes,
        'reward_amount', coalesce(o.reward_amount, 0)
      ) order by o.day)
      from public.mystery_opens o
      where o.user_id = v_uid
        and o.day >= v_start
        and o.day < v_end
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.my_mystery_month(date) from public, anon, authenticated;
grant execute on function public.my_mystery_month(date) to authenticated;

comment on function public.my_mystery_month(date) is
  'Owner-scoped read of mystery_opens for one Vietnam month. No writes.';

notify pgrst, 'reload schema';
commit;
