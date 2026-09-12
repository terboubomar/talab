-- Phase 3 · Driver App foundation
-- Driver role is branch-scoped, but must only see and update orders explicitly assigned to that driver.

create or replace function app.current_staff_is_driver()
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select exists (
    select 1
    from public.staff_roles sr
    join public.roles r on r.id = sr.role_id
    where sr.staff_id = app.current_staff_id()
      and r.tenant_id = app.current_tenant_id()
      and r.slug = 'driver'
  );
$$;

revoke all on function app.current_staff_is_driver() from public, anon;
grant execute on function app.current_staff_is_driver() to authenticated, service_role;

-- A driver may see only orders assigned to their own staff id.
drop policy if exists orders_sel on public.orders;
create policy orders_sel on public.orders
for select to authenticated
using (
  app.is_platform_admin()
  or (
    tenant_id = app.current_tenant_id()
    and app.has_perm('orders.page.view')
    and app.can_see_branch(branch_id)
    and (
      not app.current_staff_is_driver()
      or driver_id = app.current_staff_id()
    )
  )
);

drop policy if exists orders_upd on public.orders;
create policy orders_upd on public.orders
for update to authenticated
using (
  app.is_platform_admin()
  or (
    tenant_id = app.current_tenant_id()
    and app.can_see_branch(branch_id)
    and (
      app.has_perm('orders.status.accept')
      or app.has_perm('orders.status.cancel')
      or app.has_perm('orders.status.ready')
      or app.has_perm('orders.status.out_for_delivery')
      or app.has_perm('orders.status.delivered')
    )
    and (
      not app.current_staff_is_driver()
      or driver_id = app.current_staff_id()
    )
  )
)
with check (
  app.is_platform_admin()
  or (
    tenant_id = app.current_tenant_id()
    and app.can_see_branch(branch_id)
    and (
      not app.current_staff_is_driver()
      or driver_id = app.current_staff_id()
    )
  )
);

-- Child rows inherit the same assigned-driver restriction.
drop policy if exists order_items_sel on public.order_items;
create policy order_items_sel on public.order_items
for select to authenticated
using (
  app.is_platform_admin()
  or (
    tenant_id = app.current_tenant_id()
    and app.has_perm('orders.detail.view')
    and exists (
      select 1
      from public.orders o
      where o.id = order_items.order_id
        and app.can_see_branch(o.branch_id)
        and (
          not app.current_staff_is_driver()
          or o.driver_id = app.current_staff_id()
        )
    )
  )
);

drop policy if exists order_item_modifiers_sel on public.order_item_modifiers;
create policy order_item_modifiers_sel on public.order_item_modifiers
for select to authenticated
using (
  app.is_platform_admin()
  or (
    tenant_id = app.current_tenant_id()
    and app.has_perm('orders.detail.view')
    and exists (
      select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.id = order_item_modifiers.order_item_id
        and app.can_see_branch(o.branch_id)
        and (
          not app.current_staff_is_driver()
          or o.driver_id = app.current_staff_id()
        )
    )
  )
);

drop policy if exists order_status_history_sel on public.order_status_history;
create policy order_status_history_sel on public.order_status_history
for select to authenticated
using (
  app.is_platform_admin()
  or (
    tenant_id = app.current_tenant_id()
    and app.has_perm('orders.detail.view')
    and exists (
      select 1
      from public.orders o
      where o.id = order_status_history.order_id
        and app.can_see_branch(o.branch_id)
        and (
          not app.current_staff_is_driver()
          or o.driver_id = app.current_staff_id()
        )
    )
  )
);

create or replace function public.driver_my_profile()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_staff public.staff%rowtype;
begin
  if not app.current_staff_is_driver() then raise exception 'driver_role_required'; end if;

  select * into v_staff
  from public.staff
  where id = app.current_staff_id()
    and status = 'active';

  if v_staff.id is null then raise exception 'driver_not_active'; end if;

  return jsonb_build_object(
    'id', v_staff.id,
    'name', v_staff.name,
    'phone', v_staff.phone,
    'email', v_staff.email,
    'tenant_id', v_staff.tenant_id,
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'name_ar', b.name_ar, 'name_en', b.name_en) order by b.name_ar)
      from public.staff_branches sb
      join public.branches b on b.id = sb.branch_id
      where sb.staff_id = v_staff.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.driver_my_orders()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_staff_id uuid := app.current_staff_id();
  v_tenant_id uuid := app.current_tenant_id();
begin
  if not app.current_staff_is_driver() then raise exception 'driver_role_required'; end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'branch_id', o.branch_id,
        'branch_name_ar', b.name_ar,
        'status', o.status,
        'placed_at', o.placed_at,
        'scheduled_for', o.scheduled_for,
        'total', o.total,
        'payment_method', o.payment_method,
        'payment_status', o.payment_status,
        'delivery_address_text', o.delivery_address_text,
        'delivery_lat', o.delivery_lat,
        'delivery_lng', o.delivery_lng,
        'notes', o.notes,
        'customer', jsonb_build_object(
          'name', c.name,
          'phone', c.phone
        ),
        'items_count', coalesce((select sum(oi.qty) from public.order_items oi where oi.order_id = o.id), 0)
      )
      order by
        case o.status when 'out_for_delivery' then 0 when 'ready' then 1 when 'preparing' then 2 when 'accepted' then 3 else 4 end,
        coalesce(o.scheduled_for, o.placed_at)
    )
    from public.orders o
    join public.branches b on b.id = o.branch_id
    join public.customers c on c.id = o.customer_id
    where o.tenant_id = v_tenant_id
      and o.driver_id = v_staff_id
      and o.order_type = 'delivery'
      and o.status in ('accepted','preparing','ready','out_for_delivery')
      and app.can_see_branch(o.branch_id)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.driver_order_detail(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_staff_id uuid := app.current_staff_id();
  v_order public.orders%rowtype;
begin
  if not app.current_staff_is_driver() then raise exception 'driver_role_required'; end if;

  select * into v_order
  from public.orders
  where id = p_order_id
    and tenant_id = app.current_tenant_id()
    and driver_id = v_staff_id
    and order_type = 'delivery';

  if v_order.id is null then raise exception 'order_not_found'; end if;
  if not app.can_see_branch(v_order.branch_id) then raise exception 'not_authorized'; end if;

  return jsonb_build_object(
    'id', v_order.id,
    'status', v_order.status,
    'branch_id', v_order.branch_id,
    'branch', (select jsonb_build_object('name_ar', b.name_ar, 'name_en', b.name_en, 'phone', b.phone) from public.branches b where b.id = v_order.branch_id),
    'customer', (select jsonb_build_object('name', c.name, 'phone', c.phone) from public.customers c where c.id = v_order.customer_id),
    'delivery_address_text', v_order.delivery_address_text,
    'delivery_lat', v_order.delivery_lat,
    'delivery_lng', v_order.delivery_lng,
    'notes', v_order.notes,
    'total', v_order.total,
    'payment_method', v_order.payment_method,
    'payment_status', v_order.payment_status,
    'placed_at', v_order.placed_at,
    'scheduled_for', v_order.scheduled_for,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', oi.id,
        'name_ar', oi.name_ar,
        'qty', oi.qty,
        'notes', oi.notes,
        'modifiers', coalesce((
          select jsonb_agg(jsonb_build_object('name_ar', oim.name_ar))
          from public.order_item_modifiers oim
          where oim.order_item_id = oi.id
        ), '[]'::jsonb)
      ) order by oi.created_at)
      from public.order_items oi
      where oi.order_id = v_order.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.driver_update_delivery_status(p_order_id uuid, p_new_status public.order_status)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_order public.orders%rowtype;
begin
  if not app.current_staff_is_driver() then raise exception 'driver_role_required'; end if;
  if p_new_status not in ('out_for_delivery','completed') then raise exception 'driver_status_not_allowed'; end if;

  select * into v_order
  from public.orders
  where id = p_order_id
    and tenant_id = app.current_tenant_id()
    and driver_id = app.current_staff_id()
    and order_type = 'delivery'
  for update;

  if v_order.id is null then raise exception 'order_not_found'; end if;
  if not app.can_see_branch(v_order.branch_id) then raise exception 'not_authorized'; end if;

  perform public.staff_update_order_status(p_order_id, p_new_status);
end;
$$;

-- Harden the shared status RPC as well, so a driver cannot bypass driver_update_delivery_status.
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

  if app.current_staff_is_driver() then
    if v_driver_id is distinct from app.current_staff_id() then raise exception 'not_authorized'; end if;
    if p_new_status not in ('out_for_delivery','completed') then raise exception 'not_authorized'; end if;
  end if;

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
      delivered_at = case when p_new_status = 'completed' and v_order_type = 'delivery' then coalesce(delivered_at, now()) else delivered_at end,
      cancelled_at = case when p_new_status = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end,
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

revoke all on function public.driver_my_profile() from public, anon;
revoke all on function public.driver_my_orders() from public, anon;
revoke all on function public.driver_order_detail(uuid) from public, anon;
revoke all on function public.driver_update_delivery_status(uuid, public.order_status) from public, anon;
grant execute on function public.driver_my_profile() to authenticated;
grant execute on function public.driver_my_orders() to authenticated;
grant execute on function public.driver_order_detail(uuid) to authenticated;
grant execute on function public.driver_update_delivery_status(uuid, public.order_status) to authenticated;
