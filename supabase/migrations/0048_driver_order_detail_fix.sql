-- Fix Driver App order detail for the live order_items schema (no created_at column).
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
          select jsonb_agg(jsonb_build_object('name_ar', oim.name_ar) order by oim.id)
          from public.order_item_modifiers oim
          where oim.order_item_id = oi.id
        ), '[]'::jsonb)
      ) order by oi.id)
      from public.order_items oi
      where oi.order_id = v_order.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.driver_order_detail(uuid) from public, anon;
grant execute on function public.driver_order_detail(uuid) to authenticated;
