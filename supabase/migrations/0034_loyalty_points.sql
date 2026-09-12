-- TALAB Phase 2 — Loyalty points.
-- Source of truth: BUILD-SPEC loyalty_programs + immutable points_ledger.
-- Positive point grants create FIFO/expiry lots; redemption reservations allocate lots
-- before checkout so concurrent carts cannot double-spend the same points.

create table public.loyalty_programs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  earn_rate numeric(12,4) not null default 1 check (earn_rate >= 0),
  redeem_rate numeric(12,4) not null default 0.10 check (redeem_rate > 0),
  min_redeem numeric(14,2) not null default 0 check (min_redeem >= 0),
  expiry_days integer check (expiry_days is null or expiry_days > 0),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id)
);

create table public.points_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  delta numeric(14,2) not null check (delta <> 0),
  balance_after numeric(14,2) not null check (balance_after >= 0),
  reason text not null,
  ref_type text,
  ref_id text,
  actor_staff_id uuid references public.staff(id) on delete set null,
  actor_name text,
  idempotency_key text,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

create unique index points_ledger_idempotency_idx
  on public.points_ledger(tenant_id, idempotency_key)
  where idempotency_key is not null;
create index points_ledger_customer_at_idx on public.points_ledger(customer_id, at desc);
create index points_ledger_tenant_at_idx on public.points_ledger(tenant_id, at desc);
create index points_ledger_actor_staff_id_idx on public.points_ledger(actor_staff_id) where actor_staff_id is not null;

-- Mutable allocation state is kept outside the immutable ledger.
create table public.points_lots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  source_ledger_id uuid not null unique references public.points_ledger(id) on delete restrict,
  original_points numeric(14,2) not null check (original_points > 0),
  remaining_points numeric(14,2) not null check (remaining_points >= 0 and remaining_points <= original_points),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index points_lots_customer_expiry_idx on public.points_lots(customer_id, expires_at, created_at);
create index points_lots_tenant_id_idx on public.points_lots(tenant_id);

create table public.points_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  cart_id uuid not null,
  order_id uuid references public.orders(id) on delete set null,
  points numeric(14,2) not null check (points > 0),
  discount_amount numeric(14,2) not null check (discount_amount > 0),
  status text not null default 'reserved' check (status in ('reserved','attached','consumed','released','reversed')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index points_reservations_customer_idx on public.points_reservations(customer_id, status, expires_at);
create index points_reservations_tenant_idx on public.points_reservations(tenant_id, created_at desc);
create index points_reservations_order_idx on public.points_reservations(order_id) where order_id is not null;
create unique index points_reservations_cart_active_idx
  on public.points_reservations(customer_id, cart_id)
  where status in ('reserved','attached');

create table public.points_reservation_allocations (
  reservation_id uuid not null references public.points_reservations(id) on delete cascade,
  lot_id uuid not null references public.points_lots(id) on delete restrict,
  points numeric(14,2) not null check (points > 0),
  primary key (reservation_id, lot_id)
);
create index points_reservation_allocations_lot_idx on public.points_reservation_allocations(lot_id);

alter table public.orders
  add column points_total numeric(14,2) not null default 0 check (points_total >= 0),
  add column points_reservation_id uuid references public.points_reservations(id) on delete set null;
create index orders_points_reservation_id_idx on public.orders(points_reservation_id) where points_reservation_id is not null;

alter table public.loyalty_programs enable row level security;
alter table public.points_ledger enable row level security;
alter table public.points_lots enable row level security;
alter table public.points_reservations enable row level security;
alter table public.points_reservation_allocations enable row level security;

create policy loyalty_programs_staff_select on public.loyalty_programs
for select to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.has_perm('marketing.loyalty'))
  or app.is_platform_admin()
);

create policy points_ledger_staff_select on public.points_ledger
for select to authenticated
using (
  (tenant_id = app.current_tenant_id()
   and (app.has_perm('customers.activity.view') or app.has_perm('customers.points.adjust')))
  or app.is_platform_admin()
);

-- Operational allocation tables stay read-only to browser clients, but privileged
-- staff may inspect them under tenant/RBAC scope for support/debugging.
create policy points_lots_staff_select on public.points_lots
for select to authenticated
using (
  (tenant_id = app.current_tenant_id()
   and (app.has_perm('customers.activity.view') or app.has_perm('customers.points.adjust')))
  or app.is_platform_admin()
);
create policy points_reservations_staff_select on public.points_reservations
for select to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.has_perm('customers.points.adjust'))
  or app.is_platform_admin()
);
create policy points_reservation_allocations_staff_select on public.points_reservation_allocations
for select to authenticated
using (
  exists (
    select 1 from public.points_reservations r
    where r.id = reservation_id
      and ((r.tenant_id = app.current_tenant_id() and app.has_perm('customers.points.adjust')) or app.is_platform_admin())
  )
);

revoke insert, update, delete on public.loyalty_programs from anon, authenticated;
revoke insert, update, delete on public.points_ledger from anon, authenticated;
revoke insert, update, delete on public.points_lots from anon, authenticated;
revoke insert, update, delete on public.points_reservations from anon, authenticated;
revoke insert, update, delete on public.points_reservation_allocations from anon, authenticated;
revoke select on public.loyalty_programs, public.points_ledger, public.points_lots,
  public.points_reservations, public.points_reservation_allocations from anon;

grant select on public.loyalty_programs, public.points_ledger, public.points_lots,
  public.points_reservations, public.points_reservation_allocations to authenticated;

create or replace function app.points_release_reservation(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare v_res public.points_reservations%rowtype; v_alloc record;
begin
  select * into v_res from public.points_reservations where id=p_reservation_id for update;
  if v_res.id is null or v_res.status not in ('reserved','attached') then return; end if;
  for v_alloc in select lot_id, points from public.points_reservation_allocations where reservation_id=v_res.id loop
    update public.points_lots set remaining_points=remaining_points+v_alloc.points where id=v_alloc.lot_id;
  end loop;
  update public.points_reservations set status='released',updated_at=now() where id=v_res.id;
end;
$$;

create or replace function app.points_cleanup_customer(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare v_id uuid;
begin
  for v_id in
    select id from public.points_reservations
    where customer_id=p_customer_id and status='reserved' and expires_at<=now()
    for update
  loop
    perform app.points_release_reservation(v_id);
  end loop;
end;
$$;

create or replace function app.points_available(p_customer_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public, app
as $$
declare v_balance numeric;
begin
  perform app.points_cleanup_customer(p_customer_id);
  select coalesce(sum(remaining_points),0) into v_balance
  from public.points_lots
  where customer_id=p_customer_id
    and remaining_points>0
    and (expires_at is null or expires_at>now());
  return round(coalesce(v_balance,0),2);
end;
$$;

create or replace function app.points_post_credit(
  p_customer_id uuid, p_points numeric, p_reason text,
  p_ref_type text default null, p_ref_id text default null,
  p_actor_staff_id uuid default null, p_actor_name text default null,
  p_idempotency_key text default null, p_expires_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare v_tenant uuid; v_existing uuid; v_ledger uuid; v_balance numeric;
begin
  if p_points is null or p_points<=0 then raise exception 'invalid_points_amount'; end if;
  select tenant_id into v_tenant from public.customers where id=p_customer_id for update;
  if v_tenant is null then raise exception 'customer_not_found'; end if;
  if p_idempotency_key is not null then
    select id into v_existing from public.points_ledger where tenant_id=v_tenant and idempotency_key=p_idempotency_key;
    if v_existing is not null then return v_existing; end if;
  end if;
  v_balance:=app.points_available(p_customer_id)+round(p_points,2);
  insert into public.points_ledger(tenant_id,customer_id,delta,balance_after,reason,ref_type,ref_id,actor_staff_id,actor_name,idempotency_key,expires_at,metadata)
  values(v_tenant,p_customer_id,round(p_points,2),v_balance,trim(p_reason),p_ref_type,p_ref_id,p_actor_staff_id,p_actor_name,p_idempotency_key,p_expires_at,coalesce(p_metadata,'{}'::jsonb))
  returning id into v_ledger;
  insert into public.points_lots(tenant_id,customer_id,source_ledger_id,original_points,remaining_points,expires_at)
  values(v_tenant,p_customer_id,v_ledger,round(p_points,2),round(p_points,2),p_expires_at);
  return v_ledger;
end;
$$;

create or replace function app.points_post_debit(
  p_customer_id uuid, p_points numeric, p_reason text,
  p_ref_type text default null, p_ref_id text default null,
  p_actor_staff_id uuid default null, p_actor_name text default null,
  p_idempotency_key text default null, p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare v_tenant uuid; v_existing uuid; v_ledger uuid; v_needed numeric; v_take numeric; v_lot record; v_balance numeric;
begin
  if p_points is null or p_points<=0 then raise exception 'invalid_points_amount'; end if;
  select tenant_id into v_tenant from public.customers where id=p_customer_id for update;
  if v_tenant is null then raise exception 'customer_not_found'; end if;
  if p_idempotency_key is not null then
    select id into v_existing from public.points_ledger where tenant_id=v_tenant and idempotency_key=p_idempotency_key;
    if v_existing is not null then return v_existing; end if;
  end if;
  perform app.points_cleanup_customer(p_customer_id);
  if app.points_available(p_customer_id) < round(p_points,2) then raise exception 'insufficient_points'; end if;
  v_needed:=round(p_points,2);
  for v_lot in
    select id,remaining_points from public.points_lots
    where customer_id=p_customer_id and remaining_points>0 and (expires_at is null or expires_at>now())
    order by expires_at asc nulls last, created_at asc, id asc
    for update
  loop
    exit when v_needed<=0;
    v_take:=least(v_needed,v_lot.remaining_points);
    update public.points_lots set remaining_points=remaining_points-v_take where id=v_lot.id;
    v_needed:=v_needed-v_take;
  end loop;
  if v_needed>0 then raise exception 'insufficient_points'; end if;
  v_balance:=app.points_available(p_customer_id);
  insert into public.points_ledger(tenant_id,customer_id,delta,balance_after,reason,ref_type,ref_id,actor_staff_id,actor_name,idempotency_key,metadata)
  values(v_tenant,p_customer_id,-round(p_points,2),v_balance,trim(p_reason),p_ref_type,p_ref_id,p_actor_staff_id,p_actor_name,p_idempotency_key,coalesce(p_metadata,'{}'::jsonb))
  returning id into v_ledger;
  return v_ledger;
end;
$$;

create or replace function public.staff_adjust_points(p_customer_id uuid,p_delta numeric,p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare v_tenant uuid; v_staff record; v_program public.loyalty_programs%rowtype; v_ledger uuid; v_expiry timestamptz; v_balance numeric;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_delta is null or round(p_delta,2)=0 then raise exception 'invalid_points_amount'; end if;
  if length(trim(coalesce(p_reason,'')))<2 then raise exception 'reason_required'; end if;
  v_tenant:=app.current_tenant_id();
  if v_tenant is null or (not app.has_perm('customers.points.adjust') and not app.is_platform_admin()) then raise exception 'not_authorized'; end if;
  if not exists(select 1 from public.customers where id=p_customer_id and tenant_id=v_tenant) and not app.is_platform_admin() then raise exception 'customer_not_found'; end if;
  select id,name into v_staff from public.staff where user_id=auth.uid() and tenant_id=v_tenant limit 1;
  select * into v_program from public.loyalty_programs where tenant_id=(select tenant_id from public.customers where id=p_customer_id);
  if p_delta>0 then
    v_expiry:=case when v_program.expiry_days is not null then now()+make_interval(days=>v_program.expiry_days) else null end;
    v_ledger:=app.points_post_credit(p_customer_id,p_delta,trim(p_reason),'manual',null,v_staff.id,v_staff.name,null,v_expiry,jsonb_build_object('source','staff_adjustment'));
  else
    v_ledger:=app.points_post_debit(p_customer_id,abs(p_delta),trim(p_reason),'manual',null,v_staff.id,v_staff.name,null,jsonb_build_object('source','staff_adjustment'));
  end if;
  v_balance:=app.points_available(p_customer_id);
  insert into public.activity_log(tenant_id,actor_id,actor_name,action,entity_type,entity_id,diff)
  values((select tenant_id from public.customers where id=p_customer_id),v_staff.id,v_staff.name,'customer.points.adjust','customer',p_customer_id,
    jsonb_build_object('delta',round(p_delta,2),'balance',v_balance,'reason',trim(p_reason),'ledger_id',v_ledger));
  return jsonb_build_object('ledger_id',v_ledger,'balance',v_balance);
end;
$$;

create or replace function public.admin_save_loyalty_program(
  p_earn_rate numeric,p_redeem_rate numeric,p_min_redeem numeric,p_expiry_days integer,p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare v_tenant uuid; v_id uuid; v_staff record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant:=app.current_tenant_id();
  if v_tenant is null or (not app.has_perm('marketing.loyalty') and not app.is_platform_admin()) then raise exception 'not_authorized'; end if;
  if p_earn_rate is null or p_earn_rate<0 then raise exception 'invalid_earn_rate'; end if;
  if p_redeem_rate is null or p_redeem_rate<=0 then raise exception 'invalid_redeem_rate'; end if;
  if p_min_redeem is null or p_min_redeem<0 then raise exception 'invalid_min_redeem'; end if;
  if p_expiry_days is not null and p_expiry_days<=0 then raise exception 'invalid_expiry_days'; end if;
  insert into public.loyalty_programs(tenant_id,earn_rate,redeem_rate,min_redeem,expiry_days,active)
  values(v_tenant,round(p_earn_rate,4),round(p_redeem_rate,4),round(p_min_redeem,2),p_expiry_days,coalesce(p_active,false))
  on conflict(tenant_id) do update set earn_rate=excluded.earn_rate,redeem_rate=excluded.redeem_rate,min_redeem=excluded.min_redeem,expiry_days=excluded.expiry_days,active=excluded.active,updated_at=now()
  returning id into v_id;
  select id,name into v_staff from public.staff where user_id=auth.uid() and tenant_id=v_tenant limit 1;
  insert into public.activity_log(tenant_id,actor_id,actor_name,action,entity_type,entity_id,diff)
  values(v_tenant,v_staff.id,v_staff.name,'loyalty.program.update','loyalty_program',v_id,
    jsonb_build_object('earn_rate',p_earn_rate,'redeem_rate',p_redeem_rate,'min_redeem',p_min_redeem,'expiry_days',p_expiry_days,'active',p_active));
  return v_id;
end;
$$;

create or replace function public.staff_customer_points(p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare v_tenant uuid; v_balance numeric; v_next timestamptz;
begin
  v_tenant:=app.current_tenant_id();
  if v_tenant is null or (not app.has_perm('customers.view') and not app.is_platform_admin()) then raise exception 'not_authorized'; end if;
  if not exists(select 1 from public.customers where id=p_customer_id and (tenant_id=v_tenant or app.is_platform_admin())) then raise exception 'customer_not_found'; end if;
  v_balance:=app.points_available(p_customer_id);
  select min(expires_at) into v_next from public.points_lots where customer_id=p_customer_id and remaining_points>0 and expires_at>now();
  return jsonb_build_object('balance',v_balance,'next_expiry_at',v_next);
end;
$$;

create or replace function public.storefront_my_points(p_branch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare v_tenant uuid; v_customer uuid; v_program public.loyalty_programs%rowtype; v_balance numeric; v_next timestamptz;
begin
  if auth.uid() is null then raise exception 'points_auth_required'; end if;
  select tenant_id into v_tenant from public.branches where id=p_branch_id and status='active';
  if v_tenant is null then raise exception 'invalid_branch'; end if;
  select id into v_customer from public.customers where tenant_id=v_tenant and user_id=auth.uid();
  if v_customer is null then raise exception 'points_customer_required'; end if;
  select * into v_program from public.loyalty_programs where tenant_id=v_tenant and active;
  if v_program.id is null then return null; end if;
  v_balance:=app.points_available(v_customer);
  select min(expires_at) into v_next from public.points_lots where customer_id=v_customer and remaining_points>0 and expires_at>now();
  return jsonb_build_object('balance',v_balance,'redeem_rate',v_program.redeem_rate,'min_redeem',v_program.min_redeem,'expiry_days',v_program.expiry_days,'next_expiry_at',v_next);
end;
$$;

create or replace function public.storefront_points_reserve(p_branch_id uuid,p_cart_id uuid,p_points numeric)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare v_tenant uuid; v_customer uuid; v_program public.loyalty_programs%rowtype; v_available numeric; v_points numeric; v_res uuid; v_needed numeric; v_take numeric; v_lot record;
begin
  if auth.uid() is null then raise exception 'points_auth_required'; end if;
  if p_cart_id is null then raise exception 'cart_id_required'; end if;
  if p_points is null or p_points<=0 then raise exception 'invalid_points_amount'; end if;
  select tenant_id into v_tenant from public.branches where id=p_branch_id and status='active';
  if v_tenant is null then raise exception 'invalid_branch'; end if;
  select id into v_customer from public.customers where tenant_id=v_tenant and user_id=auth.uid() for update;
  if v_customer is null then raise exception 'points_customer_required'; end if;
  select * into v_program from public.loyalty_programs where tenant_id=v_tenant and active;
  if v_program.id is null then raise exception 'loyalty_inactive'; end if;
  perform app.points_cleanup_customer(v_customer);
  for v_res in select id from public.points_reservations where customer_id=v_customer and cart_id=p_cart_id and status='reserved' for update loop
    perform app.points_release_reservation(v_res);
  end loop;
  v_available:=app.points_available(v_customer);
  v_points:=least(round(p_points,2),v_available);
  if v_points<=0 then raise exception 'insufficient_points'; end if;
  if v_points<v_program.min_redeem then raise exception 'points_min_redeem'; end if;
  insert into public.points_reservations(tenant_id,customer_id,cart_id,points,discount_amount,status,expires_at)
  values(v_tenant,v_customer,p_cart_id,v_points,round(v_points*v_program.redeem_rate,2),'reserved',now()+interval '10 minutes')
  returning id into v_res;
  v_needed:=v_points;
  for v_lot in
    select id,remaining_points from public.points_lots
    where customer_id=v_customer and remaining_points>0 and (expires_at is null or expires_at>now())
    order by expires_at asc nulls last,created_at asc,id asc
    for update
  loop
    exit when v_needed<=0;
    v_take:=least(v_needed,v_lot.remaining_points);
    update public.points_lots set remaining_points=remaining_points-v_take where id=v_lot.id;
    insert into public.points_reservation_allocations(reservation_id,lot_id,points) values(v_res,v_lot.id,v_take);
    v_needed:=v_needed-v_take;
  end loop;
  if v_needed>0 then raise exception 'insufficient_points'; end if;
  return jsonb_build_object('reservation_id',v_res,'points',v_points,'discount',round(v_points*v_program.redeem_rate,2),'available_after',app.points_available(v_customer),'expires_at',now()+interval '10 minutes');
end;
$$;

create or replace function app.points_consume_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare v_order record; v_res public.points_reservations%rowtype; v_existing uuid; v_balance numeric;
begin
  select id,tenant_id,customer_id,points_total,points_reservation_id into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null or coalesce(v_order.points_total,0)<=0 or v_order.points_reservation_id is null then return; end if;
  select * into v_res from public.points_reservations where id=v_order.points_reservation_id for update;
  if v_res.id is null then raise exception 'points_reservation_missing'; end if;
  if v_res.status='consumed' then return; end if;
  if v_res.status<>'attached' then raise exception 'points_reservation_not_attached'; end if;
  select id into v_existing from public.points_ledger where tenant_id=v_order.tenant_id and idempotency_key='order:'||p_order_id::text||':points_debit';
  if v_existing is null then
    v_balance:=app.points_available(v_order.customer_id);
    insert into public.points_ledger(tenant_id,customer_id,delta,balance_after,reason,ref_type,ref_id,idempotency_key,metadata)
    values(v_order.tenant_id,v_order.customer_id,-v_res.points,v_balance,'order redemption','order',p_order_id::text,'order:'||p_order_id::text||':points_debit',jsonb_build_object('order_id',p_order_id,'discount',v_order.points_total));
  end if;
  update public.points_reservations set status='consumed',consumed_at=coalesce(consumed_at,now()),updated_at=now() where id=v_res.id;
end;
$$;

create or replace function app.points_release_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare v_res uuid;
begin
  select points_reservation_id into v_res from public.orders where id=p_order_id;
  if v_res is not null then perform app.points_release_reservation(v_res); end if;
end;
$$;

create or replace function app.points_reverse_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare v_order record; v_res public.points_reservations%rowtype; v_program public.loyalty_programs%rowtype; v_expiry timestamptz;
begin
  select id,tenant_id,customer_id,points_reservation_id into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null or v_order.points_reservation_id is null then return; end if;
  select * into v_res from public.points_reservations where id=v_order.points_reservation_id for update;
  if v_res.id is null then return; end if;
  if v_res.status in ('reserved','attached') then perform app.points_release_reservation(v_res.id); return; end if;
  if v_res.status='reversed' then return; end if;
  if v_res.status='consumed' then
    select * into v_program from public.loyalty_programs where tenant_id=v_order.tenant_id;
    v_expiry:=case when v_program.expiry_days is not null then now()+make_interval(days=>v_program.expiry_days) else null end;
    perform app.points_post_credit(v_order.customer_id,v_res.points,'order cancellation reversal','order',p_order_id::text,null,null,'order:'||p_order_id::text||':points_reversal',v_expiry,jsonb_build_object('order_id',p_order_id));
    update public.points_reservations set status='reversed',updated_at=now() where id=v_res.id;
  end if;
end;
$$;

create or replace function app.loyalty_award_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare v_order record; v_program public.loyalty_programs%rowtype; v_base numeric; v_points numeric; v_expiry timestamptz;
begin
  select id,tenant_id,customer_id,status,subtotal,discount_total,points_total into v_order from public.orders where id=p_order_id;
  if v_order.id is null or v_order.status<>'completed' then return; end if;
  select * into v_program from public.loyalty_programs where tenant_id=v_order.tenant_id and active;
  if v_program.id is null or v_program.earn_rate<=0 then return; end if;
  v_base:=greatest(v_order.subtotal-v_order.discount_total-v_order.points_total,0);
  v_points:=floor((v_base*v_program.earn_rate)*100)/100;
  if v_points<=0 then return; end if;
  v_expiry:=case when v_program.expiry_days is not null then now()+make_interval(days=>v_program.expiry_days) else null end;
  perform app.points_post_credit(v_order.customer_id,v_points,'order completion','order',p_order_id::text,null,null,'order:'||p_order_id::text||':points_earn',v_expiry,jsonb_build_object('order_id',p_order_id,'earn_base',v_base,'earn_rate',v_program.earn_rate));
end;
$$;

create or replace function app.points_payment_status_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
begin
  if new.payment_status in ('paid','partially_refunded') and old.payment_status is distinct from new.payment_status then
    perform app.points_consume_order(new.id);
  elsif new.payment_status in ('failed','cancelled') and old.payment_status is distinct from new.payment_status then
    perform app.points_release_order(new.id);
  end if;
  return new;
end;
$$;

create or replace function app.points_order_status_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
begin
  if new.status='cancelled' and old.status is distinct from new.status then perform app.points_reverse_order(new.id); end if;
  if new.status='completed' and old.status is distinct from new.status then perform app.loyalty_award_order(new.id); end if;
  return new;
end;
$$;

create trigger points_payment_status_sync after update of payment_status on public.orders
for each row execute function app.points_payment_status_trigger();
create trigger points_order_status_sync after update of status on public.orders
for each row execute function app.points_order_status_trigger();

-- v5 preserves coupon -> points -> wallet order from BUILD-SPEC.
create or replace function public.storefront_place_order_v5(
  p_tenant_slug text,p_branch_id uuid,p_order_type public.order_type,p_customer_name text,p_customer_phone text,p_notes text,p_items jsonb,
  p_area_id uuid default null,p_lat numeric default null,p_lng numeric default null,p_address_text text default null,
  p_payment_method text default 'cash',p_coupon_reservation_id uuid default null,p_points_reservation_id uuid default null,
  p_wallet_reservation_id uuid default null,p_source text default 'web'
)
returns table(order_id uuid,total numeric)
language plpgsql
security definer
set search_path = public, app
as $$
declare v_order_id uuid; v_total numeric; v_order public.orders%rowtype; v_points public.points_reservations%rowtype; v_wallet public.wallet_reservations%rowtype; v_customer_user uuid; v_taxable numeric; v_tax_rate numeric; v_wallet_amount numeric;
begin
  select r.order_id,r.total into v_order_id,v_total
  from public.storefront_place_order_v3(p_tenant_slug,p_branch_id,p_order_type,p_customer_name,p_customer_phone,p_notes,p_items,p_area_id,p_lat,p_lng,p_address_text,p_payment_method,p_coupon_reservation_id,p_source) r;

  if p_points_reservation_id is not null then
    if auth.uid() is null then raise exception 'points_auth_required'; end if;
    select * into v_order from public.orders where id=v_order_id for update;
    select * into v_points from public.points_reservations where id=p_points_reservation_id for update;
    if v_points.id is null or v_points.status<>'reserved' or v_points.expires_at<=now() then raise exception 'points_reservation_invalid'; end if;
    if v_points.tenant_id<>v_order.tenant_id or v_points.customer_id<>v_order.customer_id then raise exception 'points_reservation_mismatch'; end if;
    select user_id into v_customer_user from public.customers where id=v_order.customer_id;
    if v_customer_user is null or v_customer_user<>auth.uid() then raise exception 'points_auth_required'; end if;
    if v_points.discount_amount>greatest(v_order.subtotal-v_order.discount_total,0) then raise exception 'points_exceed_order'; end if;
    select coalesce(vat_rate,0.15) into v_tax_rate from public.tenants where id=v_order.tenant_id;
    v_taxable:=greatest(v_order.subtotal-v_order.discount_total-v_points.discount_amount,0);
    v_total:=v_taxable+v_order.deposit_total+v_order.delivery_fee;
    update public.orders set points_total=v_points.discount_amount,points_reservation_id=v_points.id,
      tax_total=round(v_taxable-(v_taxable/(1+v_tax_rate)),2),total=v_total,updated_at=now() where id=v_order.id;
    update public.points_reservations set order_id=v_order.id,status='attached',
      expires_at=case when p_payment_method='online' then now()+interval '30 minutes' else expires_at end,updated_at=now() where id=v_points.id;
    if p_payment_method<>'online' then perform app.points_consume_order(v_order.id); end if;
  end if;

  if p_wallet_reservation_id is not null then
    if auth.uid() is null then raise exception 'wallet_auth_required'; end if;
    select * into v_order from public.orders where id=v_order_id for update;
    select * into v_wallet from public.wallet_reservations where id=p_wallet_reservation_id for update;
    if v_wallet.id is null or v_wallet.status<>'reserved' or v_wallet.expires_at<=now() then raise exception 'wallet_reservation_invalid'; end if;
    if v_wallet.tenant_id<>v_order.tenant_id or v_wallet.customer_id<>v_order.customer_id then raise exception 'wallet_reservation_mismatch'; end if;
    select user_id into v_customer_user from public.customers where id=v_order.customer_id;
    if v_customer_user is null or v_customer_user<>auth.uid() then raise exception 'wallet_auth_required'; end if;
    v_wallet_amount:=least(v_wallet.amount,greatest(v_order.subtotal-v_order.discount_total-v_order.points_total,0));
    if v_wallet_amount<=0 then raise exception 'wallet_not_applicable'; end if;
    select coalesce(vat_rate,0.15) into v_tax_rate from public.tenants where id=v_order.tenant_id;
    v_taxable:=greatest(v_order.subtotal-v_order.discount_total-v_order.points_total-v_wallet_amount,0);
    v_total:=v_taxable+v_order.deposit_total+v_order.delivery_fee;
    update public.orders set wallet_total=v_wallet_amount,wallet_reservation_id=v_wallet.id,
      tax_total=round(v_taxable-(v_taxable/(1+v_tax_rate)),2),total=v_total,updated_at=now() where id=v_order.id;
    update public.wallet_reservations set order_id=v_order.id,amount=v_wallet_amount,
      status=case when p_payment_method='online' then 'attached' else 'consumed' end,
      consumed_at=case when p_payment_method='online' then null else now() end,
      expires_at=case when p_payment_method='online' then now()+interval '30 minutes' else expires_at end,updated_at=now() where id=v_wallet.id;
    if p_payment_method<>'online' then
      perform app.wallet_post(v_wallet.wallet_id,-v_wallet_amount,'order payment','order',v_order.id::text,null,null,'order:'||v_order.id::text||':wallet_debit',jsonb_build_object('order_id',v_order.id));
    end if;
  end if;

  return query select v_order_id,(select o.total from public.orders o where o.id=v_order_id);
end;
$$;

revoke execute on function public.staff_adjust_points(uuid,numeric,text) from public,anon;
grant execute on function public.staff_adjust_points(uuid,numeric,text) to authenticated;
revoke execute on function public.admin_save_loyalty_program(numeric,numeric,numeric,integer,boolean) from public,anon;
grant execute on function public.admin_save_loyalty_program(numeric,numeric,numeric,integer,boolean) to authenticated;
revoke execute on function public.staff_customer_points(uuid) from public,anon;
grant execute on function public.staff_customer_points(uuid) to authenticated;
revoke execute on function public.storefront_my_points(uuid) from public,anon;
grant execute on function public.storefront_my_points(uuid) to authenticated;
revoke execute on function public.storefront_points_reserve(uuid,uuid,numeric) from public,anon;
grant execute on function public.storefront_points_reserve(uuid,uuid,numeric) to authenticated;
revoke execute on function public.storefront_place_order_v5(text,uuid,public.order_type,text,text,text,jsonb,uuid,numeric,numeric,text,text,uuid,uuid,uuid,text) from public;
grant execute on function public.storefront_place_order_v5(text,uuid,public.order_type,text,text,text,jsonb,uuid,numeric,numeric,text,text,uuid,uuid,uuid,text) to anon,authenticated;

-- Internal app functions are not public API.
revoke execute on function app.points_release_reservation(uuid) from public,anon,authenticated;
revoke execute on function app.points_cleanup_customer(uuid) from public,anon,authenticated;
revoke execute on function app.points_available(uuid) from public,anon,authenticated;
revoke execute on function app.points_post_credit(uuid,numeric,text,text,text,uuid,text,text,timestamptz,jsonb) from public,anon,authenticated;
revoke execute on function app.points_post_debit(uuid,numeric,text,text,text,uuid,text,text,jsonb) from public,anon,authenticated;
revoke execute on function app.points_consume_order(uuid) from public,anon,authenticated;
revoke execute on function app.points_release_order(uuid) from public,anon,authenticated;
revoke execute on function app.points_reverse_order(uuid) from public,anon,authenticated;
revoke execute on function app.loyalty_award_order(uuid) from public,anon,authenticated;
revoke execute on function app.points_payment_status_trigger() from public,anon,authenticated;
revoke execute on function app.points_order_status_trigger() from public,anon,authenticated;
