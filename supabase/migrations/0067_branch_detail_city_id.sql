-- 0067_branch_detail_city_id.sql
-- staff_branch_detail() didn't return city_id (only the resolved city_ar/city_en names),
-- so the edit-branch form had no way to preselect the branch's city in a dropdown.
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
        'brand_id', b.brand_id,
        'city_id', b.city_id,
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
