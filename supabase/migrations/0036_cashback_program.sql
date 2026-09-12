-- TALAB Phase 2 — Cashback.
-- Source of truth: BUILD-SPEC cashback_programs(percent, cap, min_order, valid_from, valid_to, active)
-- Cashback is awarded only after an order reaches completed and is posted into the existing
-- immutable wallet ledger with an order-scoped idempotency key.

create table public.cashback_programs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  percent numeric(7,4) not null default 0 check (percent >= 0 and percent <= 100),
  cap numeric(14,2) check (cap is null or cap > 0),
  min_order numeric(14,2) not null default 0 check (min_order >= 0),
  valid_from timestamptz,
  valid_to timestamptz,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id),
  check (valid_to is null or valid_from is null or valid_to > valid_from)
);

alter table public.cashback_programs enable row level security;

create policy cashback_programs_staff_select on public.cashback_programs
for select to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.has_perm('marketing.cashback'))
  or app.is_platform_admin()
);

revoke insert, update, delete on public.cashback_programs from anon, authenticated;
revoke select on public.cashback_programs from anon;
grant select on public.cashback_programs to authenticated;

create or replace function public.admin_save_cashback_program(
  p_percent numeric,
  p_cap numeric,
  p_min_order numeric,
  p_valid_from timestamptz,
  p_valid_to timestamptz,
  p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_tenant uuid;
  v_id uuid;
  v_staff record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant := app.current_tenant_id();
  if v_tenant is null or (not app.has_perm('marketing.cashback') and not app.is_platform_admin()) then
    raise exception 'not_authorized';
  end if;
  if p_percent is null or p_percent < 0 or p_percent > 100 then raise exception 'invalid_cashback_percent'; end if;
  if p_cap is not null and p_cap <= 0 then raise exception 'invalid_cashback_cap'; end if;
  if p_min_order is null or p_min_order < 0 then raise exception 'invalid_cashback_min_order'; end if;
  if p_valid_to is not null and p_valid_from is not null and p_valid_to <= p_valid_from then
    raise exception 'invalid_cashback_validity';
  end if;

  insert into public.cashback_programs(tenant_id, percent, cap, min_order, valid_from, valid_to, active)
  values(v_tenant, round(p_percent,4), case when p_cap is null then null else round(p_cap,2) end,
         round(p_min_order,2), p_valid_from, p_valid_to, coalesce(p_active,false))
  on conflict(tenant_id) do update set
    percent = excluded.percent,
    cap = excluded.cap,
    min_order = excluded.min_order,
    valid_from = excluded.valid_from,
    valid_to = excluded.valid_to,
    active = excluded.active,
    updated_at = now()
  returning id into v_id;

  select id,name into v_staff
  from public.staff
  where user_id=auth.uid() and tenant_id=v_tenant
  limit 1;

  insert into public.activity_log(tenant_id, actor_id, actor_name, action, entity_type, entity_id, diff)
  values(
    v_tenant, v_staff.id, v_staff.name, 'cashback.program.update', 'cashback_program', v_id,
    jsonb_build_object(
      'percent', round(p_percent,4),
      'cap', case when p_cap is null then null else round(p_cap,2) end,
      'min_order', round(p_min_order,2),
      'valid_from', p_valid_from,
      'valid_to', p_valid_to,
      'active', coalesce(p_active,false)
    )
  );

  return v_id;
end;
$$;

create or replace function app.cashback_award_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_order record;
  v_program public.cashback_programs%rowtype;
  v_eligible numeric;
  v_cashback numeric;
  v_wallet_id uuid;
begin
  select id, tenant_id, customer_id, status, subtotal, discount_total, points_total
  into v_order
  from public.orders
  where id=p_order_id;

  if v_order.id is null or v_order.status <> 'completed' then return; end if;

  select * into v_program
  from public.cashback_programs
  where tenant_id=v_order.tenant_id
    and active
    and (valid_from is null or now() >= valid_from)
    and (valid_to is null or now() < valid_to);

  if v_program.id is null or v_program.percent <= 0 then return; end if;

  -- Merchandise value after coupon/points discounts. Wallet is a payment tender,
  -- not a discount, and delivery/deposit fees are excluded from cashback earning.
  v_eligible := round(greatest(
    coalesce(v_order.subtotal,0)
    - coalesce(v_order.discount_total,0)
    - coalesce(v_order.points_total,0),
    0
  ), 2);

  if v_eligible < v_program.min_order then return; end if;

  v_cashback := round(v_eligible * v_program.percent / 100.0, 2);
  if v_program.cap is not null then v_cashback := least(v_cashback, v_program.cap); end if;
  if v_cashback <= 0 then return; end if;

  insert into public.wallets(tenant_id, customer_id, balance)
  values(v_order.tenant_id, v_order.customer_id, 0)
  on conflict(tenant_id, customer_id) do nothing;

  select id into v_wallet_id
  from public.wallets
  where tenant_id=v_order.tenant_id and customer_id=v_order.customer_id;

  perform app.wallet_post(
    v_wallet_id,
    v_cashback,
    'cashback reward',
    'order',
    p_order_id::text,
    null,
    null,
    'order:' || p_order_id::text || ':cashback',
    jsonb_build_object(
      'order_id', p_order_id,
      'program_id', v_program.id,
      'eligible_spend', v_eligible,
      'percent', v_program.percent,
      'cap', v_program.cap
    )
  );
end;
$$;

create or replace function app.cashback_order_status_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
begin
  if new.status='completed' and old.status is distinct from new.status then
    perform app.cashback_award_order(new.id);
  end if;
  return new;
end;
$$;

create trigger cashback_order_status_sync
after update of status on public.orders
for each row execute function app.cashback_order_status_trigger();

revoke execute on function public.admin_save_cashback_program(numeric,numeric,numeric,timestamptz,timestamptz,boolean) from public,anon;
grant execute on function public.admin_save_cashback_program(numeric,numeric,numeric,timestamptz,timestamptz,boolean) to authenticated;

revoke execute on function app.cashback_award_order(uuid) from public,anon,authenticated;
revoke execute on function app.cashback_order_status_trigger() from public,anon,authenticated;
