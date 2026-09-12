-- TALAB · Dashboard statistics
-- Source of truth: BUILD-SPEC §2.1 Dashboard
-- 8 rolling-12-month KPI tiles + filterable daily sales chart.

create or replace function public.staff_dashboard_stats(
  p_year integer default null,
  p_month integer default null,
  p_order_type text default null,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
  v_now_riyadh timestamp := timezone('Asia/Riyadh', now());
  v_year integer := coalesce(p_year, extract(year from timezone('Asia/Riyadh', now()))::integer);
  v_month integer := coalesce(p_month, extract(month from timezone('Asia/Riyadh', now()))::integer);
  v_chart_start date;
  v_chart_end date;
  v_chart_start_ts timestamptz;
  v_chart_end_ts timestamptz;
  v_kpi_start_ts timestamptz;
  v_kpi_end_ts timestamptz;
  v_scope uuid[] := app.branch_scope();
  v_stats jsonb;
  v_chart jsonb;
  v_branches jsonb;
  v_years jsonb;
begin
  if v_tenant_id is null then raise exception 'tenant_required'; end if;
  if not app.has_perm('dashboard.stats') and not app.is_platform_admin() then
    raise exception 'not_authorized';
  end if;

  if v_month < 1 or v_month > 12 then raise exception 'invalid_month'; end if;
  if v_year < 2020 or v_year > 2100 then raise exception 'invalid_year'; end if;
  if p_order_type is not null and p_order_type not in ('delivery','pickup','curbside','dinein') then
    raise exception 'invalid_order_type';
  end if;
  if p_branch_id is not null and not app.can_see_branch(p_branch_id) then
    raise exception 'not_authorized';
  end if;

  -- KPI period: rolling 12 months through the current Riyadh moment.
  v_kpi_end_ts := now();
  v_kpi_start_ts := (v_now_riyadh - interval '12 months') at time zone 'Asia/Riyadh';

  -- Chart period: selected Riyadh calendar month.
  v_chart_start := make_date(v_year, v_month, 1);
  v_chart_end := (v_chart_start + interval '1 month')::date;
  v_chart_start_ts := v_chart_start::timestamp at time zone 'Asia/Riyadh';
  v_chart_end_ts := v_chart_end::timestamp at time zone 'Asia/Riyadh';

  select jsonb_build_object(
    'orders', count(*)::bigint,
    'completed_orders', count(*) filter (where o.status = 'completed')::bigint,
    'delivery_orders', count(*) filter (where o.order_type = 'delivery')::bigint,
    'pickup_orders', count(*) filter (where o.order_type = 'pickup')::bigint,
    'curbside_orders', count(*) filter (where o.order_type = 'curbside')::bigint,
    'dinein_orders', count(*) filter (where o.order_type = 'dinein')::bigint
  )
  into v_stats
  from public.orders o
  where o.tenant_id = v_tenant_id
    and o.placed_at >= v_kpi_start_ts
    and o.placed_at <= v_kpi_end_ts
    and app.can_see_branch(o.branch_id);

  -- For unrestricted staff, ledger KPIs represent the whole tenant.
  -- For branch-scoped staff, include only ledger movements tied to orders in visible branches,
  -- preventing aggregate leakage from other branches. Manual tenant-wide adjustments are omitted.
  v_stats := v_stats || jsonb_build_object(
    'loyalty_points', coalesce((
      select sum(greatest(pl.delta, 0))
      from public.points_ledger pl
      where pl.tenant_id = v_tenant_id
        and pl.at >= v_kpi_start_ts
        and pl.at <= v_kpi_end_ts
        and (
          cardinality(v_scope) = 0
          or (
            pl.ref_type = 'order'
            and pl.ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            and exists (
              select 1 from public.orders po
              where po.id = pl.ref_id::uuid
                and po.tenant_id = v_tenant_id
                and app.can_see_branch(po.branch_id)
            )
          )
        )
    ), 0),
    'wallet_log', coalesce((
      select count(*)
      from public.wallet_ledger wl
      where wl.tenant_id = v_tenant_id
        and wl.at >= v_kpi_start_ts
        and wl.at <= v_kpi_end_ts
        and (
          cardinality(v_scope) = 0
          or (
            wl.ref_type = 'order'
            and wl.ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            and exists (
              select 1 from public.orders wo
              where wo.id = wl.ref_id::uuid
                and wo.tenant_id = v_tenant_id
                and app.can_see_branch(wo.branch_id)
            )
          )
        )
    ), 0)
  );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'day', d.day,
      'orders', coalesce(x.orders, 0),
      'completed_orders', coalesce(x.completed_orders, 0),
      'sales', coalesce(x.sales, 0)
    ) order by d.day
  ), '[]'::jsonb)
  into v_chart
  from generate_series(v_chart_start, v_chart_end - 1, interval '1 day') d(day)
  left join lateral (
    select
      count(*)::bigint as orders,
      count(*) filter (where o.status = 'completed')::bigint as completed_orders,
      coalesce(sum(o.total) filter (where o.status = 'completed'), 0)::numeric as sales
    from public.orders o
    where o.tenant_id = v_tenant_id
      and o.placed_at >= (d.day::date::timestamp at time zone 'Asia/Riyadh')
      and o.placed_at < ((d.day::date + 1)::timestamp at time zone 'Asia/Riyadh')
      and o.placed_at >= v_chart_start_ts
      and o.placed_at < v_chart_end_ts
      and app.can_see_branch(o.branch_id)
      and (p_branch_id is null or o.branch_id = p_branch_id)
      and (p_order_type is null or o.order_type::text = p_order_type)
  ) x on true;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'name_ar', b.name_ar,
    'name_en', b.name_en
  ) order by b.sort, b.name_ar), '[]'::jsonb)
  into v_branches
  from public.branches b
  where b.tenant_id = v_tenant_id
    and b.status = 'active'
    and app.can_see_branch(b.id);

  select coalesce(jsonb_agg(y.year order by y.year desc), jsonb_build_array(v_year))
  into v_years
  from (
    select distinct extract(year from timezone('Asia/Riyadh', o.placed_at))::integer as year
    from public.orders o
    where o.tenant_id = v_tenant_id
      and app.can_see_branch(o.branch_id)
    union
    select v_year
  ) y;

  return jsonb_build_object(
    'kpi_window', jsonb_build_object(
      'from', v_kpi_start_ts,
      'to', v_kpi_end_ts
    ),
    'kpis', v_stats,
    'chart', v_chart,
    'filters', jsonb_build_object(
      'year', v_year,
      'month', v_month,
      'order_type', p_order_type,
      'branch_id', p_branch_id
    ),
    'branches', v_branches,
    'years', v_years
  );
end;
$$;

revoke all on function public.staff_dashboard_stats(integer, integer, text, uuid) from public, anon;
grant execute on function public.staff_dashboard_stats(integer, integer, text, uuid) to authenticated;
