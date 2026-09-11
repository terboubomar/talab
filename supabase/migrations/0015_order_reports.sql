create or replace function public.staff_order_report(
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
  v_tenant_id uuid;
  v_result jsonb;
begin
  v_tenant_id := app.current_tenant_id();

  if v_tenant_id is null then
    raise exception 'not_authorized';
  end if;

  if not app.has_perm('dashboard.reports') then
    raise exception 'not_authorized';
  end if;

  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid_date_range';
  end if;

  if p_to - p_from > 366 then
    raise exception 'date_range_too_large';
  end if;

  if p_branch_id is not null and not app.can_see_branch(p_branch_id) then
    raise exception 'not_authorized';
  end if;

  with filtered as (
    select
      o.id,
      o.branch_id,
      o.order_type,
      o.status,
      o.subtotal,
      o.tax_total,
      o.delivery_fee,
      o.discount_total,
      o.total,
      (o.placed_at at time zone 'Asia/Riyadh')::date as local_day
    from public.orders o
    where o.tenant_id = v_tenant_id
      and app.can_see_branch(o.branch_id)
      and (p_branch_id is null or o.branch_id = p_branch_id)
      and (o.placed_at at time zone 'Asia/Riyadh')::date between p_from and p_to
  ),
  summary as (
    select jsonb_build_object(
      'all_orders', count(*),
      'completed_orders', count(*) filter (where status = 'completed'),
      'cancelled_orders', count(*) filter (where status = 'cancelled'),
      'gross_sales', coalesce(sum(total) filter (where status = 'completed'), 0),
      'subtotal', coalesce(sum(subtotal) filter (where status = 'completed'), 0),
      'tax_total', coalesce(sum(tax_total) filter (where status = 'completed'), 0),
      'delivery_fees', coalesce(sum(delivery_fee) filter (where status = 'completed'), 0),
      'discounts', coalesce(sum(discount_total) filter (where status = 'completed'), 0),
      'average_order_value', coalesce(avg(total) filter (where status = 'completed'), 0),
      'cancellation_rate', case when count(*) = 0 then 0 else round((count(*) filter (where status = 'cancelled'))::numeric * 100 / count(*), 2) end
    ) as value
    from filtered
  ),
  by_day as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'day', local_day,
      'orders', orders,
      'completed_orders', completed_orders,
      'sales', sales
    ) order by local_day), '[]'::jsonb) as value
    from (
      select
        local_day,
        count(*) as orders,
        count(*) filter (where status = 'completed') as completed_orders,
        coalesce(sum(total) filter (where status = 'completed'), 0) as sales
      from filtered
      group by local_day
    ) d
  ),
  by_status as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'status', status,
      'orders', orders
    ) order by orders desc), '[]'::jsonb) as value
    from (
      select status::text as status, count(*) as orders
      from filtered
      group by status
    ) s
  ),
  by_type as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'order_type', order_type,
      'orders', orders,
      'completed_orders', completed_orders,
      'sales', sales
    ) order by sales desc), '[]'::jsonb) as value
    from (
      select
        order_type::text as order_type,
        count(*) as orders,
        count(*) filter (where status = 'completed') as completed_orders,
        coalesce(sum(total) filter (where status = 'completed'), 0) as sales
      from filtered
      group by order_type
    ) t
  ),
  by_branch as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'branch_id', branch_id,
      'branch_name', branch_name,
      'orders', orders,
      'completed_orders', completed_orders,
      'sales', sales
    ) order by sales desc), '[]'::jsonb) as value
    from (
      select
        f.branch_id,
        b.name_ar as branch_name,
        count(*) as orders,
        count(*) filter (where f.status = 'completed') as completed_orders,
        coalesce(sum(f.total) filter (where f.status = 'completed'), 0) as sales
      from filtered f
      join public.branches b on b.id = f.branch_id
      group by f.branch_id, b.name_ar
    ) b
  ),
  branches as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id,
      'name', b.name_ar
    ) order by b.name_ar), '[]'::jsonb) as value
    from public.branches b
    where b.tenant_id = v_tenant_id
      and app.can_see_branch(b.id)
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'summary', summary.value,
    'by_day', by_day.value,
    'by_status', by_status.value,
    'by_order_type', by_type.value,
    'by_branch', by_branch.value,
    'branches', branches.value
  ) into v_result
  from summary, by_day, by_status, by_type, by_branch, branches;

  return v_result;
end;
$$;

revoke all on function public.staff_order_report(date, date, uuid) from public;
revoke all on function public.staff_order_report(date, date, uuid) from anon;
grant execute on function public.staff_order_report(date, date, uuid) to authenticated;
