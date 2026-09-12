-- 0065_branch_workspace.sql
-- Project-file aligned Admin > Branches workspace.

create or replace function public.staff_branch_operations()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_tenant_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  v_tenant_id := app.current_tenant_id();
  if v_tenant_id is null and not app.is_platform_admin() then
    raise exception 'not_authorized';
  end if;

  if not app.is_platform_admin()
     and not app.has_perm('branches.view')
     and not app.has_perm('branches.busy.toggle')
     and not app.has_perm('branches.products.toggle')
     and not app.has_perm('branches.zones.manage') then
    raise exception 'not_authorized';
  end if;

  return (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'name_ar', b.name_ar,
        'name_en', b.name_en,
        'city_ar', c.name_ar,
        'city_en', c.name_en,
        'phone', b.phone,
        'busy', (b.busy_until is not null and b.busy_until > now()),
        'busy_until', b.busy_until,
        'status', b.status,
        'sort', b.sort,
        'pos_ref', b.pos_ref,
        'order_types', coalesce((
          select jsonb_agg(bot.kind order by case bot.kind
            when 'pickup' then 1 when 'delivery' then 2 when 'curbside' then 3 when 'dinein' then 4 else 99 end)
          from public.branch_order_types bot
          where bot.branch_id = b.id and bot.enabled
        ), '[]'::jsonb),
        'menu', (
          select jsonb_build_object(
            'id', m.id,
            'name_ar', m.name_ar,
            'name_en', m.name_en,
            'pos_ref', m.pos_ref,
            'is_default', m.is_default
          )
          from public.branch_menus bm
          join public.menus m on m.id = bm.menu_id and m.deleted_at is null
          where bm.branch_id = b.id
          order by m.is_default desc, m.sort, m.name_ar
          limit 1
        ),
        'zone_count', (select count(*) from public.delivery_zones dz where dz.branch_id = b.id),
        'product_count', (
          select count(*)
          from public.branch_menus bm
          join public.categories cat on cat.menu_id = bm.menu_id and cat.deleted_at is null
          join public.products p on p.category_id = cat.id and p.deleted_at is null
          where bm.branch_id = b.id
        ),
        'unavailable_product_count', (
          select count(*)
          from public.branch_menus bm
          join public.categories cat on cat.menu_id = bm.menu_id and cat.deleted_at is null
          join public.products p on p.category_id = cat.id and p.deleted_at is null
          left join public.product_branch_availability pba
            on pba.product_id = p.id and pba.branch_id = b.id
          where bm.branch_id = b.id
            and (not p.active or not p.orderable or coalesce(pba.available, true) = false)
        )
      ) order by b.sort, b.name_ar
    ), '[]'::jsonb)
    from public.branches b
    left join public.cities c on c.id = b.city_id
    where (app.is_platform_admin() or b.tenant_id = v_tenant_id)
      and app.can_see_branch(b.id)
  );
end;
$$;

create or replace function public.staff_branch_detail(p_branch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_branch_tenant uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  v_tenant_id := app.current_tenant_id();
  select b.tenant_id into v_branch_tenant
  from public.branches b
  where b.id = p_branch_id;

  if v_branch_tenant is null then
    raise exception 'branch_not_found';
  end if;

  if not app.is_platform_admin() then
    if v_tenant_id is null or v_branch_tenant <> v_tenant_id then
      raise exception 'not_authorized';
    end if;
    if not app.can_see_branch(p_branch_id) then
      raise exception 'branch_scope_denied';
    end if;
    if not app.has_perm('branches.view')
       and not app.has_perm('branches.busy.toggle')
       and not app.has_perm('branches.products.toggle')
       and not app.has_perm('branches.zones.manage') then
      raise exception 'not_authorized';
    end if;
  end if;

  return jsonb_build_object(
    'branch', (
      select jsonb_build_object(
        'id', b.id,
        'name_ar', b.name_ar,
        'name_en', b.name_en,
        'city_ar', c.name_ar,
        'city_en', c.name_en,
        'phone', b.phone,
        'lat', b.lat,
        'lng', b.lng,
        'status', b.status,
        'busy', (b.busy_until is not null and b.busy_until > now()),
        'busy_until', b.busy_until,
        'pos_ref', b.pos_ref,
        'code', b.code
      )
      from public.branches b
      left join public.cities c on c.id = b.city_id
      where b.id = p_branch_id
    ),
    'order_types', coalesce((
      select jsonb_agg(jsonb_build_object('kind', bot.kind, 'enabled', bot.enabled)
        order by case bot.kind when 'pickup' then 1 when 'delivery' then 2 when 'curbside' then 3 when 'dinein' then 4 else 99 end)
      from public.branch_order_types bot
      where bot.branch_id = p_branch_id
    ), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', bh.weekday,
        'opens_at', case when bh.opens_at is null then null else to_char(bh.opens_at, 'HH24:MI') end,
        'closes_at', case when bh.closes_at is null then null else to_char(bh.closes_at, 'HH24:MI') end,
        'is_24h', bh.is_24h,
        'closed', bh.closed
      ) order by bh.weekday)
      from public.branch_hours bh
      where bh.branch_id = p_branch_id
    ), '[]'::jsonb),
    'menu', (
      select jsonb_build_object(
        'id', m.id,
        'name_ar', m.name_ar,
        'name_en', m.name_en,
        'pos_ref', m.pos_ref,
        'is_default', m.is_default
      )
      from public.branch_menus bm
      join public.menus m on m.id = bm.menu_id and m.deleted_at is null
      where bm.branch_id = p_branch_id
      order by m.is_default desc, m.sort, m.name_ar
      limit 1
    ),
    'delivery_zones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', dz.id,
        'area_id', dz.area_id,
        'area_name_ar', a.name_ar,
        'area_name_en', a.name_en,
        'eta_minutes', dz.eta_minutes,
        'fee', dz.fee,
        'min_order', dz.min_order,
        'below_min_fee', dz.below_min_fee,
        'enabled', dz.enabled
      ) order by a.sort, a.name_ar)
      from public.delivery_zones dz
      join public.areas a on a.id = dz.area_id
      where dz.branch_id = p_branch_id
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name_ar', p.name_ar,
        'name_en', p.name_en,
        'category_ar', cat.name_ar,
        'category_en', cat.name_en,
        'active', p.active,
        'orderable', p.orderable,
        'branch_available', coalesce(pba.available, true),
        'effective_available', (p.active and p.orderable and coalesce(pba.available, true)),
        'pos_ref', p.pos_ref
      ) order by cat.sort, p.sort, p.name_ar)
      from public.branch_menus bm
      join public.categories cat on cat.menu_id = bm.menu_id and cat.deleted_at is null
      join public.products p on p.category_id = cat.id and p.deleted_at is null
      left join public.product_branch_availability pba
        on pba.product_id = p.id and pba.branch_id = p_branch_id
      where bm.branch_id = p_branch_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.staff_set_branch_product_availability(
  p_branch_id uuid,
  p_product_id uuid,
  p_available boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_branch_tenant uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select tenant_id into v_branch_tenant from public.branches where id = p_branch_id;
  if v_branch_tenant is null then raise exception 'branch_not_found'; end if;

  v_tenant_id := app.current_tenant_id();
  if not app.is_platform_admin() then
    if v_tenant_id is null or v_branch_tenant <> v_tenant_id then raise exception 'not_authorized'; end if;
    if not app.has_perm('branches.products.toggle') then raise exception 'missing_permission'; end if;
    if not app.can_see_branch(p_branch_id) then raise exception 'branch_scope_denied'; end if;
  end if;

  if not exists (
    select 1
    from public.branch_menus bm
    join public.categories cat on cat.menu_id = bm.menu_id and cat.deleted_at is null
    join public.products p on p.category_id = cat.id and p.deleted_at is null
    where bm.branch_id = p_branch_id
      and p.id = p_product_id
      and p.tenant_id = v_branch_tenant
  ) then
    raise exception 'product_not_in_branch_menu';
  end if;

  insert into public.product_branch_availability(tenant_id, product_id, branch_id, available)
  values (v_branch_tenant, p_product_id, p_branch_id, p_available)
  on conflict (product_id, branch_id)
  do update set available = excluded.available;

  return jsonb_build_object('branch_id', p_branch_id, 'product_id', p_product_id, 'available', p_available);
end;
$$;

create or replace function public.staff_update_delivery_zone(
  p_zone_id uuid,
  p_eta_minutes integer,
  p_fee numeric,
  p_min_order numeric,
  p_below_min_fee numeric,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_branch_id uuid;
  v_branch_tenant uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_eta_minutes < 0 or p_fee < 0 or p_min_order < 0 or p_below_min_fee < 0 then
    raise exception 'invalid_zone_values';
  end if;

  select dz.branch_id, dz.tenant_id into v_branch_id, v_branch_tenant
  from public.delivery_zones dz
  where dz.id = p_zone_id;
  if v_branch_id is null then raise exception 'zone_not_found'; end if;

  v_tenant_id := app.current_tenant_id();
  if not app.is_platform_admin() then
    if v_tenant_id is null or v_branch_tenant <> v_tenant_id then raise exception 'not_authorized'; end if;
    if not app.has_perm('branches.zones.manage') then raise exception 'missing_permission'; end if;
    if not app.can_see_branch(v_branch_id) then raise exception 'branch_scope_denied'; end if;
  end if;

  update public.delivery_zones
  set eta_minutes = p_eta_minutes,
      fee = p_fee,
      min_order = p_min_order,
      below_min_fee = p_below_min_fee,
      enabled = p_enabled,
      updated_at = now()
  where id = p_zone_id;

  return jsonb_build_object(
    'id', p_zone_id,
    'branch_id', v_branch_id,
    'eta_minutes', p_eta_minutes,
    'fee', p_fee,
    'min_order', p_min_order,
    'below_min_fee', p_below_min_fee,
    'enabled', p_enabled
  );
end;
$$;

revoke all on function public.staff_branch_detail(uuid) from public, anon;
revoke all on function public.staff_set_branch_product_availability(uuid, uuid, boolean) from public, anon;
revoke all on function public.staff_update_delivery_zone(uuid, integer, numeric, numeric, numeric, boolean) from public, anon;
grant execute on function public.staff_branch_detail(uuid) to authenticated;
grant execute on function public.staff_set_branch_product_availability(uuid, uuid, boolean) to authenticated;
grant execute on function public.staff_update_delivery_zone(uuid, integer, numeric, numeric, numeric, boolean) to authenticated;
