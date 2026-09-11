-- TALAB Phase 1 — provider-neutral payment foundation.
-- Secrets are never stored in these tables. Provider API/webhook secrets belong in
-- Supabase project secrets and are consumed only by server-side Edge Functions.

create table if not exists public.payment_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete cascade,
  provider text not null,
  display_name text not null,
  environment text not null default 'test' check (environment in ('test', 'live')),
  enabled boolean not null default false,
  methods text[] not null default '{}',
  public_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider, display_name)
);

comment on column public.payment_accounts.public_config is
  'Non-secret provider configuration only. Never store API keys, signing secrets, passwords, or tokens here.';

alter table public.payment_accounts enable row level security;

create policy payment_accounts_sel on public.payment_accounts
for select to authenticated
using (
  ((tenant_id = app.current_tenant_id()) and (app.has_perm('payments.view') or app.has_perm('settings.manage')))
  or app.is_platform_admin()
);

create policy payment_accounts_ins on public.payment_accounts
for insert to authenticated
with check (
  ((tenant_id = app.current_tenant_id()) and app.has_perm('settings.manage'))
  or app.is_platform_admin()
);

create policy payment_accounts_upd on public.payment_accounts
for update to authenticated
using (
  ((tenant_id = app.current_tenant_id()) and app.has_perm('settings.manage'))
  or app.is_platform_admin()
)
with check (
  ((tenant_id = app.current_tenant_id()) and app.has_perm('settings.manage'))
  or app.is_platform_admin()
);

create policy payment_accounts_del on public.payment_accounts
for delete to authenticated
using (
  ((tenant_id = app.current_tenant_id()) and app.has_perm('settings.manage'))
  or app.is_platform_admin()
);

grant select, insert, update, delete on public.payment_accounts to authenticated;
revoke all on public.payment_accounts from anon;
grant all on public.payment_accounts to service_role;

alter table public.orders
  add column if not exists payment_method text not null default 'cash'
    check (payment_method in ('cash', 'online')),
  add column if not exists payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'pending', 'authorized', 'paid', 'failed', 'partially_refunded', 'refunded', 'cancelled')),
  add column if not exists payment_account_id uuid references public.payment_accounts(id) on delete set null,
  add column if not exists paid_at timestamptz;

create index if not exists orders_payment_status_idx
  on public.orders (tenant_id, payment_status, placed_at desc);

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  payment_account_id uuid references public.payment_accounts(id) on delete set null,
  provider text not null,
  kind text not null default 'charge' check (kind in ('charge', 'refund')),
  status text not null default 'pending'
    check (status in ('pending', 'authorized', 'succeeded', 'failed', 'cancelled')),
  amount numeric(12,2) not null check (amount > 0),
  currency char(3) not null default 'SAR',
  payment_method text,
  provider_payment_id text,
  provider_reference text,
  idempotency_key text,
  failure_code text,
  failure_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  succeeded_at timestamptz
);

create unique index if not exists payment_transactions_provider_payment_uidx
  on public.payment_transactions(payment_account_id, provider_payment_id)
  where provider_payment_id is not null;

create unique index if not exists payment_transactions_idempotency_uidx
  on public.payment_transactions(tenant_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists payment_transactions_order_idx
  on public.payment_transactions(order_id, created_at desc);
create index if not exists payment_transactions_tenant_created_idx
  on public.payment_transactions(tenant_id, created_at desc);

alter table public.payment_transactions enable row level security;

create policy payment_transactions_sel on public.payment_transactions
for select to authenticated
using (
  ((tenant_id = app.current_tenant_id()) and app.has_perm('payments.view') and app.can_see_branch(branch_id))
  or app.is_platform_admin()
);

grant select on public.payment_transactions to authenticated;
revoke insert, update, delete on public.payment_transactions from authenticated;
revoke all on public.payment_transactions from anon;
grant all on public.payment_transactions to service_role;

create table if not exists public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payment_account_id uuid not null references public.payment_accounts(id) on delete cascade,
  transaction_id uuid references public.payment_transactions(id) on delete set null,
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  signature_valid boolean not null default true,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processed', 'failed', 'ignored')),
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (payment_account_id, provider_event_id)
);

create index if not exists payment_webhook_events_received_idx
  on public.payment_webhook_events(payment_account_id, received_at desc);

alter table public.payment_webhook_events enable row level security;
-- Intentionally no anon/authenticated policy: raw provider payloads are server-only.
revoke all on public.payment_webhook_events from anon, authenticated;
grant all on public.payment_webhook_events to service_role;

alter table public.order_refunds
  add column if not exists payment_transaction_id uuid references public.payment_transactions(id) on delete set null;

-- Internal provider state machine. A future payment Edge Function must verify the
-- provider signature against a secret stored in Supabase project secrets before
-- calling this RPC. It is not callable by storefront or staff clients.
create or replace function public.payment_apply_provider_event(
  p_payment_account_id uuid,
  p_provider_event_id text,
  p_event_type text,
  p_order_id uuid,
  p_provider_payment_id text,
  p_status text,
  p_amount numeric,
  p_currency text default 'SAR',
  p_payment_method text default null,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, app
as $$
declare
  v_account record;
  v_order record;
  v_event_id uuid;
  v_transaction_id uuid;
  v_existing_status text;
  v_succeeded_total numeric;
begin
  if p_provider_event_id is null or length(trim(p_provider_event_id)) = 0 then
    raise exception 'missing_provider_event_id';
  end if;
  if p_provider_payment_id is null or length(trim(p_provider_payment_id)) = 0 then
    raise exception 'missing_provider_payment_id';
  end if;
  if p_status not in ('pending', 'authorized', 'succeeded', 'failed', 'cancelled') then
    raise exception 'invalid_payment_status';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_payment_amount';
  end if;

  select id, tenant_id, brand_id, provider
    into v_account
    from public.payment_accounts
    where id = p_payment_account_id;
  if v_account.id is null then
    raise exception 'invalid_payment_account';
  end if;

  select id, tenant_id, brand_id, branch_id, total, payment_status
    into v_order
    from public.orders
    where id = p_order_id;
  if v_order.id is null
     or v_order.tenant_id <> v_account.tenant_id
     or (v_account.brand_id is not null and v_order.brand_id <> v_account.brand_id) then
    raise exception 'invalid_payment_order';
  end if;

  -- Insert event first. Duplicate provider event IDs are idempotent and return
  -- the transaction previously attached to that event.
  insert into public.payment_webhook_events (
    tenant_id, payment_account_id, provider, provider_event_id, event_type,
    signature_valid, processing_status, payload
  ) values (
    v_account.tenant_id, v_account.id, v_account.provider, trim(p_provider_event_id),
    coalesce(nullif(trim(p_event_type), ''), 'unknown'), true, 'received', coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (payment_account_id, provider_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select transaction_id into v_transaction_id
      from public.payment_webhook_events
      where payment_account_id = p_payment_account_id
        and provider_event_id = trim(p_provider_event_id);
    return v_transaction_id;
  end if;

  select id, status into v_transaction_id, v_existing_status
    from public.payment_transactions
    where payment_account_id = p_payment_account_id
      and provider_payment_id = trim(p_provider_payment_id)
    for update;

  if v_transaction_id is null then
    insert into public.payment_transactions (
      tenant_id, brand_id, branch_id, order_id, payment_account_id, provider,
      kind, status, amount, currency, payment_method, provider_payment_id,
      provider_reference, metadata, succeeded_at
    ) values (
      v_order.tenant_id, v_order.brand_id, v_order.branch_id, v_order.id,
      v_account.id, v_account.provider, 'charge', p_status, round(p_amount, 2),
      upper(left(coalesce(p_currency, 'SAR'), 3))::char(3), p_payment_method,
      trim(p_provider_payment_id), trim(p_provider_payment_id), '{}'::jsonb,
      case when p_status = 'succeeded' then now() else null end
    ) returning id into v_transaction_id;
  else
    if v_existing_status = 'succeeded' and p_status <> 'succeeded' then
      raise exception 'payment_status_regression';
    end if;
    if v_existing_status in ('failed', 'cancelled') and p_status not in (v_existing_status) then
      raise exception 'payment_status_terminal';
    end if;

    update public.payment_transactions
      set status = p_status,
          amount = round(p_amount, 2),
          currency = upper(left(coalesce(p_currency, 'SAR'), 3))::char(3),
          payment_method = coalesce(p_payment_method, payment_method),
          updated_at = now(),
          succeeded_at = case when p_status = 'succeeded' then coalesce(succeeded_at, now()) else succeeded_at end
      where id = v_transaction_id;
  end if;

  if p_status = 'succeeded' then
    select coalesce(sum(amount), 0) into v_succeeded_total
      from public.payment_transactions
      where order_id = v_order.id and kind = 'charge' and status = 'succeeded';

    if v_succeeded_total > v_order.total then
      raise exception 'payment_amount_exceeds_order_total';
    end if;

    update public.orders
      set payment_method = 'online',
          payment_account_id = v_account.id,
          payment_status = case when v_succeeded_total >= total then 'paid' else 'pending' end,
          paid_at = case when v_succeeded_total >= total then coalesce(paid_at, now()) else paid_at end,
          updated_at = now()
      where id = v_order.id;
  elsif p_status = 'authorized' and v_order.payment_status not in ('paid', 'partially_refunded', 'refunded') then
    update public.orders
      set payment_method = 'online', payment_account_id = v_account.id,
          payment_status = 'authorized', updated_at = now()
      where id = v_order.id;
  elsif p_status in ('failed', 'cancelled') and v_order.payment_status not in ('paid', 'partially_refunded', 'refunded') then
    update public.orders
      set payment_method = 'online', payment_account_id = v_account.id,
          payment_status = p_status, updated_at = now()
      where id = v_order.id;
  else
    update public.orders
      set payment_method = 'online', payment_account_id = v_account.id,
          payment_status = case when payment_status = 'unpaid' then 'pending' else payment_status end,
          updated_at = now()
      where id = v_order.id;
  end if;

  update public.payment_webhook_events
    set transaction_id = v_transaction_id,
        processing_status = 'processed',
        processed_at = now()
    where id = v_event_id;

  return v_transaction_id;
exception
  when others then
    if v_event_id is not null then
      update public.payment_webhook_events
        set processing_status = 'failed', error_message = sqlerrm, processed_at = now()
        where id = v_event_id;
    end if;
    raise;
end;
$$;

revoke all on function public.payment_apply_provider_event(uuid, text, text, uuid, text, text, numeric, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.payment_apply_provider_event(uuid, text, text, uuid, text, text, numeric, text, text, jsonb) to service_role;

-- Keep order payment status aligned with completed refunds, but only for orders
-- that were actually recorded as paid through the electronic payment ledger.
create or replace function public.payment_sync_refund_status()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order record;
  v_refunded numeric;
begin
  if new.status <> 'completed' then
    return new;
  end if;

  select id, total, payment_status into v_order
    from public.orders where id = new.order_id for update;

  if v_order.payment_status not in ('paid', 'partially_refunded', 'refunded') then
    return new;
  end if;

  select coalesce(sum(amount), 0) into v_refunded
    from public.order_refunds
    where order_id = new.order_id and status = 'completed';

  update public.orders
    set payment_status = case
      when v_refunded >= total then 'refunded'
      when v_refunded > 0 then 'partially_refunded'
      else payment_status
    end,
    updated_at = now()
    where id = new.order_id;

  return new;
end;
$$;

drop trigger if exists trg_payment_sync_refund_status on public.order_refunds;
create trigger trg_payment_sync_refund_status
after insert or update of status on public.order_refunds
for each row execute function public.payment_sync_refund_status();

revoke all on function public.payment_sync_refund_status() from public, anon, authenticated;
