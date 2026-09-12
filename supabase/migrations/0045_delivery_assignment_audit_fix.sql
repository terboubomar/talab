create or replace function public.staff_assign_order_driver(p_order_id uuid, p_driver_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_order public.orders%rowtype;
  v_driver public.staff%rowtype;
begin
  if not app.has_perm('orders.driver.assign') then raise exception 'not_authorized'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then raise exception 'order_not_found'; end if;
  if v_order.tenant_id <> app.current_tenant_id() and not app.is_platform_admin() then raise exception 'not_authorized'; end if;
  if not app.can_see_branch(v_order.branch_id) then raise exception 'not_authorized'; end if;
  if v_order.order_type <> 'delivery' then raise exception 'not_delivery_order'; end if;
  if v_order.status not in ('accepted','preparing','ready','out_for_delivery') then raise exception 'invalid_delivery_assignment_state'; end if;

  select * into v_driver from public.staff where id = p_driver_id;
  if v_driver.id is null or v_driver.tenant_id <> v_order.tenant_id or v_driver.status <> 'active' then raise exception 'driver_not_available'; end if;
  if not exists (
    select 1 from public.staff_roles sr
    join public.roles r on r.id = sr.role_id
    where sr.staff_id = v_driver.id
      and r.tenant_id = v_order.tenant_id
      and r.slug = 'driver'
      and (not r.branch_scoped or exists (
        select 1 from public.staff_branches sb
        where sb.staff_id = v_driver.id and sb.branch_id = v_order.branch_id
      ))
  ) then raise exception 'driver_not_available'; end if;

  update public.orders
  set driver_id = p_driver_id,
      delivery_provider_id = null,
      delivery_assignment_type = 'driver',
      delivery_assigned_at = now(),
      updated_at = now()
  where id = p_order_id;

  insert into public.activity_log(tenant_id, actor_id, actor_name, action, entity_type, entity_id, diff, at)
  select v_order.tenant_id, s.id, s.name, 'order.driver.assign', 'order', p_order_id,
         jsonb_build_object('driver_id', p_driver_id), now()
  from public.staff s where s.user_id = auth.uid()
  limit 1;
end;
$$;

create or replace function public.staff_assign_order_provider(p_order_id uuid, p_integration_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_order public.orders%rowtype;
  v_provider_tenant uuid;
begin
  if not app.has_perm('orders.provider.assign') then raise exception 'not_authorized'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then raise exception 'order_not_found'; end if;
  if v_order.tenant_id <> app.current_tenant_id() and not app.is_platform_admin() then raise exception 'not_authorized'; end if;
  if not app.can_see_branch(v_order.branch_id) then raise exception 'not_authorized'; end if;
  if v_order.order_type <> 'delivery' then raise exception 'not_delivery_order'; end if;
  if v_order.status not in ('accepted','preparing','ready','out_for_delivery') then raise exception 'invalid_delivery_assignment_state'; end if;

  select ti.tenant_id into v_provider_tenant
  from public.tenant_integrations ti
  join public.integration_providers ip on ip.id = ti.provider_id
  where ti.id = p_integration_id
    and ip.category = 'delivery'
    and ip.active = true
    and ti.status in ('configured','active');
  if v_provider_tenant is null or v_provider_tenant <> v_order.tenant_id then raise exception 'delivery_provider_not_available'; end if;

  update public.orders
  set delivery_provider_id = p_integration_id,
      driver_id = null,
      delivery_assignment_type = 'provider',
      delivery_assigned_at = now(),
      updated_at = now()
  where id = p_order_id;

  insert into public.activity_log(tenant_id, actor_id, actor_name, action, entity_type, entity_id, diff, at)
  select v_order.tenant_id, s.id, s.name, 'order.provider.assign', 'order', p_order_id,
         jsonb_build_object('delivery_provider_id', p_integration_id), now()
  from public.staff s where s.user_id = auth.uid()
  limit 1;
end;
$$;
