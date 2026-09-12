-- 0066_branch_admin_crud.sql
-- Admin > Branches: close the gap between the seeded permissions
-- (branches.create / branches.update, already present since 0007_seed_permissions)
-- and the actual API surface, which only ever shipped busy/product/zone toggles.
-- Adds: dropdown data for the branch form, branch create/update (info + order
-- types + weekly hours + menu assignment), and delivery-zone creation
-- (previously only existing zones could be edited, never new ones added).

create or replace function public.staff_branch_form_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_tenant_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant_id := app.current_tenant_id();
  if v_tenant_id is null and not app.is_platform_admin() then raise exception 'not_authorized'; end if;
  if not app.is_platform_admin()
     and not app.has_perm('branches.create')
     and not app.has_perm('branches.update') then
    raise exception 'not_authorized';
  end if;

  return jsonb_build_object(
    'brands', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'name_ar', b.name_ar, 'name_en', b.name_en) order by b.sort, b.name_ar)
      from public.brands b
      where b.tenant_id = v_tenant_id and b.status = 'active'
    ), '[]'::jsonb),
    'cities', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name_ar', c.name_ar, 'name_en', c.name_en) order by c.sort, c.name_ar)
      from public.cities c
      where c.tenant_id = v_tenant_id and c.status = 'active'
    ), '[]'::jsonb),
    'areas', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'city_id', a.city_id, 'name_ar', a.name_ar, 'name_en', a.name_en) order by a.sort, a.name_ar)
      from public.areas a
      where a.tenant_id = v_tenant_id and a.status = 'active'
    ), '[]'::jsonb),
    'menus', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'name_ar', m.name_ar, 'name_en', m.name_en, 'is_default', m.is_default) order by m.is_default desc, m.sort, m.name_ar)
      from public.menus m
      where m.tenant_id = v_tenant_id and m.deleted_at is null
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.staff_create_city(p_name_ar text, p_name_en text)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant_id := app.current_tenant_id();
  if v_tenant_id is null then raise exception 'not_authorized'; end if;
  if not app.is_platform_admin() and not app.has_perm('cities.create') then raise exception 'missing_permission'; end if;
  if coalesce(trim(p_name_ar), '') = '' or coalesce(trim(p_name_en), '') = '' then
    raise exception 'name_required';
  end if;

  insert into public.cities (tenant_id, name_ar, name_en)
  values (v_tenant_id, trim(p_name_ar), trim(p_name_en))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'name_ar', trim(p_name_ar), 'name_en', trim(p_name_en));
end;
$$;

create or replace function public.staff_create_area(p_city_id uuid, p_name_ar text, p_name_en text)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant_id := app.current_tenant_id();
  if v_tenant_id is null then raise exception 'not_authorized'; end if;
  if not app.is_platform_admin() and not app.has_perm('areas.create') then raise exception 'missing_permission'; end if;
  if coalesce(trim(p_name_ar), '') = '' or coalesce(trim(p_name_en), '') = '' then
    raise exception 'name_required';
  end if;
  if not exists (select 1 from public.cities where id = p_city_id and tenant_id = v_tenant_id) then
    raise exception 'city_not_found';
  end if;

  insert into public.areas (tenant_id, city_id, name_ar, name_en)
  values (v_tenant_id, p_city_id, trim(p_name_ar), trim(p_name_en))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'city_id', p_city_id, 'name_ar', trim(p_name_ar), 'name_en', trim(p_name_en));
end;
$$;

create or replace function public.staff_create_branch(
  p_brand_id uuid,
  p_name_ar text,
  p_name_en text,
  p_city_id uuid,
  p_phone text,
  p_lat numeric,
  p_lng numeric,
  p_code text,
  p_menu_id uuid,
  p_order_types jsonb,
  p_hours jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_branch_id uuid;
  v_item jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant_id := app.current_tenant_id();
  if v_tenant_id is null then raise exception 'not_authorized'; end if;
  if not app.is_platform_admin() and not app.has_perm('branches.create') then raise exception 'missing_permission'; end if;

  if coalesce(trim(p_name_ar), '') = '' or coalesce(trim(p_name_en), '') = '' then
    raise exception 'name_required';
  end if;
  if not exists (select 1 from public.brands where id = p_brand_id and tenant_id = v_tenant_id) then
    raise exception 'brand_not_found';
  end if;
  if p_city_id is not null and not exists (select 1 from public.cities where id = p_city_id and tenant_id = v_tenant_id) then
    raise exception 'city_not_found';
  end if;
  if p_menu_id is not null and not exists (select 1 from public.menus where id = p_menu_id and tenant_id = v_tenant_id and deleted_at is null) then
    raise exception 'menu_not_found';
  end if;

  insert into public.branches (tenant_id, brand_id, city_id, name_ar, name_en, phone, lat, lng, code)
  values (v_tenant_id, p_brand_id, p_city_id, trim(p_name_ar), trim(p_name_en), nullif(trim(p_phone), ''), p_lat, p_lng, nullif(trim(p_code), ''))
  returning id into v_branch_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_order_types, '[]'::jsonb))
  loop
    insert into public.branch_order_types (tenant_id, branch_id, kind, enabled)
    values (v_tenant_id, v_branch_id, (v_item->>'kind')::public.order_type, coalesce((v_item->>'enabled')::boolean, false))
    on conflict (branch_id, kind) do update set enabled = excluded.enabled;
  end loop;

  delete from public.branch_hours where branch_id = v_branch_id;
  for v_item in select * from jsonb_array_elements(coalesce(p_hours, '[]'::jsonb))
  loop
    insert into public.branch_hours (tenant_id, branch_id, weekday, opens_at, closes_at, is_24h, closed)
    values (
      v_tenant_id, v_branch_id, (v_item->>'weekday')::smallint,
      nullif(v_item->>'opens_at', '')::time, nullif(v_item->>'closes_at', '')::time,
      coalesce((v_item->>'is_24h')::boolean, false), coalesce((v_item->>'closed')::boolean, false)
    );
  end loop;

  if p_menu_id is not null then
    insert into public.branch_menus (tenant_id, branch_id, menu_id)
    values (v_tenant_id, v_branch_id, p_menu_id)
    on conflict (branch_id) do update set menu_id = excluded.menu_id;
  end if;

  return public.staff_branch_detail(v_branch_id);
end;
$$;

create or replace function public.staff_update_branch(
  p_branch_id uuid,
  p_name_ar text,
  p_name_en text,
  p_city_id uuid,
  p_phone text,
  p_lat numeric,
  p_lng numeric,
  p_code text,
  p_status public.entity_status,
  p_menu_id uuid,
  p_order_types jsonb,
  p_hours jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_branch_tenant uuid;
  v_item jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select tenant_id into v_branch_tenant from public.branches where id = p_branch_id;
  if v_branch_tenant is null then raise exception 'branch_not_found'; end if;

  v_tenant_id := app.current_tenant_id();
  if not app.is_platform_admin() then
    if v_tenant_id is null or v_branch_tenant <> v_tenant_id then raise exception 'not_authorized'; end if;
    if not app.has_perm('branches.update') then raise exception 'missing_permission'; end if;
    if not app.can_see_branch(p_branch_id) then raise exception 'branch_scope_denied'; end if;
  end if;

  if coalesce(trim(p_name_ar), '') = '' or coalesce(trim(p_name_en), '') = '' then
    raise exception 'name_required';
  end if;
  if p_city_id is not null and not exists (select 1 from public.cities where id = p_city_id and tenant_id = v_branch_tenant) then
    raise exception 'city_not_found';
  end if;
  if p_menu_id is not null and not exists (select 1 from public.menus where id = p_menu_id and tenant_id = v_branch_tenant and deleted_at is null) then
    raise exception 'menu_not_found';
  end if;

  update public.branches
  set name_ar = trim(p_name_ar),
      name_en = trim(p_name_en),
      city_id = p_city_id,
      phone = nullif(trim(p_phone), ''),
      lat = p_lat,
      lng = p_lng,
      code = nullif(trim(p_code), ''),
      status = coalesce(p_status, status),
      updated_at = now()
  where id = p_branch_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_order_types, '[]'::jsonb))
  loop
    insert into public.branch_order_types (tenant_id, branch_id, kind, enabled)
    values (v_branch_tenant, p_branch_id, (v_item->>'kind')::public.order_type, coalesce((v_item->>'enabled')::boolean, false))
    on conflict (branch_id, kind) do update set enabled = excluded.enabled;
  end loop;

  if jsonb_array_length(coalesce(p_hours, '[]'::jsonb)) > 0 then
    delete from public.branch_hours where branch_id = p_branch_id;
    for v_item in select * from jsonb_array_elements(p_hours)
    loop
      insert into public.branch_hours (tenant_id, branch_id, weekday, opens_at, closes_at, is_24h, closed)
      values (
        v_branch_tenant, p_branch_id, (v_item->>'weekday')::smallint,
        nullif(v_item->>'opens_at', '')::time, nullif(v_item->>'closes_at', '')::time,
        coalesce((v_item->>'is_24h')::boolean, false), coalesce((v_item->>'closed')::boolean, false)
      );
    end loop;
  end if;

  if p_menu_id is not null then
    insert into public.branch_menus (tenant_id, branch_id, menu_id)
    values (v_branch_tenant, p_branch_id, p_menu_id)
    on conflict (branch_id) do update set menu_id = excluded.menu_id;
  end if;

  return public.staff_branch_detail(p_branch_id);
end;
$$;

create or replace function public.staff_create_delivery_zone(
  p_branch_id uuid,
  p_area_id uuid,
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
  v_branch_tenant uuid;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_eta_minutes < 0 or p_fee < 0 or p_min_order < 0 or p_below_min_fee < 0 then
    raise exception 'invalid_zone_values';
  end if;

  select tenant_id into v_branch_tenant from public.branches where id = p_branch_id;
  if v_branch_tenant is null then raise exception 'branch_not_found'; end if;

  v_tenant_id := app.current_tenant_id();
  if not app.is_platform_admin() then
    if v_tenant_id is null or v_branch_tenant <> v_tenant_id then raise exception 'not_authorized'; end if;
    if not app.has_perm('branches.zones.manage') then raise exception 'missing_permission'; end if;
    if not app.can_see_branch(p_branch_id) then raise exception 'branch_scope_denied'; end if;
  end if;

  if not exists (select 1 from public.areas where id = p_area_id and tenant_id = v_branch_tenant) then
    raise exception 'area_not_found';
  end if;
  if exists (select 1 from public.delivery_zones where branch_id = p_branch_id and area_id = p_area_id) then
    raise exception 'zone_already_exists';
  end if;

  insert into public.delivery_zones (tenant_id, branch_id, area_id, eta_minutes, fee, min_order, below_min_fee, enabled)
  values (v_branch_tenant, p_branch_id, p_area_id, p_eta_minutes, p_fee, p_min_order, p_below_min_fee, coalesce(p_enabled, true))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'branch_id', p_branch_id, 'area_id', p_area_id);
end;
$$;

revoke all on function public.staff_branch_form_options() from public, anon;
revoke all on function public.staff_create_city(text, text) from public, anon;
revoke all on function public.staff_create_area(uuid, text, text) from public, anon;
revoke all on function public.staff_create_branch(uuid, text, text, uuid, text, numeric, numeric, text, uuid, jsonb, jsonb) from public, anon;
revoke all on function public.staff_update_branch(uuid, text, text, uuid, text, numeric, numeric, text, public.entity_status, uuid, jsonb, jsonb) from public, anon;
revoke all on function public.staff_create_delivery_zone(uuid, uuid, integer, numeric, numeric, numeric, boolean) from public, anon;

grant execute on function public.staff_branch_form_options() to authenticated;
grant execute on function public.staff_create_city(text, text) to authenticated;
grant execute on function public.staff_create_area(uuid, text, text) to authenticated;
grant execute on function public.staff_create_branch(uuid, text, text, uuid, text, numeric, numeric, text, uuid, jsonb, jsonb) to authenticated;
grant execute on function public.staff_update_branch(uuid, text, text, uuid, text, numeric, numeric, text, public.entity_status, uuid, jsonb, jsonb) to authenticated;
grant execute on function public.staff_create_delivery_zone(uuid, uuid, integer, numeric, numeric, numeric, boolean) to authenticated;
