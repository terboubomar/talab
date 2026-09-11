-- TALAB Phase 2 — coupon engine foundation.
-- Source of truth: BUILD-SPEC coupon rules + atomic reservation TTL.
-- This migration completes explicit coupon codes end-to-end. auto_apply is stored
-- now and will be activated only after the explicit-code path is verified.

alter table public.customers
  add column if not exists customer_group_id uuid references public.customer_groups(id) on delete set null;
create index if not exists customers_customer_group_id_idx on public.customers(customer_group_id);

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  discount_type text not null check (discount_type in ('percent','fixed')),
  value numeric(12,2) not null default 0 check (value >= 0),
  max_discount numeric(12,2) check (max_discount is null or max_discount >= 0),
  free_delivery boolean not null default false,
  min_purchase numeric(12,2) not null default 0 check (min_purchase >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  total_limit integer check (total_limit is null or total_limit > 0),
  per_customer_limit integer check (per_customer_limit is null or per_customer_limit > 0),
  auto_apply boolean not null default false,
  day_parting_json jsonb not null default '{}'::jsonb,
  success_msg_ar text,
  success_msg_en text,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (value > 0 or free_delivery)
);
create unique index coupons_tenant_code_uidx on public.coupons(tenant_id, lower(code));
create index coupons_tenant_status_idx on public.coupons(tenant_id, status, starts_at, ends_at);

create table public.coupon_scopes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  scope_type text not null check (scope_type in ('order_type','source','branch','product','category','customer_group','customer')),
  scope_id text not null,
  created_at timestamptz not null default now(),
  unique(coupon_id, scope_type, scope_id)
);
create index coupon_scopes_coupon_idx on public.coupon_scopes(coupon_id, scope_type);

create table public.coupon_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  cart_id uuid not null,
  customer_id uuid references public.customers(id) on delete set null,
  customer_phone text,
  branch_id uuid not null references public.branches(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  amount numeric(12,2) not null default 0,
  delivery_discount numeric(12,2) not null default 0,
  status text not null default 'reserved' check (status in ('reserved','attached','consumed','released','expired')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index coupon_reservations_active_cart_uidx on public.coupon_reservations(cart_id)
  where status in ('reserved','attached');
create index coupon_reservations_coupon_status_idx on public.coupon_reservations(coupon_id,status,expires_at);
create index coupon_reservations_order_idx on public.coupon_reservations(order_id);

create table public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  amount numeric(12,2) not null default 0,
  delivery_discount numeric(12,2) not null default 0,
  status text not null default 'redeemed' check (status in ('redeemed','voided')),
  at timestamptz not null default now(),
  voided_at timestamptz,
  unique(coupon_id,order_id)
);
create index coupon_redemptions_coupon_status_idx on public.coupon_redemptions(coupon_id,status);
create index coupon_redemptions_customer_idx on public.coupon_redemptions(customer_id,coupon_id,status);

alter table public.orders
  add column coupon_id uuid references public.coupons(id) on delete set null,
  add column coupon_code text,
  add column coupon_reservation_id uuid references public.coupon_reservations(id) on delete set null;
create index orders_coupon_id_idx on public.orders(coupon_id);

drop trigger if exists coupons_touch_updated_at on public.coupons;
create trigger coupons_touch_updated_at before update on public.coupons
for each row execute function app.touch_updated_at();

alter table public.coupons enable row level security;
alter table public.coupon_scopes enable row level security;
alter table public.coupon_reservations enable row level security;
alter table public.coupon_redemptions enable row level security;

create policy coupons_sel on public.coupons for select to authenticated
using ((tenant_id=app.current_tenant_id() and app.has_perm('coupons.view')) or app.is_platform_admin());
create policy coupons_ins on public.coupons for insert to authenticated
with check ((tenant_id=app.current_tenant_id() and app.has_perm('coupons.create')) or app.is_platform_admin());
create policy coupons_upd on public.coupons for update to authenticated
using ((tenant_id=app.current_tenant_id() and app.has_perm('coupons.update')) or app.is_platform_admin())
with check ((tenant_id=app.current_tenant_id() and app.has_perm('coupons.update')) or app.is_platform_admin());
create policy coupons_del on public.coupons for delete to authenticated
using ((tenant_id=app.current_tenant_id() and app.has_perm('coupons.delete')) or app.is_platform_admin());

create policy coupon_scopes_sel on public.coupon_scopes for select to authenticated
using ((tenant_id=app.current_tenant_id() and app.has_perm('coupons.view')) or app.is_platform_admin());
create policy coupon_scopes_ins on public.coupon_scopes for insert to authenticated
with check ((tenant_id=app.current_tenant_id() and app.has_perm('coupons.create')) or app.is_platform_admin());
create policy coupon_scopes_upd on public.coupon_scopes for update to authenticated
using ((tenant_id=app.current_tenant_id() and app.has_perm('coupons.update')) or app.is_platform_admin())
with check ((tenant_id=app.current_tenant_id() and app.has_perm('coupons.update')) or app.is_platform_admin());
create policy coupon_scopes_del on public.coupon_scopes for delete to authenticated
using ((tenant_id=app.current_tenant_id() and app.has_perm('coupons.delete')) or app.is_platform_admin());

create policy coupon_reservations_sel on public.coupon_reservations for select to authenticated
using ((tenant_id=app.current_tenant_id() and (app.has_perm('coupons.view') or app.has_perm('coupons.log.view'))) or app.is_platform_admin());
create policy coupon_redemptions_sel on public.coupon_redemptions for select to authenticated
using ((tenant_id=app.current_tenant_id() and (app.has_perm('coupons.view') or app.has_perm('coupons.log.view'))) or app.is_platform_admin());

grant select,insert,update,delete on public.coupons,public.coupon_scopes to authenticated;
grant select on public.coupon_reservations,public.coupon_redemptions to authenticated;
revoke all on public.coupons,public.coupon_scopes,public.coupon_reservations,public.coupon_redemptions from anon;

-- Day-parting JSON:
-- {"windows":[{"weekdays":[0,1,2,3,4,5,6],"start":"09:00","end":"23:00"}]}
-- PostgreSQL DOW is used (Sun=0). Cross-midnight windows are supported.
create or replace function app.coupon_daypart_allows(p_rule jsonb,p_at timestamptz default now())
returns boolean language plpgsql stable set search_path=public,app as $$
declare
  v_local timestamp:=p_at at time zone 'Asia/Riyadh';
  v_dow int:=extract(dow from v_local)::int;
  v_time time:=v_local::time;
  v_windows jsonb;
  v_window jsonb;
  v_start time;
  v_end time;
begin
  if p_rule is null or p_rule='{}'::jsonb then return true; end if;
  v_windows:=case when jsonb_typeof(p_rule->'windows')='array' then p_rule->'windows' else jsonb_build_array(p_rule) end;
  for v_window in select * from jsonb_array_elements(v_windows) loop
    if v_window?'weekdays' and not exists(select 1 from jsonb_array_elements_text(v_window->'weekdays') d where d::int=v_dow) then continue; end if;
    v_start:=coalesce(nullif(v_window->>'start','')::time,'00:00'::time);
    v_end:=coalesce(nullif(v_window->>'end','')::time,'23:59:59'::time);
    if (v_start<=v_end and v_time between v_start and v_end) or (v_start>v_end and (v_time>=v_start or v_time<=v_end)) then return true; end if;
  end loop;
  return false;
end; $$;

create or replace function app.coupon_discount_amount(p_coupon_id uuid,p_eligible numeric)
returns numeric language sql stable set search_path=public as $$
select round(greatest(least(
  case when c.discount_type='percent' then p_eligible*c.value/100 else c.value end,
  coalesce(c.max_discount,999999999::numeric),p_eligible),0),2)
from public.coupons c where c.id=p_coupon_id;
$$;

create or replace function app.coupon_order_scope_ok(p_coupon_id uuid,p_order_id uuid,p_source text default 'web')
returns boolean language plpgsql stable set search_path=public,app as $$
declare v_order record;
begin
  select o.id,o.branch_id,o.customer_id,o.order_type,c.customer_group_id into v_order
  from public.orders o join public.customers c on c.id=o.customer_id where o.id=p_order_id;
  if v_order.id is null then return false; end if;
  if exists(select 1 from public.coupon_scopes where coupon_id=p_coupon_id and scope_type='order_type') and not exists(select 1 from public.coupon_scopes where coupon_id=p_coupon_id and scope_type='order_type' and scope_id=v_order.order_type::text) then return false; end if;
  if exists(select 1 from public.coupon_scopes where coupon_id=p_coupon_id and scope_type='source') and not exists(select 1 from public.coupon_scopes where coupon_id=p_coupon_id and scope_type='source' and lower(scope_id)=lower(coalesce(p_source,'web'))) then return false; end if;
  if exists(select 1 from public.coupon_scopes where coupon_id=p_coupon_id and scope_type='branch') and not exists(select 1 from public.coupon_scopes where coupon_id=p_coupon_id and scope_type='branch' and scope_id=v_order.branch_id::text) then return false; end if;
  if exists(select 1 from public.coupon_scopes where coupon_id=p_coupon_id and scope_type='customer') and not exists(select 1 from public.coupon_scopes where coupon_id=p_coupon_id and scope_type='customer' and scope_id=v_order.customer_id::text) then return false; end if;
  if exists(select 1 from public.coupon_scopes where coupon_id=p_coupon_id and scope_type='customer_group') and not exists(select 1 from public.coupon_scopes where coupon_id=p_coupon_id and scope_type='customer_group' and scope_id=coalesce(v_order.customer_group_id::text,'')) then return false; end if;
  return true;
end; $$;

create or replace function app.coupon_order_eligible_subtotal(p_coupon_id uuid,p_order_id uuid)
returns numeric language sql stable set search_path=public as $$
select coalesce(sum(oi.line_total),0)
from public.order_items oi left join public.products p on p.id=oi.product_id
where oi.order_id=p_order_id and (
  not exists(select 1 from public.coupon_scopes cs where cs.coupon_id=p_coupon_id and cs.scope_type in ('product','category'))
  or exists(select 1 from public.coupon_scopes cs where cs.coupon_id=p_coupon_id and cs.scope_type='product' and cs.scope_id=oi.product_id::text)
  or exists(select 1 from public.coupon_scopes cs where cs.coupon_id=p_coupon_id and cs.scope_type='category' and cs.scope_id=p.category_id::text)
);
$$;

create or replace function public.storefront_coupon_quote(
  p_branch_id uuid,p_order_type public.order_type,p_customer_phone text,p_code text,
  p_items jsonb,p_cart_id uuid,p_area_id uuid default null,p_source text default 'web'
)
returns jsonb language plpgsql security definer set search_path=public,app as $$
declare
  v_branch record;
  v_coupon public.coupons%rowtype;
  v_customer record;
  v_item jsonb;
  v_product record;
  v_mod_json jsonb;
  v_mod_id uuid;
  v_mod_row record;
  v_qty int;
  v_price numeric;
  v_line numeric;
  v_mod_sum numeric;
  v_subtotal numeric:=0;
  v_eligible numeric:=0;
  v_deposit numeric:=0;
  v_delivery numeric:=0;
  v_discount numeric:=0;
  v_delivery_discount numeric:=0;
  v_total numeric:=0;
  v_has_item_scope boolean;
  v_zone record;
  v_reservation_id uuid;
  v_expires timestamptz:=now()+interval '10 minutes';
  v_used int:=0;
  v_customer_used int:=0;
begin
  if p_cart_id is null then raise exception 'cart_id_required'; end if;
  if p_code is null or length(trim(p_code))=0 then raise exception 'coupon_code_required'; end if;
  if p_items is null or jsonb_array_length(p_items)=0 then raise exception 'empty_order'; end if;

  select b.id,b.tenant_id,b.brand_id into v_branch from public.branches b where b.id=p_branch_id and b.status='active';
  if v_branch.id is null then raise exception 'invalid_branch'; end if;

  select * into v_coupon from public.coupons c
  where c.tenant_id=v_branch.tenant_id and lower(c.code)=lower(trim(p_code)) for update;
  if v_coupon.id is null then raise exception 'coupon_not_found'; end if;
  if v_coupon.status<>'active' then raise exception 'coupon_inactive'; end if;
  if v_coupon.starts_at is not null and now()<v_coupon.starts_at then raise exception 'coupon_not_started'; end if;
  if v_coupon.ends_at is not null and now()>v_coupon.ends_at then raise exception 'coupon_expired'; end if;
  if not app.coupon_daypart_allows(v_coupon.day_parting_json,now()) then raise exception 'coupon_outside_schedule'; end if;

  select c.id,c.customer_group_id into v_customer from public.customers c
  where c.tenant_id=v_branch.tenant_id and c.phone=trim(coalesce(p_customer_phone,'')) limit 1;

  if exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='order_type') and not exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='order_type' and scope_id=p_order_type::text) then raise exception 'coupon_scope_mismatch'; end if;
  if exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='source') and not exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='source' and lower(scope_id)=lower(coalesce(p_source,'web'))) then raise exception 'coupon_scope_mismatch'; end if;
  if exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='branch') and not exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='branch' and scope_id=p_branch_id::text) then raise exception 'coupon_scope_mismatch'; end if;
  if exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='customer') and (v_customer.id is null or not exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='customer' and scope_id=v_customer.id::text)) then raise exception 'coupon_scope_mismatch'; end if;
  if exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='customer_group') and (v_customer.customer_group_id is null or not exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='customer_group' and scope_id=v_customer.customer_group_id::text)) then raise exception 'coupon_scope_mismatch'; end if;

  v_has_item_scope:=exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type in ('product','category'));

  for v_item in select * from jsonb_array_elements(p_items) loop
    select p.id,p.category_id,p.price,p.discount_amount,p.discount_is_percent,p.deposit_amount,p.min_qty,p.max_qty
    into v_product from public.products p
    where p.id=(v_item->>'product_id')::uuid and p.tenant_id=v_branch.tenant_id and p.active and p.orderable and p.deleted_at is null;
    if v_product.id is null then raise exception 'invalid_product'; end if;
    v_qty:=coalesce((v_item->>'qty')::int,1);
    if v_qty<coalesce(v_product.min_qty,1) then raise exception 'qty_below_minimum'; end if;
    if v_product.max_qty is not null and v_qty>v_product.max_qty then raise exception 'qty_above_maximum'; end if;

    select coalesce((select pbp.price from public.product_branch_prices pbp where pbp.product_id=v_product.id and pbp.branch_id=p_branch_id),v_product.price) into v_price;
    if coalesce(v_product.discount_amount,0)>0 then
      v_price:=case when v_product.discount_is_percent then greatest(v_price-(v_price*v_product.discount_amount/100),0) else greatest(v_price-v_product.discount_amount,0) end;
    end if;

    v_mod_sum:=0;
    for v_mod_json in select * from jsonb_array_elements(coalesce(v_item->'modifier_ids','[]'::jsonb)) loop
      v_mod_id:=(v_mod_json#>>'{}')::uuid;
      select m.id,m.price into v_mod_row
      from public.modifiers m join public.product_modifier_groups pmg on pmg.group_id=m.group_id and pmg.product_id=v_product.id
      where m.id=v_mod_id and m.tenant_id=v_branch.tenant_id and m.active;
      if v_mod_row.id is null then raise exception 'invalid_modifier'; end if;
      v_mod_sum:=v_mod_sum+(v_mod_row.price*v_qty);
    end loop;

    v_line:=v_price*v_qty+v_mod_sum;
    v_subtotal:=v_subtotal+v_line;
    v_deposit:=v_deposit+coalesce(v_product.deposit_amount,0)*v_qty;
    if not v_has_item_scope
      or exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='product' and scope_id=v_product.id::text)
      or exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='category' and scope_id=v_product.category_id::text)
    then v_eligible:=v_eligible+v_line; end if;
  end loop;

  if v_subtotal<v_coupon.min_purchase then raise exception 'coupon_min_purchase'; end if;
  if v_eligible<=0 then raise exception 'coupon_scope_mismatch'; end if;

  if p_order_type='delivery' then
    if p_area_id is null then raise exception 'missing_delivery_area'; end if;
    select dz.fee,dz.min_order,dz.below_min_fee into v_zone
    from public.delivery_zones dz where dz.branch_id=p_branch_id and dz.area_id=p_area_id and dz.enabled;
    if v_zone.fee is null then raise exception 'invalid_delivery_area'; end if;
    v_delivery:=case when v_subtotal>=v_zone.min_order then v_zone.fee else v_zone.below_min_fee end;
  end if;

  v_discount:=app.coupon_discount_amount(v_coupon.id,v_eligible);
  v_delivery_discount:=case when v_coupon.free_delivery and p_order_type='delivery' then v_delivery else 0 end;

  update public.coupon_reservations set status='expired',updated_at=now()
  where coupon_id=v_coupon.id and status='reserved' and expires_at<=now();
  update public.coupon_reservations set status='released',updated_at=now()
  where cart_id=p_cart_id and coupon_id<>v_coupon.id and status='reserved';

  select count(*) into v_used from public.coupon_redemptions where coupon_id=v_coupon.id and status='redeemed';
  v_used:=v_used+(select count(*) from public.coupon_reservations
    where coupon_id=v_coupon.id and cart_id<>p_cart_id and (status='attached' or (status='reserved' and expires_at>now())));
  if v_coupon.total_limit is not null and v_used>=v_coupon.total_limit then raise exception 'coupon_total_limit'; end if;

  if v_coupon.per_customer_limit is not null then
    select count(*) into v_customer_used from public.coupon_redemptions
      where coupon_id=v_coupon.id and status='redeemed' and v_customer.id is not null and customer_id=v_customer.id;
    v_customer_used:=v_customer_used+(select count(*) from public.coupon_reservations r
      where r.coupon_id=v_coupon.id and r.cart_id<>p_cart_id
      and (r.status='attached' or (r.status='reserved' and r.expires_at>now()))
      and ((v_customer.id is not null and r.customer_id=v_customer.id) or (v_customer.id is null and r.customer_phone=trim(p_customer_phone))));
    if v_customer_used>=v_coupon.per_customer_limit then raise exception 'coupon_customer_limit'; end if;
  end if;

  insert into public.coupon_reservations(tenant_id,coupon_id,cart_id,customer_id,customer_phone,branch_id,amount,delivery_discount,status,expires_at)
  values(v_branch.tenant_id,v_coupon.id,p_cart_id,v_customer.id,trim(coalesce(p_customer_phone,'')),p_branch_id,v_discount,v_delivery_discount,'reserved',v_expires)
  on conflict (cart_id) where status in ('reserved','attached') do update set
    coupon_id=excluded.coupon_id,customer_id=excluded.customer_id,customer_phone=excluded.customer_phone,
    branch_id=excluded.branch_id,amount=excluded.amount,delivery_discount=excluded.delivery_discount,
    status='reserved',expires_at=excluded.expires_at,order_id=null,updated_at=now()
  returning id into v_reservation_id;

  v_total:=greatest(v_subtotal-v_discount,0)+v_deposit+greatest(v_delivery-v_delivery_discount,0);
  return jsonb_build_object(
    'coupon_id',v_coupon.id,'code',v_coupon.code,'reservation_id',v_reservation_id,
    'discount',v_discount,'delivery_discount',v_delivery_discount,'subtotal',v_subtotal,
    'total',v_total,'expires_at',v_expires,'success_msg_ar',v_coupon.success_msg_ar,'success_msg_en',v_coupon.success_msg_en
  );
end; $$;

revoke execute on function public.storefront_coupon_quote(uuid,public.order_type,text,text,jsonb,uuid,uuid,text) from public;
grant execute on function public.storefront_coupon_quote(uuid,public.order_type,text,text,jsonb,uuid,uuid,text) to anon,authenticated;

create or replace function app.coupon_finalize_order(p_order_id uuid)
returns void language plpgsql security definer set search_path=public,app as $$
declare v_order record; v_res record;
begin
  select * into v_order from public.orders where id=p_order_id;
  if v_order.id is null or v_order.coupon_id is null then return; end if;
  select * into v_res from public.coupon_reservations where id=v_order.coupon_reservation_id for update;
  if v_res.id is null or v_res.status='consumed' then return; end if;
  update public.coupon_reservations set status='consumed',consumed_at=now(),updated_at=now() where id=v_res.id;
  insert into public.coupon_redemptions(tenant_id,coupon_id,order_id,customer_id,amount,delivery_discount,status)
  values(v_order.tenant_id,v_order.coupon_id,v_order.id,v_order.customer_id,v_order.discount_total,v_res.delivery_discount,'redeemed')
  on conflict(coupon_id,order_id) do update set status='redeemed',voided_at=null,amount=excluded.amount,delivery_discount=excluded.delivery_discount;
end; $$;

create or replace function public.storefront_place_order_v3(
  p_tenant_slug text,p_branch_id uuid,p_order_type public.order_type,p_customer_name text,p_customer_phone text,
  p_notes text,p_items jsonb,p_area_id uuid default null,p_lat numeric default null,p_lng numeric default null,
  p_address_text text default null,p_payment_method text default 'cash',p_coupon_reservation_id uuid default null,p_source text default 'web'
)
returns table(order_id uuid,total numeric) language plpgsql security definer set search_path=public,app as $$
declare
  v_order_id uuid; v_total numeric; v_order public.orders%rowtype; v_coupon public.coupons%rowtype;
  v_res public.coupon_reservations%rowtype; v_eligible numeric; v_discount numeric; v_delivery numeric; v_tax_rate numeric; v_taxable numeric;
begin
  select r.order_id,r.total into v_order_id,v_total
  from public.storefront_place_order_v2(p_tenant_slug,p_branch_id,p_order_type,p_customer_name,p_customer_phone,p_notes,p_items,p_area_id,p_lat,p_lng,p_address_text,p_payment_method) r;
  if p_coupon_reservation_id is null then return query select v_order_id,v_total; return; end if;

  select * into v_order from public.orders where id=v_order_id for update;
  select * into v_res from public.coupon_reservations where id=p_coupon_reservation_id for update;
  if v_res.id is null or v_res.status<>'reserved' or v_res.expires_at<=now() then raise exception 'coupon_reservation_invalid'; end if;
  if v_res.tenant_id<>v_order.tenant_id or v_res.branch_id<>v_order.branch_id or v_res.customer_phone<>trim(p_customer_phone) then raise exception 'coupon_reservation_mismatch'; end if;

  select * into v_coupon from public.coupons where id=v_res.coupon_id for update;
  if v_coupon.id is null or v_coupon.status<>'active' then raise exception 'coupon_inactive'; end if;
  if v_coupon.starts_at is not null and now()<v_coupon.starts_at then raise exception 'coupon_not_started'; end if;
  if v_coupon.ends_at is not null and now()>v_coupon.ends_at then raise exception 'coupon_expired'; end if;
  if not app.coupon_daypart_allows(v_coupon.day_parting_json,now()) then raise exception 'coupon_outside_schedule'; end if;
  if not app.coupon_order_scope_ok(v_coupon.id,v_order.id,p_source) then raise exception 'coupon_scope_mismatch'; end if;
  if v_order.subtotal<v_coupon.min_purchase then raise exception 'coupon_min_purchase'; end if;

  v_eligible:=app.coupon_order_eligible_subtotal(v_coupon.id,v_order.id);
  if v_eligible<=0 then raise exception 'coupon_scope_mismatch'; end if;
  v_discount:=app.coupon_discount_amount(v_coupon.id,v_eligible);
  v_delivery:=case when v_coupon.free_delivery and v_order.order_type='delivery' then 0 else v_order.delivery_fee end;
  select coalesce(t.vat_rate,0.15) into v_tax_rate from public.tenants t where t.id=v_order.tenant_id;
  v_taxable:=greatest(v_order.subtotal-v_discount,0);
  v_total:=v_taxable+v_order.deposit_total+v_delivery;

  update public.orders set
    coupon_id=v_coupon.id,coupon_code=v_coupon.code,coupon_reservation_id=v_res.id,
    discount_total=v_discount,delivery_fee=v_delivery,
    tax_total=round(v_taxable-(v_taxable/(1+v_tax_rate)),2),total=v_total,updated_at=now()
  where id=v_order.id;

  update public.coupon_reservations set
    order_id=v_order.id,amount=v_discount,
    delivery_discount=greatest(v_order.delivery_fee-v_delivery,0),
    status=case when p_payment_method='online' then 'attached' else 'consumed' end,
    consumed_at=case when p_payment_method='online' then null else now() end,
    expires_at=case when p_payment_method='online' then now()+interval '30 minutes' else expires_at end,
    updated_at=now()
  where id=v_res.id;

  if p_payment_method<>'online' then perform app.coupon_finalize_order(v_order.id); end if;
  return query select v_order.id,v_total;
end; $$;

revoke execute on function public.storefront_place_order_v3(text,uuid,public.order_type,text,text,text,jsonb,uuid,numeric,numeric,text,text,uuid,text) from public;
grant execute on function public.storefront_place_order_v3(text,uuid,public.order_type,text,text,text,jsonb,uuid,numeric,numeric,text,text,uuid,text) to anon,authenticated;

create or replace function app.coupon_order_state_sync()
returns trigger language plpgsql security definer set search_path=public,app as $$
begin
  if new.coupon_id is null then return new; end if;
  if new.payment_method='online' and new.payment_status in ('paid','partially_refunded','refunded') and old.payment_status is distinct from new.payment_status then
    perform app.coupon_finalize_order(new.id);
  elsif new.payment_method='online' and new.payment_status in ('failed','cancelled') and old.payment_status is distinct from new.payment_status then
    update public.coupon_reservations set status='released',updated_at=now() where id=new.coupon_reservation_id and status='attached';
  end if;
  if new.status='cancelled' and old.status is distinct from new.status then
    update public.coupon_redemptions set status='voided',voided_at=now() where order_id=new.id and status='redeemed';
    update public.coupon_reservations set status='released',updated_at=now() where order_id=new.id and status in ('reserved','attached');
  end if;
  return new;
end; $$;

drop trigger if exists orders_coupon_state_sync on public.orders;
create trigger orders_coupon_state_sync after update of payment_status,status on public.orders
for each row execute function app.coupon_order_state_sync();
