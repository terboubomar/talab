-- TALAB · branch busy-until storefront + staff operations
-- Exposes the exact temporary busy end time to the storefront and gives the
-- dedicated branches.busy.toggle permission a scoped SECURITY DEFINER action.

create or replace function public.storefront_branches(p_tenant_slug text)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'app', 'pg_temp'
as $$
  select coalesce(jsonb_agg(x order by (x->>'sort')::int), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', b.id,
      'brand_id', b.brand_id,
      'brand_ar', br.name_ar,
      'brand_en', br.name_en,
      'name_ar', b.name_ar,
      'name_en', b.name_en,
      'city_ar', c.name_ar,
      'city_en', c.name_en,
      'phone', b.phone,
      'lat', b.lat,
      'lng', b.lng,
      'busy', (b.busy_until is not null and b.busy_until > now()),
      'busy_until', b.busy_until,
      'sort', b.sort,
      'order_types', coalesce((
        select jsonb_agg(bot.kind order by bot.kind)
        from public.branch_order_types bot
        where bot.branch_id = b.id and bot.enabled
      ), '[]'::jsonb)
    ) as x
    from public.branches b
    join public.brands br on br.id = b.brand_id
    join public.tenants t on t.id = b.tenant_id
    left join public.cities c on c.id = b.city_id
    where t.slug = p_tenant_slug
      and t.status in ('trial','active')
      and b.status = 'active'
      and br.status = 'active'
  ) s;
$$;

create or replace function public.staff_branch_operations()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'app', 'pg_temp'
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
     and not app.has_perm('branches.busy.toggle') then
    raise exception 'not_authorized';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id,
      'name_ar', b.name_ar,
      'name_en', b.name_en,
      'city_ar', c.name_ar,
      'city_en', c.name_en,
      'phone', b.phone,
      'busy', (b.busy_until is not null and b.busy_until > now()),
      'busy_until', b.busy_until,
      'status', b.status,
      'sort', b.sort
    ) order by b.sort, b.name_ar), '[]'::jsonb)
    from public.branches b
    left join public.cities c on c.id = b.city_id
    where (app.is_platform_admin() or b.tenant_id = v_tenant_id)
      and app.can_see_branch(b.id)
  );
end;
$$;

create or replace function public.staff_set_branch_busy(
  p_branch_id uuid,
  p_busy_until timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'app', 'pg_temp'
as $$
declare
  v_tenant_id uuid;
  v_busy_until timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select b.tenant_id into v_tenant_id
  from public.branches b
  where b.id = p_branch_id;

  if v_tenant_id is null then
    raise exception 'branch_not_found';
  end if;
  if not app.is_platform_admin() and v_tenant_id <> app.current_tenant_id() then
    raise exception 'not_authorized';
  end if;
  if not app.can_see_branch(p_branch_id) then
    raise exception 'not_authorized';
  end if;
  if not app.is_platform_admin() and not app.has_perm('branches.busy.toggle') then
    raise exception 'not_authorized';
  end if;

  v_busy_until := case
    when p_busy_until is null or p_busy_until <= now() then null
    else p_busy_until
  end;

  update public.branches
  set busy_until = v_busy_until,
      updated_at = now()
  where id = p_branch_id;

  return jsonb_build_object(
    'id', p_branch_id,
    'busy', v_busy_until is not null,
    'busy_until', v_busy_until
  );
end;
$$;

revoke all on function public.staff_branch_operations() from public, anon;
revoke all on function public.staff_set_branch_busy(uuid, timestamptz) from public, anon;
grant execute on function public.staff_branch_operations() to authenticated;
grant execute on function public.staff_set_branch_busy(uuid, timestamptz) to authenticated;
grant execute on function public.storefront_branches(text) to anon, authenticated;
