-- TALAB Phase 2 — wallet foundation.
-- Source of truth: BUILD-SPEC wallets + immutable wallet_ledger and atomic money movements.
-- Storefront spending is authenticated-customer only; anonymous phone entry is never sufficient
-- to spend stored wallet value.

create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  balance numeric(12,2) not null default 0 check (balance >= 0),
  currency char(3) not null default 'SAR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, customer_id)
);

create table public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  delta numeric(12,2) not null check (delta <> 0),
  balance_after numeric(12,2) not null check (balance_after >= 0),
  reason text not null check (length(trim(reason)) >= 2),
  ref_type text,
  ref_id text,
  actor_staff_id uuid references public.staff(id) on delete set null,
  actor_name text,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

create unique index wallet_ledger_idempotency_uidx
  on public.wallet_ledger(wallet_id, idempotency_key)
  where idempotency_key is not null;
create index wallet_ledger_customer_at_idx on public.wallet_ledger(customer_id, at desc);
create index wallet_ledger_tenant_at_idx on public.wallet_ledger(tenant_id, at desc);

create table public.wallet_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  cart_id uuid not null,
  order_id uuid references public.orders(id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'reserved' check (status in ('reserved','attached','consumed','released','expired')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index wallet_reservations_active_cart_uidx
  on public.wallet_reservations(cart_id)
  where status in ('reserved','attached');
create index wallet_reservations_wallet_status_idx on public.wallet_reservations(wallet_id,status,expires_at);
create index wallet_reservations_order_idx on public.wallet_reservations(order_id);
create index wallet_reservations_tenant_idx on public.wallet_reservations(tenant_id);
create index wallet_reservations_customer_idx on public.wallet_reservations(customer_id);

alter table public.orders
  add column wallet_total numeric(12,2) not null default 0 check (wallet_total >= 0),
  add column wallet_reservation_id uuid references public.wallet_reservations(id) on delete set null;
create index orders_wallet_reservation_id_idx on public.orders(wallet_reservation_id);

alter table public.wallets enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.wallet_reservations enable row level security;

create policy wallets_sel on public.wallets for select to authenticated
using (
  (tenant_id = app.current_tenant_id() and (app.has_perm('customers.view') or app.has_perm('customers.wallet.adjust')))
  or app.is_platform_admin()
);

create policy wallet_ledger_sel on public.wallet_ledger for select to authenticated
using (
  (tenant_id = app.current_tenant_id() and (app.has_perm('customers.activity.view') or app.has_perm('customers.wallet.adjust')))
  or app.is_platform_admin()
);

create policy wallet_reservations_sel on public.wallet_reservations for select to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.has_perm('customers.wallet.adjust'))
  or app.is_platform_admin()
);

grant select on public.wallets to authenticated;
grant select on public.wallet_ledger to authenticated;
grant select on public.wallet_reservations to authenticated;
revoke all on public.wallets, public.wallet_ledger, public.wallet_reservations from anon;
revoke insert, update, delete on public.wallets, public.wallet_ledger, public.wallet_reservations from authenticated;

-- All balance changes pass through this function. The ledger is append-only and balance_after
-- is recorded inside the same row-locking transaction.
create or replace function app.wallet_post(
  p_wallet_id uuid,
  p_delta numeric,
  p_reason text,
  p_ref_type text default null,
  p_ref_id text default null,
  p_actor_staff_id uuid default null,
  p_actor_name text default null,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_wallet public.wallets%rowtype;
  v_existing public.wallet_ledger%rowtype;
  v_balance numeric;
  v_ledger_id uuid;
begin
  if p_delta is null or round(p_delta,2) = 0 then raise exception 'wallet_delta_required'; end if;
  if p_reason is null or length(trim(p_reason)) < 2 then raise exception 'wallet_reason_required'; end if;

  select * into v_wallet from public.wallets where id=p_wallet_id for update;
  if v_wallet.id is null then raise exception 'wallet_not_found'; end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.wallet_ledger
    where wallet_id=p_wallet_id and idempotency_key=p_idempotency_key;
    if v_existing.id is not null then
      return jsonb_build_object('ledger_id',v_existing.id,'balance',v_existing.balance_after,'idempotent',true);
    end if;
  end if;

  v_balance := round(v_wallet.balance + round(p_delta,2), 2);
  if v_balance < 0 then raise exception 'insufficient_wallet_balance'; end if;

  update public.wallets set balance=v_balance, updated_at=now() where id=v_wallet.id;
  insert into public.wallet_ledger(
    tenant_id,wallet_id,customer_id,delta,balance_after,reason,ref_type,ref_id,
    actor_staff_id,actor_name,idempotency_key,metadata
  ) values (
    v_wallet.tenant_id,v_wallet.id,v_wallet.customer_id,round(p_delta,2),v_balance,trim(p_reason),
    nullif(trim(coalesce(p_ref_type,'')),''),nullif(trim(coalesce(p_ref_id,'')),''),
    p_actor_staff_id,p_actor_name,p_idempotency_key,coalesce(p_metadata,'{}'::jsonb)
  ) returning id into v_ledger_id;

  return jsonb_build_object('ledger_id',v_ledger_id,'balance',v_balance,'idempotent',false);
end;
$$;
revoke all on function app.wallet_post(uuid,numeric,text,text,text,uuid,text,text,jsonb) from public, anon, authenticated;

create or replace function app.wallet_get_or_create(p_tenant_id uuid,p_customer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare v_wallet_id uuid; v_customer_tenant uuid;
begin
  select tenant_id into v_customer_tenant from public.customers where id=p_customer_id;
  if v_customer_tenant is null or v_customer_tenant<>p_tenant_id then raise exception 'invalid_customer'; end if;
  insert into public.wallets(tenant_id,customer_id,currency)
  values(p_tenant_id,p_customer_id,'SAR')
  on conflict(tenant_id,customer_id) do nothing;
  select id into v_wallet_id from public.wallets where tenant_id=p_tenant_id and customer_id=p_customer_id;
  return v_wallet_id;
end;
$$;
revoke all on function app.wallet_get_or_create(uuid,uuid) from public, anon, authenticated;

create or replace function app.wallet_expire_reservations(p_wallet_id uuid)
returns void language sql security definer set search_path=public,app as $$
  update public.wallet_reservations
  set status='expired',updated_at=now()
  where wallet_id=p_wallet_id and status='reserved' and expires_at<=now();
$$;
revoke all on function app.wallet_expire_reservations(uuid) from public, anon, authenticated;

create or replace function public.staff_adjust_wallet(p_customer_id uuid,p_delta numeric,p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_tenant uuid;
  v_wallet_id uuid;
  v_staff record;
  v_reserved numeric:=0;
  v_balance numeric:=0;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant:=app.current_tenant_id();
  if v_tenant is null and not app.is_platform_admin() then raise exception 'not_authorized'; end if;
  if not app.has_perm('customers.wallet.adjust') and not app.is_platform_admin() then raise exception 'not_authorized'; end if;
  if not exists(select 1 from public.customers where id=p_customer_id and (tenant_id=v_tenant or app.is_platform_admin())) then raise exception 'customer_not_found'; end if;

  if app.is_platform_admin() and v_tenant is null then
    select tenant_id into v_tenant from public.customers where id=p_customer_id;
  end if;
  v_wallet_id:=app.wallet_get_or_create(v_tenant,p_customer_id);
  perform app.wallet_expire_reservations(v_wallet_id);

  if p_delta < 0 then
    select balance into v_balance from public.wallets where id=v_wallet_id for update;
    select coalesce(sum(amount),0) into v_reserved from public.wallet_reservations
      where wallet_id=v_wallet_id and status in ('reserved','attached') and expires_at>now();
    if v_balance + round(p_delta,2) < v_reserved then raise exception 'insufficient_available_wallet_balance'; end if;
  end if;

  select id,name into v_staff from public.staff where user_id=auth.uid() and tenant_id=v_tenant limit 1;
  v_result:=app.wallet_post(v_wallet_id,p_delta,p_reason,'staff_adjustment',null,v_staff.id,v_staff.name,null,
    jsonb_build_object('source','admin'));

  insert into public.activity_log(tenant_id,actor_id,actor_name,action,entity_type,entity_id,diff)
  values(v_tenant,v_staff.id,v_staff.name,'wallet.adjusted','customer',p_customer_id,
    jsonb_build_object('delta',round(p_delta,2),'reason',trim(p_reason),'balance',v_result->'balance'));
  return v_result;
end;
$$;
revoke execute on function public.staff_adjust_wallet(uuid,numeric,text) from public, anon;
grant execute on function public.staff_adjust_wallet(uuid,numeric,text) to authenticated;

-- Authenticated customer-only wallet snapshot. Staff authentication alone does not qualify:
-- auth.uid() must be linked to the customer row in the same tenant as the branch.
create or replace function public.storefront_my_wallet(p_branch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,app
as $$
declare v_tenant uuid; v_customer uuid; v_wallet uuid; v_balance numeric:=0; v_reserved numeric:=0;
begin
  if auth.uid() is null then return null; end if;
  select tenant_id into v_tenant from public.branches where id=p_branch_id and status='active';
  if v_tenant is null then raise exception 'invalid_branch'; end if;
  select id into v_customer from public.customers where tenant_id=v_tenant and user_id=auth.uid() limit 1;
  if v_customer is null then return null; end if;
  v_wallet:=app.wallet_get_or_create(v_tenant,v_customer);
  perform app.wallet_expire_reservations(v_wallet);
  select balance into v_balance from public.wallets where id=v_wallet;
  select coalesce(sum(amount),0) into v_reserved from public.wallet_reservations
    where wallet_id=v_wallet and status in ('reserved','attached') and expires_at>now();
  return jsonb_build_object('customer_id',v_customer,'wallet_id',v_wallet,'balance',v_balance,
    'available_balance',greatest(v_balance-v_reserved,0),'currency','SAR');
end;
$$;
revoke execute on function public.storefront_my_wallet(uuid) from public, anon;
grant execute on function public.storefront_my_wallet(uuid) to authenticated;

create or replace function public.storefront_wallet_reserve(p_branch_id uuid,p_cart_id uuid,p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path=public,app
as $$
declare
  v_tenant uuid; v_customer uuid; v_wallet uuid; v_balance numeric:=0; v_reserved numeric:=0;
  v_amount numeric; v_id uuid; v_expires timestamptz:=now()+interval '10 minutes';
begin
  if auth.uid() is null then raise exception 'wallet_auth_required'; end if;
  if p_cart_id is null then raise exception 'cart_id_required'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'wallet_amount_required'; end if;
  select tenant_id into v_tenant from public.branches where id=p_branch_id and status='active';
  if v_tenant is null then raise exception 'invalid_branch'; end if;
  select id into v_customer from public.customers where tenant_id=v_tenant and user_id=auth.uid() limit 1;
  if v_customer is null then raise exception 'wallet_auth_required'; end if;
  v_wallet:=app.wallet_get_or_create(v_tenant,v_customer);
  perform app.wallet_expire_reservations(v_wallet);
  select balance into v_balance from public.wallets where id=v_wallet for update;

  update public.wallet_reservations set status='released',updated_at=now()
  where cart_id=p_cart_id and order_id is null and status='reserved';

  select coalesce(sum(amount),0) into v_reserved from public.wallet_reservations
    where wallet_id=v_wallet and status in ('reserved','attached') and expires_at>now();
  v_amount:=least(round(p_amount,2),greatest(v_balance-v_reserved,0));
  if v_amount<=0 then raise exception 'insufficient_available_wallet_balance'; end if;

  insert into public.wallet_reservations(tenant_id,wallet_id,customer_id,cart_id,amount,status,expires_at)
  values(v_tenant,v_wallet,v_customer,p_cart_id,v_amount,'reserved',v_expires)
  returning id into v_id;
  return jsonb_build_object('reservation_id',v_id,'amount',v_amount,'expires_at',v_expires,
    'balance',v_balance,'available_balance',greatest(v_balance-v_reserved-v_amount,0),'currency','SAR');
end;
$$;
revoke execute on function public.storefront_wallet_reserve(uuid,uuid,numeric) from public, anon;
grant execute on function public.storefront_wallet_reserve(uuid,uuid,numeric) to authenticated;

create or replace function app.wallet_consume_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path=public,app
as $$
declare v_order record; v_res public.wallet_reservations%rowtype;
begin
  select id,wallet_total,wallet_reservation_id into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null or coalesce(v_order.wallet_total,0)<=0 or v_order.wallet_reservation_id is null then return; end if;
  select * into v_res from public.wallet_reservations where id=v_order.wallet_reservation_id for update;
  if v_res.id is null then raise exception 'wallet_reservation_missing'; end if;
  if v_res.status='consumed' then return; end if;
  if v_res.status<>'attached' then raise exception 'wallet_reservation_not_attached'; end if;
  perform app.wallet_post(v_res.wallet_id,-v_order.wallet_total,'order payment','order',p_order_id::text,null,null,
    'order:'||p_order_id::text||':wallet_debit',jsonb_build_object('order_id',p_order_id));
  update public.wallet_reservations set status='consumed',consumed_at=now(),updated_at=now() where id=v_res.id;
end;
$$;
revoke all on function app.wallet_consume_order(uuid) from public, anon, authenticated;

create or replace function app.wallet_release_order(p_order_id uuid)
returns void language plpgsql security definer set search_path=public,app as $$
declare v_res_id uuid;
begin
  select wallet_reservation_id into v_res_id from public.orders where id=p_order_id;
  if v_res_id is null then return; end if;
  update public.wallet_reservations set status='released',updated_at=now()
  where id=v_res_id and status in ('reserved','attached');
end;
$$;
revoke all on function app.wallet_release_order(uuid) from public, anon, authenticated;

create or replace function app.wallet_reverse_order(p_order_id uuid)
returns void language plpgsql security definer set search_path=public,app as $$
declare v_order record; v_res public.wallet_reservations%rowtype;
begin
  select id,wallet_total,wallet_reservation_id into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null or coalesce(v_order.wallet_total,0)<=0 or v_order.wallet_reservation_id is null then return; end if;
  select * into v_res from public.wallet_reservations where id=v_order.wallet_reservation_id for update;
  if v_res.id is null then return; end if;
  if v_res.status in ('reserved','attached') then perform app.wallet_release_order(p_order_id); return; end if;
  if v_res.status='consumed' then
    perform app.wallet_post(v_res.wallet_id,v_order.wallet_total,'cancelled order wallet return','order',p_order_id::text,null,null,
      'order:'||p_order_id::text||':wallet_reversal',jsonb_build_object('order_id',p_order_id,'reason','cancelled'));
  end if;
end;
$$;
revoke all on function app.wallet_reverse_order(uuid) from public, anon, authenticated;

-- Coupon-aware order placement + wallet reservation. Wallet only reduces the item-side payable
-- amount (after coupon), never delivery fee or deposit. Cash consumes immediately; online attaches
-- until verified payment succeeds.
create or replace function public.storefront_place_order_v4(
  p_tenant_slug text,
  p_branch_id uuid,
  p_order_type public.order_type,
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
  p_wallet_reservation_id uuid default null,
  p_source text default 'web'
)
returns table(order_id uuid,total numeric)
language plpgsql
security definer
set search_path=public,app
as $$
declare
  v_order_id uuid; v_total numeric; v_order public.orders%rowtype; v_res public.wallet_reservations%rowtype;
  v_customer_user uuid; v_wallet_amount numeric; v_taxable numeric; v_tax_rate numeric;
begin
  select r.order_id,r.total into v_order_id,v_total
  from public.storefront_place_order_v3(
    p_tenant_slug,p_branch_id,p_order_type,p_customer_name,p_customer_phone,p_notes,p_items,
    p_area_id,p_lat,p_lng,p_address_text,p_payment_method,p_coupon_reservation_id,p_source
  ) r;
  if p_wallet_reservation_id is null then return query select v_order_id,v_total; return; end if;
  if auth.uid() is null then raise exception 'wallet_auth_required'; end if;

  select * into v_order from public.orders where id=v_order_id for update;
  select * into v_res from public.wallet_reservations where id=p_wallet_reservation_id for update;
  if v_res.id is null or v_res.status<>'reserved' or v_res.expires_at<=now() then raise exception 'wallet_reservation_invalid'; end if;
  if v_res.tenant_id<>v_order.tenant_id or v_res.customer_id<>v_order.customer_id then raise exception 'wallet_reservation_mismatch'; end if;
  select user_id into v_customer_user from public.customers where id=v_order.customer_id;
  if v_customer_user is null or v_customer_user<>auth.uid() then raise exception 'wallet_auth_required'; end if;

  v_wallet_amount:=least(v_res.amount,greatest(v_order.subtotal-v_order.discount_total,0));
  if v_wallet_amount<=0 then raise exception 'wallet_not_applicable'; end if;
  select coalesce(vat_rate,0.15) into v_tax_rate from public.tenants where id=v_order.tenant_id;
  v_taxable:=greatest(v_order.subtotal-v_order.discount_total-v_wallet_amount,0);
  v_total:=v_taxable+v_order.deposit_total+v_order.delivery_fee;

  update public.orders set wallet_total=v_wallet_amount,wallet_reservation_id=v_res.id,
    tax_total=round(v_taxable-(v_taxable/(1+v_tax_rate)),2),total=v_total,updated_at=now()
  where id=v_order.id;
  update public.wallet_reservations set order_id=v_order.id,amount=v_wallet_amount,
    status=case when p_payment_method='online' then 'attached' else 'consumed' end,
    consumed_at=case when p_payment_method='online' then null else now() end,
    expires_at=case when p_payment_method='online' then now()+interval '30 minutes' else expires_at end,
    updated_at=now() where id=v_res.id;

  if p_payment_method<>'online' then
    perform app.wallet_post(v_res.wallet_id,-v_wallet_amount,'order payment','order',v_order.id::text,null,null,
      'order:'||v_order.id::text||':wallet_debit',jsonb_build_object('order_id',v_order.id));
  end if;
  return query select v_order.id,v_total;
end;
$$;
revoke execute on function public.storefront_place_order_v4(text,uuid,public.order_type,text,text,text,jsonb,uuid,numeric,numeric,text,text,uuid,uuid,text) from public;
grant execute on function public.storefront_place_order_v4(text,uuid,public.order_type,text,text,text,jsonb,uuid,numeric,numeric,text,text,uuid,uuid,text) to anon,authenticated;

create or replace function app.wallet_payment_status_trigger()
returns trigger language plpgsql security definer set search_path=public,app as $$
begin
  if new.payment_status in ('paid','partially_refunded') and old.payment_status is distinct from new.payment_status then
    perform app.wallet_consume_order(new.id);
  elsif new.payment_status in ('failed','cancelled') and old.payment_status is distinct from new.payment_status then
    perform app.wallet_release_order(new.id);
  end if;
  return new;
end;
$$;
revoke all on function app.wallet_payment_status_trigger() from public,anon,authenticated;
drop trigger if exists wallet_payment_status_sync on public.orders;
create trigger wallet_payment_status_sync after update of payment_status on public.orders
for each row execute function app.wallet_payment_status_trigger();

create or replace function app.wallet_order_status_trigger()
returns trigger language plpgsql security definer set search_path=public,app as $$
begin
  if new.status='cancelled' and old.status is distinct from new.status then
    perform app.wallet_reverse_order(new.id);
  end if;
  return new;
end;
$$;
revoke all on function app.wallet_order_status_trigger() from public,anon,authenticated;
drop trigger if exists wallet_order_status_sync on public.orders;
create trigger wallet_order_status_sync after update of status on public.orders
for each row execute function app.wallet_order_status_trigger();
