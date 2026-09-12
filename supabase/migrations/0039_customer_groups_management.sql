-- TALAB Phase 2 — Customer Groups management.
-- Source of truth: BUILD-SPEC §2.7 customers + Phase 2 roadmap.
-- Uses the existing customer_groups table and customer_group_id assignment model.

create unique index if not exists customer_groups_tenant_name_ar_unique
  on public.customer_groups (tenant_id, lower(btrim(name_ar)));

create or replace function public.staff_customer_groups()
returns table (
  id uuid,
  name_ar text,
  name_en text,
  is_default boolean,
  member_count bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_tenant uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant := app.current_tenant_id();
  if v_tenant is null then raise exception 'tenant_not_found'; end if;
  if not app.has_perm('customer_groups.view') and not app.is_platform_admin() then
    raise exception 'not_authorized';
  end if;

  return query
  select
    cg.id,
    cg.name_ar,
    cg.name_en,
    cg.is_default,
    count(c.id)::bigint as member_count,
    cg.created_at
  from public.customer_groups cg
  left join public.customers c
    on c.customer_group_id = cg.id and c.tenant_id = cg.tenant_id
  where cg.tenant_id = v_tenant
  group by cg.id, cg.name_ar, cg.name_en, cg.is_default, cg.created_at
  order by cg.is_default desc, cg.created_at asc;
end;
$$;

create or replace function public.staff_save_customer_group(
  p_group_id uuid,
  p_name_ar text,
  p_name_en text,
  p_is_default boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_tenant uuid;
  v_group_id uuid;
  v_staff record;
  v_before jsonb;
  v_after jsonb;
  v_action text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant := app.current_tenant_id();
  if v_tenant is null then raise exception 'tenant_not_found'; end if;

  if p_group_id is null then
    if not app.has_perm('customer_groups.create') and not app.is_platform_admin() then
      raise exception 'not_authorized';
    end if;
    v_action := 'customer_group.create';
  else
    if not app.has_perm('customer_groups.update') and not app.is_platform_admin() then
      raise exception 'not_authorized';
    end if;
    v_action := 'customer_group.update';
  end if;

  if p_name_ar is null or length(btrim(p_name_ar)) < 1 then raise exception 'name_ar_required'; end if;
  if p_name_en is null or length(btrim(p_name_en)) < 1 then raise exception 'name_en_required'; end if;

  if exists (
    select 1 from public.customer_groups cg
    where cg.tenant_id = v_tenant
      and lower(btrim(cg.name_ar)) = lower(btrim(p_name_ar))
      and (p_group_id is null or cg.id <> p_group_id)
  ) then raise exception 'customer_group_name_exists'; end if;

  if p_group_id is not null then
    select to_jsonb(cg.*) into v_before
    from public.customer_groups cg
    where cg.id = p_group_id and cg.tenant_id = v_tenant
    for update;
    if v_before is null then raise exception 'customer_group_not_found'; end if;
  end if;

  if coalesce(p_is_default, false) then
    update public.customer_groups
    set is_default = false
    where tenant_id = v_tenant
      and is_default
      and (p_group_id is null or id <> p_group_id);
  end if;

  if p_group_id is null then
    insert into public.customer_groups(tenant_id, name_ar, name_en, is_default)
    values(v_tenant, btrim(p_name_ar), btrim(p_name_en), coalesce(p_is_default,false))
    returning id into v_group_id;
  else
    update public.customer_groups
    set name_ar = btrim(p_name_ar),
        name_en = btrim(p_name_en),
        is_default = coalesce(p_is_default,false)
    where id = p_group_id and tenant_id = v_tenant
    returning id into v_group_id;
  end if;

  select to_jsonb(cg.*) into v_after
  from public.customer_groups cg
  where cg.id = v_group_id and cg.tenant_id = v_tenant;

  select s.id, s.name into v_staff
  from public.staff s
  where s.user_id = auth.uid() and s.tenant_id = v_tenant
  limit 1;

  insert into public.activity_log(tenant_id, actor_id, actor_name, action, entity_type, entity_id, diff)
  values(v_tenant, v_staff.id, v_staff.name, v_action, 'customer_group', v_group_id,
         jsonb_build_object('before',v_before,'after',v_after));

  return v_group_id;
end;
$$;

create or replace function public.staff_delete_customer_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_tenant uuid;
  v_staff record;
  v_before jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant := app.current_tenant_id();
  if v_tenant is null then raise exception 'tenant_not_found'; end if;
  if not app.has_perm('customer_groups.delete') and not app.is_platform_admin() then
    raise exception 'not_authorized';
  end if;

  select to_jsonb(cg.*) into v_before
  from public.customer_groups cg
  where cg.id = p_group_id and cg.tenant_id = v_tenant
  for update;
  if v_before is null then raise exception 'customer_group_not_found'; end if;
  if coalesce((v_before->>'is_default')::boolean,false) then raise exception 'cannot_delete_default_group'; end if;

  -- customers.customer_group_id is ON DELETE SET NULL. Coupon scopes keep their
  -- own scope IDs; remove references explicitly so deleted groups cannot leave
  -- stale coupon targeting rules behind.
  delete from public.coupon_scopes cs
  using public.coupons cp
  where cs.coupon_id = cp.id
    and cp.tenant_id = v_tenant
    and cs.scope_type = 'customer_group'
    and cs.scope_id = p_group_id::text;

  delete from public.customer_groups
  where id = p_group_id and tenant_id = v_tenant;

  select s.id, s.name into v_staff
  from public.staff s
  where s.user_id = auth.uid() and s.tenant_id = v_tenant
  limit 1;

  insert into public.activity_log(tenant_id, actor_id, actor_name, action, entity_type, entity_id, diff)
  values(v_tenant, v_staff.id, v_staff.name, 'customer_group.delete', 'customer_group', p_group_id,
         jsonb_build_object('before',v_before));
end;
$$;

revoke execute on function public.staff_customer_groups() from public, anon;
grant execute on function public.staff_customer_groups() to authenticated;
revoke execute on function public.staff_save_customer_group(uuid,text,text,boolean) from public, anon;
grant execute on function public.staff_save_customer_group(uuid,text,text,boolean) to authenticated;
revoke execute on function public.staff_delete_customer_group(uuid) from public, anon;
grant execute on function public.staff_delete_customer_group(uuid) to authenticated;
