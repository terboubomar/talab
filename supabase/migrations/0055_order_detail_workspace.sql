-- TALAB · Order detail workspace
create or replace function public.staff_order_detail(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_order orders%rowtype;
  v_result jsonb;
begin
  if auth.uid() is null or not app.has_perm('orders.detail.view') then
    raise exception 'not_authorized';
  end if;

  select * into v_order
  from orders
  where id = p_order_id and tenant_id = v_tenant;

  if not found or not app.can_see_branch(v_order.branch_id) then
    raise exception 'order_not_found';
  end if;

  select jsonb_build_object(
    'order', jsonb_build_object(
      'id', o.id,
      'branch_id', o.branch_id,
      'branch_name', b.name_ar,
      'order_type', o.order_type,
      'status', o.status,
      'source', o.source,
      'created_by_staff_id', o.created_by_staff_id,
      'created_by_staff_name', creator.name,
      'customer_id', o.customer_id,
      'customer_name', c.name,
      'customer_phone', c.phone,
      'customer_email', c.email,
      'notes', o.notes,
      'subtotal', o.subtotal,
      'tax_total', o.tax_total,
      'delivery_fee', o.delivery_fee,
      'discount_total', o.discount_total,
      'coupon_code', o.coupon_code,
      'coupon_total', coalesce((select sum(cr.amount + cr.delivery_discount) from coupon_redemptions cr where cr.order_id=o.id and cr.status='redeemed'),0),
      'points_total', o.points_total,
      'wallet_total', o.wallet_total,
      'deposit_total', o.deposit_total,
      'total', o.total,
      'currency', o.currency,
      'payment_method', o.payment_method,
      'payment_status', o.payment_status,
      'paid_at', o.paid_at,
      'placed_at', o.placed_at,
      'scheduled_for', o.scheduled_for,
      'delivery_address_text', o.delivery_address_text,
      'delivery_lat', o.delivery_lat,
      'delivery_lng', o.delivery_lng,
      'pos_ref', o.pos_ref,
      'pos_status', o.pos_status,
      'pos_last_error', o.pos_last_error,
      'pos_sent_at', o.pos_sent_at,
      'driver_id', o.driver_id,
      'driver_name', driver.name,
      'delivery_provider_id', o.delivery_provider_id,
      'delivery_provider_name', ip.name_ar,
      'delivery_assignment_type', o.delivery_assignment_type,
      'delivery_assigned_at', o.delivery_assigned_at,
      'delivered_at', o.delivered_at,
      'cancelled_at', o.cancelled_at
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', oi.id,
        'product_id', oi.product_id,
        'name_ar', oi.name_ar,
        'name_en', oi.name_en,
        'unit_price', oi.unit_price,
        'qty', oi.qty,
        'line_total', oi.line_total,
        'notes', oi.notes,
        'modifiers', coalesce((
          select jsonb_agg(jsonb_build_object('id',m.id,'name_ar',m.name_ar,'price',m.price) order by m.name_ar)
          from order_item_modifiers m where m.order_item_id=oi.id
        ), '[]'::jsonb)
      ) order by oi.name_ar)
      from order_items oi where oi.order_id=o.id
    ), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'amount', r.amount, 'reason', r.reason,
        'status', r.status, 'execution_mode', r.execution_mode, 'created_by_name', r.created_by_name,
        'created_at', r.created_at, 'completed_at', r.completed_at
      ) order by r.created_at desc)
      from order_refunds r where r.order_id=o.id
    ), '[]'::jsonb),
    'status_history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id, 'status', h.status, 'at', h.changed_at, 'actor_name', s.name, 'note', h.note
      ) order by h.changed_at desc)
      from order_status_history h left join staff s on s.id=h.changed_by where h.order_id=o.id
    ), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'action', a.action, 'actor_name', a.actor_name, 'diff', a.diff, 'at', a.at
      ) order by a.at desc)
      from activity_log a where a.tenant_id=v_tenant and a.entity_type='order' and a.entity_id=o.id
    ), '[]'::jsonb)
  ) into v_result
  from orders o
  join branches b on b.id=o.branch_id
  left join customers c on c.id=o.customer_id
  left join staff creator on creator.id=o.created_by_staff_id
  left join staff driver on driver.id=o.driver_id
  left join tenant_integrations ti on ti.id=o.delivery_provider_id
  left join integration_providers ip on ip.id=ti.provider_id
  where o.id=p_order_id and o.tenant_id=v_tenant;

  return v_result;
end;
$$;

revoke all on function public.staff_order_detail(uuid) from public, anon;
grant execute on function public.staff_order_detail(uuid) to authenticated;
