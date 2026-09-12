-- Phase 3 delivery management foundation.
-- Supports the BUILD-SPEC flow: ready -> assign driver/provider -> out_for_delivery -> delivered.

alter table public.orders
  add column if not exists driver_id uuid references public.staff(id) on delete set null,
  add column if not exists delivery_provider_id uuid references public.tenant_integrations(id) on delete set null,
  add column if not exists delivery_assignment_type text,
  add column if not exists delivery_assigned_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists cancelled_at timestamptz;

alter table public.orders drop constraint if exists orders_delivery_assignment_type_check;
alter table public.orders
  add constraint orders_delivery_assignment_type_check
  check (delivery_assignment_type is null or delivery_assignment_type in ('driver','provider'));

create index if not exists orders_driver_id_idx
  on public.orders(driver_id) where driver_id is not null;
create index if not exists orders_delivery_provider_id_idx
  on public.orders(delivery_provider_id) where delivery_provider_id is not null;
create index if not exists orders_tenant_delivery_assignment_idx
  on public.orders(tenant_id, delivery_assignment_type, status)
  where order_type = 'delivery';

create or replace function public.staff_delivery_options(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_order public.orders%rowtype;
  v_result jsonb;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then raise exception 'order_not_found'; end if;
  if v_order.tenant_id <> app.current_tenant_id() and not app.is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if not app.can_see_branch(v_order.branch_id) or not app.has_perm('orders.page.view') then
    raise exception 'not_authorized';
  end if;
  if v_order.order_type <> 'delivery' then raise exception 'not_delivery_order'; end if;

  select jsonb_build_object(
    'order_id', v_order.id,
    'branch_id', v_order.branch_id,
    'driver_id', v_order.driver_id,
    'delivery_provider_id', v_order.delivery_provider_id,
    'delivery_assignment_type', v_order.delivery_assignment_type,
    'delivery_assigned_at', v_order.delivery_assigned_at,
    'drivers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'phone', s.phone
      ) order by s.name)
      from public.staff s
      where s.tenant_id = v_order.tenant_id
        and s.status = 'active'
        and exists (
          select 1
          from public.staff_roles sr
          join public.roles r on r.id = sr.role_id
          where sr.staff_id = s.id
            and r.tenant_id = v_order.tenant_id
            and r.slug = 'driver'
            and (
              not r.branch_scoped
              or exists (
                select 1 from public.staff_branches sb
                where sb.staff_id = s.id and sb.branch_id = v_order.branch_id
              )
            )
        )
    ), '[]'::jsonb),
    'providers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'integration_id', ti.id,
        'provider_id', ip.id,
        'slug', ip.slug,
        'name_ar', ip.name_ar,
        'name_en', ip.name_en,
        'logo', ip.logo,
        'status', ti.status
      ) order by ip.name_ar)
      from public.tenant_integrations ti
      join public.integration_providers ip on ip.id = ti.provider_id
      where ti.tenant_id = v_order.tenant_id
        and ip.category = 'delivery'
        and ip.active = true
        and ti.status in ('configured','active')
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

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
  if v_driver.id is null or v_driver.tenant_id <> v_order.tenant_id or v_driver.status <> 'active' then
    raise exception 'driver_not_available';
  end if;
  if not exists (
    select 1
    from public.staff_roles sr
    join public.roles r on r.id = sr.role_id
    where sr.staff_id = v_driver.id
      and r.tenant_id = v_order.tenant_id
      and r.slug = 'driver'
      and (
        not r.branch_scoped
        or exists (
          select 1 from public.staff_branches sb
          where sb.staff_id = v_driver.id and sb.branch_id = v_order.branch_id
        )
      )
  ) then raise exception 'driver_not_available'; end if;

  update public.orders
    set driver_id = p_driver_id,
        delivery_provider_id = null,
        delivery_assignment_type = 'driver',
        delivery_assigned_at = now(),
        updated_at = now()
  where id = p_order_id;

  insert into public.activity_log(tenant_id, actor_id, action, entity_type, entity_id, diff_json, at)
  select v_order.tenant_id, s.id, 'order.driver.assign', 'order', p_order_id,
         jsonb_build_object('driver_id', p_driver_id), now()
  from public.staff s where s.user_id = auth.uid()
  limit 1;
end;
$$;

create or replace function public.staff_unassign_order_driver(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_order public.orders%rowtype;
begin
  if not app.has_perm('orders.driver.unassign') then raise exception 'not_authorized'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then raise exception 'order_not_found'; end if;
  if v_order.tenant_id <> app.current_tenant_id() and not app.is_platform_admin() then raise exception 'not_authorized'; end if;
  if not app.can_see_branch(v_order.branch_id) then raise exception 'not_authorized'; end if;
  if v_order.status in ('completed','cancelled') then raise exception 'invalid_delivery_assignment_state'; end if;

  update public.orders
    set driver_id = null,
        delivery_assignment_type = case when delivery_provider_id is null then null else 'provider' end,
        delivery_assigned_at = case when delivery_provider_id is null then null else delivery_assigned_at end,
        updated_at = now()
  where id = p_order_id;
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
  if v_provider_tenant is null or v_provider_tenant <> v_order.tenant_id then
    raise exception 'delivery_provider_not_available';
  end if;

  update public.orders
    set delivery_provider_id = p_integration_id,
        driver_id = null,
        delivery_assignment_type = 'provider',
        delivery_assigned_at = now(),
        updated_at = now()
  where id = p_order_id;

  insert into public.activity_log(tenant_id, actor_id, action, entity_type, entity_id, diff_json, at)
  select v_order.tenant_id, s.id, 'order.provider.assign', 'order', p_order_id,
         jsonb_build_object('delivery_provider_id', p_integration_id), now()
  from public.staff s where s.user_id = auth.uid()
  limit 1;
end;
$$;

create or replace function public.staff_unassign_order_provider(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_order public.orders%rowtype;
begin
  if not app.has_perm('orders.provider.unassign') then raise exception 'not_authorized'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then raise exception 'order_not_found'; end if;
  if v_order.tenant_id <> app.current_tenant_id() and not app.is_platform_admin() then raise exception 'not_authorized'; end if;
  if not app.can_see_branch(v_order.branch_id) then raise exception 'not_authorized'; end if;
  if v_order.status in ('completed','cancelled') then raise exception 'invalid_delivery_assignment_state'; end if;

  update public.orders
    set delivery_provider_id = null,
        delivery_assignment_type = case when driver_id is null then null else 'driver' end,
        delivery_assigned_at = case when driver_id is null then null else delivery_assigned_at end,
        updated_at = now()
  where id = p_order_id;
end;
$$;

-- Preserve the existing transition/permission contract and add delivery assignment enforcement.
create or replace function public.staff_update_order_status(p_order_id uuid, p_new_status public.order_status)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_tenant_id uuid;
  v_branch_id uuid;
  v_current public.order_status;
  v_order_type public.order_type;
  v_payment_method text;
  v_payment_status text;
  v_driver_id uuid;
  v_delivery_provider_id uuid;
  v_perm text;
  v_allowed boolean;
begin
  select tenant_id, branch_id, status, order_type, payment_method, payment_status, driver_id, delivery_provider_id
    into v_tenant_id, v_branch_id, v_current, v_order_type, v_payment_method, v_payment_status, v_driver_id, v_delivery_provider_id
    from public.orders where id = p_order_id;

  if v_tenant_id is null then raise exception 'order_not_found'; end if;
  if v_tenant_id <> app.current_tenant_id() and not app.is_platform_admin() then raise exception 'not_authorized'; end if;
  if not app.can_see_branch(v_branch_id) then raise exception 'not_authorized'; end if;

  if p_new_status = 'accepted'
     and v_payment_method = 'online'
     and v_payment_status not in ('paid', 'partially_refunded') then
    raise exception 'payment_not_confirmed';
  end if;

  if p_new_status = 'out_for_delivery'
     and v_order_type = 'delivery'
     and v_driver_id is null
     and v_delivery_provider_id is null then
    raise exception 'delivery_assignment_required';
  end if;

  v_perm := case p_new_status
    when 'accepted' then 'orders.status.accept'
    when 'preparing' then 'orders.status.accept'
    when 'ready' then 'orders.status.ready'
    when 'out_for_delivery' then 'orders.status.out_for_delivery'
    when 'completed' then 'orders.status.delivered'
    when 'cancelled' then 'orders.status.cancel'
    else null
  end;
  if v_perm is null or not app.has_perm(v_perm) then raise exception 'not_authorized'; end if;

  v_allowed := case
    when p_new_status = 'cancelled' and v_current not in ('completed', 'cancelled') then true
    when v_current = 'pending' and p_new_status = 'accepted' then true
    when v_current = 'accepted' and p_new_status = 'preparing' then true
    when v_current = 'preparing' and p_new_status = 'ready' then true
    when v_current = 'ready' and p_new_status = 'out_for_delivery' and v_order_type = 'delivery' then true
    when v_current = 'ready' and p_new_status = 'completed' and v_order_type <> 'delivery' then true
    when v_current = 'out_for_delivery' and p_new_status = 'completed' then true
    else false
  end;
  if not v_allowed then raise exception 'invalid_transition'; end if;

  update public.orders
  set status = p_new_status,
      delivered_at = case when p_new_status = 'completed' and v_order_type = 'delivery' then now() else delivered_at end,
      cancelled_at = case when p_new_status = 'cancelled' then now() else cancelled_at end,
      updated_at = now()
  where id = p_order_id;

  insert into public.order_status_history (tenant_id, order_id, status, changed_by)
  select v_tenant_id, p_order_id, p_new_status, s.id
    from public.staff s where s.user_id = auth.uid()
  union all
  select v_tenant_id, p_order_id, p_new_status, null
  where not exists (select 1 from public.staff where user_id = auth.uid())
  limit 1;
end;
$$;

revoke all on function public.staff_delivery_options(uuid) from public, anon;
revoke all on function public.staff_assign_order_driver(uuid,uuid) from public, anon;
revoke all on function public.staff_unassign_order_driver(uuid) from public, anon;
revoke all on function public.staff_assign_order_provider(uuid,uuid) from public, anon;
revoke all on function public.staff_unassign_order_provider(uuid) from public, anon;

grant execute on function public.staff_delivery_options(uuid) to authenticated;
grant execute on function public.staff_assign_order_driver(uuid,uuid) to authenticated;
grant execute on function public.staff_unassign_order_driver(uuid) to authenticated;
grant execute on function public.staff_assign_order_provider(uuid,uuid) to authenticated;
grant execute on function public.staff_unassign_order_provider(uuid) to authenticated;
