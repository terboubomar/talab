-- Cover coupon-engine foreign keys identified by Supabase performance advisor.
create index if not exists coupon_scopes_tenant_id_idx on public.coupon_scopes(tenant_id);
create index if not exists coupon_reservations_tenant_id_idx on public.coupon_reservations(tenant_id);
create index if not exists coupon_reservations_customer_id_idx on public.coupon_reservations(customer_id);
create index if not exists coupon_reservations_branch_id_idx on public.coupon_reservations(branch_id);
create index if not exists coupon_redemptions_tenant_id_idx on public.coupon_redemptions(tenant_id);
create index if not exists coupon_redemptions_order_id_idx on public.coupon_redemptions(order_id);
create index if not exists orders_coupon_reservation_id_idx on public.orders(coupon_reservation_id);
