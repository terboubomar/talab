-- Orders operations filters + detailed sales reporting.

create or replace function public.staff_order_filter_options()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_perm('orders.page.view') then
    raise exception 'not_authorized';
  end if;

  return jsonb_build_object(
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name_ar) order by b.sort, b.name_ar)
      from public.branches b
      where b.tenant_id = v_tenant
        and b.status = 'active'
        and app.can_see_branch(b.id)
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(s.source order by s.source)
      from (
        select distinct coalesce(nullif(o.source, ''), 'web') as source
        from public.orders o
        where o.tenant_id = v_tenant and app.can_see_branch(o.branch_id)
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.staff_order_filter_options() from public, anon;
grant execute on function public.staff_order_filter_options() to authenticated;

create or replace function public.staff_sales_detail_report(
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
  v_start timestamptz;
  v_end timestamptz;
  v_total bigint;
begin
  if v_tenant is null or not app.has_perm('dashboard.reports') then
    raise exception 'not_authorized';
  end if;
  if p_from is null or p_to is null or p_from > p_to or (p_to - p_from) > 366 then
    raise exception 'invalid_report_range';
  end if;
  if p_branch_id is not null and not app.can_see_branch(p_branch_id) then
    raise exception 'not_authorized';
  end if;

  v_start := (p_from::timestamp at time zone 'Asia/Riyadh');
  v_end := ((p_to + 1)::timestamp at time zone 'Asia/Riyadh');

  select count(*) into v_total
  from public.orders o
  where o.tenant_id = v_tenant
    and o.placed_at >= v_start and o.placed_at < v_end
    and app.can_see_branch(o.branch_id)
    and (p_branch_id is null or o.branch_id = p_branch_id);

  return jsonb_build_object(
    'total_rows', v_total,
    'truncated', v_total > 1000,
    'by_source', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source', x.source,
        'orders', x.orders,
        'completed_orders', x.completed_orders,
        'sales', x.sales
      ) order by x.sales desc)
      from (
        select coalesce(nullif(o.source,''),'web') source,
               count(*) orders,
               count(*) filter (where o.status='completed') completed_orders,
               coalesce(sum(o.total) filter (where o.status='completed'),0) sales
        from public.orders o
        where o.tenant_id=v_tenant and o.placed_at>=v_start and o.placed_at<v_end
          and app.can_see_branch(o.branch_id)
          and (p_branch_id is null or o.branch_id=p_branch_id)
        group by coalesce(nullif(o.source,''),'web')
      ) x
    ), '[]'::jsonb),
    'by_payment_method', coalesce((
      select jsonb_agg(jsonb_build_object(
        'payment_method', x.payment_method,
        'orders', x.orders,
        'completed_orders', x.completed_orders,
        'sales', x.sales
      ) order by x.sales desc)
      from (
        select coalesce(o.payment_method,'cash') payment_method,
               count(*) orders,
               count(*) filter (where o.status='completed') completed_orders,
               coalesce(sum(o.total) filter (where o.status='completed'),0) sales
        from public.orders o
        where o.tenant_id=v_tenant and o.placed_at>=v_start and o.placed_at<v_end
          and app.can_see_branch(o.branch_id)
          and (p_branch_id is null or o.branch_id=p_branch_id)
        group by coalesce(o.payment_method,'cash')
      ) x
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id,
        'placed_at', x.placed_at,
        'branch_name', x.branch_name,
        'customer_name', x.customer_name,
        'customer_phone', x.customer_phone,
        'order_type', x.order_type,
        'status', x.status,
        'source', x.source,
        'agent_name', x.agent_name,
        'payment_method', x.payment_method,
        'payment_status', x.payment_status,
        'subtotal', x.subtotal,
        'discount_total', x.discount_total,
        'delivery_fee', x.delivery_fee,
        'tax_total', x.tax_total,
        'total', x.total
      ) order by x.placed_at desc)
      from (
        select o.id, o.placed_at, b.name_ar branch_name,
               coalesce(c.name,'') customer_name, coalesce(c.phone,'') customer_phone,
               o.order_type::text order_type, o.status::text status,
               coalesce(nullif(o.source,''),'web') source,
               s.name agent_name,
               coalesce(o.payment_method,'cash') payment_method,
               o.payment_status::text payment_status,
               o.subtotal, o.discount_total, o.delivery_fee, o.tax_total, o.total
        from public.orders o
        join public.branches b on b.id=o.branch_id
        left join public.customers c on c.id=o.customer_id
        left join public.staff s on s.id=o.created_by_staff_id
        where o.tenant_id=v_tenant and o.placed_at>=v_start and o.placed_at<v_end
          and app.can_see_branch(o.branch_id)
          and (p_branch_id is null or o.branch_id=p_branch_id)
        order by o.placed_at desc
        limit 1000
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.staff_sales_detail_report(date,date,uuid) from public, anon;
grant execute on function public.staff_sales_detail_report(date,date,uuid) to authenticated;
