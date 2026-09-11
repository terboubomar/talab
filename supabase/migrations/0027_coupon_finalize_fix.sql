-- Coupon finalize fix: a cash order may mark its reservation consumed immediately
-- before calling this helper. Consumed must not mean "already redeemed".
create or replace function app.coupon_finalize_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path=public,app
as $$
declare
  v_order record;
  v_res record;
begin
  select * into v_order from public.orders where id=p_order_id;
  if v_order.id is null or v_order.coupon_id is null then return; end if;

  select * into v_res from public.coupon_reservations
  where id=v_order.coupon_reservation_id
  for update;
  if v_res.id is null then return; end if;

  if v_res.status <> 'consumed' then
    update public.coupon_reservations
      set status='consumed',consumed_at=now(),updated_at=now()
      where id=v_res.id;
  end if;

  insert into public.coupon_redemptions(
    tenant_id,coupon_id,order_id,customer_id,amount,delivery_discount,status
  ) values (
    v_order.tenant_id,v_order.coupon_id,v_order.id,v_order.customer_id,
    v_order.discount_total,v_res.delivery_discount,'redeemed'
  )
  on conflict(coupon_id,order_id) do update
    set status='redeemed',voided_at=null,amount=excluded.amount,
        delivery_discount=excluded.delivery_discount;
end;
$$;
