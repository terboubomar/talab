-- Report center support for currently implemented TALAB modules.
create or replace function public.staff_report_center_support(
  p_from date,
  p_to date,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_from timestamptz;
  v_to timestamptz;
begin
  if v_tenant is null or not app.has_perm('dashboard.reports') then raise exception 'not_authorized'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'invalid_date_range'; end if;
  if p_branch_id is not null and not app.can_see_branch(p_branch_id) then raise exception 'not_authorized'; end if;

  v_from := (p_from::timestamp at time zone 'Asia/Riyadh');
  v_to := ((p_to + 1)::timestamp at time zone 'Asia/Riyadh');

  return jsonb_build_object(
    'drivers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'driver_id', x.driver_id,
        'driver_name', x.driver_name,
        'orders', x.orders,
        'sales', x.sales,
        'last_delivery_at', x.last_delivery_at
      ) order by x.orders desc, x.driver_name)
      from (
        select s.id as driver_id, s.name as driver_name,
               count(*)::int as orders,
               coalesce(sum(o.total),0)::numeric as sales,
               max(o.delivered_at) as last_delivery_at
        from public.orders o
        join public.staff s on s.id=o.driver_id
        where o.tenant_id=v_tenant
          and o.status='completed'
          and o.driver_id is not null
          and o.placed_at>=v_from and o.placed_at<v_to
          and app.can_see_branch(o.branch_id)
          and (p_branch_id is null or o.branch_id=p_branch_id)
        group by s.id,s.name
      ) x
    ), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'customer_id', x.customer_id,
        'name', x.name,
        'phone', x.phone,
        'orders', x.orders,
        'sales', x.sales,
        'average_order_value', x.average_order_value,
        'last_order_at', x.last_order_at
      ) order by x.sales desc, x.orders desc)
      from (
        select c.id as customer_id,c.name,c.phone,
               count(*)::int as orders,
               coalesce(sum(o.total),0)::numeric as sales,
               case when count(*)=0 then 0 else round(sum(o.total)/count(*),2) end as average_order_value,
               max(o.placed_at) as last_order_at
        from public.orders o
        join public.customers c on c.id=o.customer_id
        where o.tenant_id=v_tenant
          and o.status='completed'
          and o.placed_at>=v_from and o.placed_at<v_to
          and app.can_see_branch(o.branch_id)
          and (p_branch_id is null or o.branch_id=p_branch_id)
        group by c.id,c.name,c.phone
        order by sales desc
        limit 200
      ) x
    ), '[]'::jsonb),
    'wallet_summary', (
      select jsonb_build_object(
        'movements', count(*)::int,
        'credits', coalesce(sum(case when delta>0 then delta else 0 end),0),
        'debits', abs(coalesce(sum(case when delta<0 then delta else 0 end),0)),
        'net', coalesce(sum(delta),0)
      )
      from public.wallet_ledger wl
      where wl.tenant_id=v_tenant and wl.at>=v_from and wl.at<v_to
    ),
    'wallet_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day',x.day,'credits',x.credits,'debits',x.debits,'movements',x.movements) order by x.day)
      from (
        select (wl.at at time zone 'Asia/Riyadh')::date as day,
               coalesce(sum(case when delta>0 then delta else 0 end),0) as credits,
               abs(coalesce(sum(case when delta<0 then delta else 0 end),0)) as debits,
               count(*)::int as movements
        from public.wallet_ledger wl
        where wl.tenant_id=v_tenant and wl.at>=v_from and wl.at<v_to
        group by 1
      ) x
    ), '[]'::jsonb),
    'points_summary', (
      select jsonb_build_object(
        'movements', count(*)::int,
        'awarded', coalesce(sum(case when delta>0 then delta else 0 end),0),
        'redeemed', abs(coalesce(sum(case when delta<0 then delta else 0 end),0)),
        'net', coalesce(sum(delta),0)
      )
      from public.points_ledger pl
      where pl.tenant_id=v_tenant and pl.at>=v_from and pl.at<v_to
    ),
    'points_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day',x.day,'awarded',x.awarded,'redeemed',x.redeemed,'movements',x.movements) order by x.day)
      from (
        select (pl.at at time zone 'Asia/Riyadh')::date as day,
               coalesce(sum(case when delta>0 then delta else 0 end),0) as awarded,
               abs(coalesce(sum(case when delta<0 then delta else 0 end),0)) as redeemed,
               count(*)::int as movements
        from public.points_ledger pl
        where pl.tenant_id=v_tenant and pl.at>=v_from and pl.at<v_to
        group by 1
      ) x
    ), '[]'::jsonb),
    'ledger_branch_filter_applies', false
  );
end;
$$;

revoke all on function public.staff_report_center_support(date,date,uuid) from public, anon;
grant execute on function public.staff_report_center_support(date,date,uuid) to authenticated;
