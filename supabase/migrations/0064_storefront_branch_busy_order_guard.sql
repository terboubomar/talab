-- TALAB · busy branch order guard
-- The storefront already disables branches whose busy_until is in the future.
-- Enforce the same rule on the authoritative server-side placement path and
-- retire older public placement RPCs so they cannot bypass the guard.

create or replace function public.storefront_place_order_v5(
  p_tenant_slug text,
  p_branch_id uuid,
  p_order_type order_type,
  p_customer_name text,
  p_customer_phone text,
  p_notes text,
  p_items jsonb,
  p_area_id uuid default null,
  p_lat numeric default null,
  p_lng numeric default null,
  p_address_text text default null,
  p_payment_method text default 'cash',
  p_coupon_reservation_id uuid default null,
  p_points_reservation_id uuid default null,
  p_wallet_reservation_id uuid default null,
  p_source text default 'web'
)
returns table(order_id uuid, total numeric)
language plpgsql
security definer
set search_path to 'public', 'app'
as $$
declare
  v_order_id uuid;
  v_total numeric;
  v_order public.orders%rowtype;
  v_points public.points_reservations%rowtype;
  v_wallet public.wallet_reservations%rowtype;
  v_customer_user uuid;
  v_taxable numeric;
  v_tax_rate numeric;
  v_wallet_amount numeric;
begin
  if exists (
    select 1
    from public.branches b
    join public.tenants t on t.id = b.tenant_id
    where b.id = p_branch_id
      and t.slug = p_tenant_slug
      and b.busy_until is not null
      and b.busy_until > now()
  ) then
    raise exception 'branch_busy';
  end if;

  select r.order_id, r.total into v_order_id, v_total
  from public.storefront_place_order_v3(
    p_tenant_slug,
    p_branch_id,
    p_order_type,
    p_customer_name,
    p_customer_phone,
    p_notes,
    p_items,
    p_area_id,
    p_lat,
    p_lng,
    p_address_text,
    p_payment_method,
    p_coupon_reservation_id,
    p_source
  ) r;

  if p_points_reservation_id is not null then
    if auth.uid() is null then raise exception 'points_auth_required'; end if;
    select * into v_order from public.orders where id = v_order_id for update;
    select * into v_points from public.points_reservations where id = p_points_reservation_id for update;
    if v_points.id is null or v_points.status <> 'reserved' or v_points.expires_at <= now() then raise exception 'points_reservation_invalid'; end if;
    if v_points.tenant_id <> v_order.tenant_id or v_points.customer_id <> v_order.customer_id then raise exception 'points_reservation_mismatch'; end if;
    select user_id into v_customer_user from public.customers where id = v_order.customer_id;
    if v_customer_user is null or v_customer_user <> auth.uid() then raise exception 'points_auth_required'; end if;
    if v_points.discount_amount > greatest(v_order.subtotal - v_order.discount_total, 0) then raise exception 'points_exceed_order'; end if;
    select coalesce(vat_rate, 0.15) into v_tax_rate from public.tenants where id = v_order.tenant_id;
    v_taxable := greatest(v_order.subtotal - v_order.discount_total - v_points.discount_amount, 0);
    v_total := v_taxable + v_order.deposit_total + v_order.delivery_fee;
    update public.orders
      set points_total = v_points.discount_amount,
          points_reservation_id = v_points.id,
          tax_total = round(v_taxable - (v_taxable / (1 + v_tax_rate)), 2),
          total = v_total,
          updated_at = now()
      where id = v_order.id;
    update public.points_reservations
      set order_id = v_order.id,
          status = 'attached',
          expires_at = case when p_payment_method = 'online' then now() + interval '30 minutes' else expires_at end,
          updated_at = now()
      where id = v_points.id;
    if p_payment_method <> 'online' then perform app.points_consume_order(v_order.id); end if;
  end if;

  if p_wallet_reservation_id is not null then
    if auth.uid() is null then raise exception 'wallet_auth_required'; end if;
    select * into v_order from public.orders where id = v_order_id for update;
    select * into v_wallet from public.wallet_reservations where id = p_wallet_reservation_id for update;
    if v_wallet.id is null or v_wallet.status <> 'reserved' or v_wallet.expires_at <= now() then raise exception 'wallet_reservation_invalid'; end if;
    if v_wallet.tenant_id <> v_order.tenant_id or v_wallet.customer_id <> v_order.customer_id then raise exception 'wallet_reservation_mismatch'; end if;
    select user_id into v_customer_user from public.customers where id = v_order.customer_id;
    if v_customer_user is null or v_customer_user <> auth.uid() then raise exception 'wallet_auth_required'; end if;
    v_wallet_amount := least(v_wallet.amount, greatest(v_order.subtotal - v_order.discount_total - v_order.points_total, 0));
    if v_wallet_amount <= 0 then raise exception 'wallet_not_applicable'; end if;
    select coalesce(vat_rate, 0.15) into v_tax_rate from public.tenants where id = v_order.tenant_id;
    v_taxable := greatest(v_order.subtotal - v_order.discount_total - v_order.points_total - v_wallet_amount, 0);
    v_total := v_taxable + v_order.deposit_total + v_order.delivery_fee;
    update public.orders
      set wallet_total = v_wallet_amount,
          wallet_reservation_id = v_wallet.id,
          tax_total = round(v_taxable - (v_taxable / (1 + v_tax_rate)), 2),
          total = v_total,
          updated_at = now()
      where id = v_order.id;
    update public.wallet_reservations
      set order_id = v_order.id,
          amount = v_wallet_amount,
          status = case when p_payment_method = 'online' then 'attached' else 'consumed' end,
          consumed_at = case when p_payment_method = 'online' then null else now() end,
          expires_at = case when p_payment_method = 'online' then now() + interval '30 minutes' else expires_at end,
          updated_at = now()
      where id = v_wallet.id;
    if p_payment_method <> 'online' then
      perform app.wallet_post(
        v_wallet.wallet_id,
        -v_wallet_amount,
        'order payment',
        'order',
        v_order.id::text,
        null,
        null,
        'order:' || v_order.id::text || ':wallet_debit',
        jsonb_build_object('order_id', v_order.id)
      );
    end if;
  end if;

  return query select v_order_id, (select o.total from public.orders o where o.id = v_order_id);
end;
$$;

revoke all on function public.storefront_place_order(text,uuid,order_type,text,text,text,jsonb,uuid,numeric,numeric,text) from public, anon, authenticated;
revoke all on function public.storefront_place_order_v2(text,uuid,order_type,text,text,text,jsonb,uuid,numeric,numeric,text,text) from public, anon, authenticated;
revoke all on function public.storefront_place_order_v3(text,uuid,order_type,text,text,text,jsonb,uuid,numeric,numeric,text,text,uuid,text) from public, anon, authenticated;
revoke all on function public.storefront_place_order_v4(text,uuid,order_type,text,text,text,jsonb,uuid,numeric,numeric,text,text,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.storefront_place_order_v5(text,uuid,order_type,text,text,text,jsonb,uuid,numeric,numeric,text,text,uuid,uuid,uuid,text) from public;
grant execute on function public.storefront_place_order_v5(text,uuid,order_type,text,text,text,jsonb,uuid,numeric,numeric,text,text,uuid,uuid,uuid,text) to anon, authenticated;
