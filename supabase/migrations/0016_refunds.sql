create table if not exists public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  kind text not null default 'order' check (kind in ('order', 'deposit')),
  amount numeric(12,2) not null check (amount > 0),
  currency char(3) not null default 'SAR',
  reason text not null check (length(trim(reason)) between 3 and 500),
  status text not null default 'completed' check (status in ('pending', 'completed', 'failed', 'cancelled')),
  execution_mode text not null default 'manual' check (execution_mode in ('manual', 'gateway')),
  provider text,
  provider_ref text,
  created_by_staff_id uuid references public.staff(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists order_refunds_order_idx
  on public.order_refunds (order_id, created_at desc);

create index if not exists order_refunds_tenant_branch_idx
  on public.order_refunds (tenant_id, branch_id, created_at desc);

alter table public.order_refunds enable row level security;

create policy order_refunds_sel
on public.order_refunds
for select
to authenticated
using (
  (
    tenant_id = app.current_tenant_id()
    and app.can_see_branch(branch_id)
    and (app.has_perm('orders.refund') or app.has_perm('payments.view'))
  )
  or app.is_platform_admin()
);

revoke all on table public.order_refunds from anon;
revoke insert, update, delete on table public.order_refunds from authenticated;
grant select on table public.order_refunds to authenticated;

create or replace function public.staff_create_manual_refund(
  p_order_id uuid,
  p_amount numeric,
  p_reason text,
  p_kind text default 'order'
)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_order public.orders%rowtype;
  v_tenant_id uuid;
  v_staff_id uuid;
  v_staff_name text;
  v_limit numeric(12,2);
  v_refunded numeric(12,2);
  v_remaining numeric(12,2);
  v_amount numeric(12,2);
  v_refund_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authorized';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  v_tenant_id := app.current_tenant_id();

  if not app.is_platform_admin() then
    if v_tenant_id is null
       or v_tenant_id <> v_order.tenant_id
       or not app.has_perm('orders.refund')
       or not app.can_see_branch(v_order.branch_id) then
      raise exception 'not_authorized';
    end if;
  end if;

  if v_order.status not in ('completed', 'cancelled') then
    raise exception 'order_not_terminal';
  end if;

  if p_kind not in ('order', 'deposit') then
    raise exception 'invalid_refund_kind';
  end if;

  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'refund_reason_required';
  end if;

  if p_kind = 'deposit' then
    if not (app.has_perm('orders.deposit.refund') or app.is_platform_admin()) then
      raise exception 'not_authorized';
    end if;
    v_limit := coalesce(v_order.deposit_total, 0);
  else
    v_limit := coalesce(v_order.total, 0);
  end if;

  select coalesce(sum(amount), 0)
    into v_refunded
  from public.order_refunds
  where order_id = p_order_id
    and kind = p_kind
    and status = 'completed';

  v_remaining := greatest(v_limit - v_refunded, 0);
  v_amount := round(coalesce(p_amount, 0), 2);

  if v_amount <= 0 then
    raise exception 'invalid_refund_amount';
  end if;

  if v_amount > v_remaining then
    raise exception 'refund_exceeds_remaining';
  end if;

  select s.id, s.name
    into v_staff_id, v_staff_name
  from public.staff s
  where s.user_id = auth.uid()
    and s.tenant_id = v_order.tenant_id
  limit 1;

  if v_staff_id is null and not app.is_platform_admin() then
    raise exception 'not_authorized';
  end if;

  insert into public.order_refunds (
    tenant_id,
    order_id,
    branch_id,
    kind,
    amount,
    currency,
    reason,
    status,
    execution_mode,
    created_by_staff_id,
    created_by_name,
    completed_at
  ) values (
    v_order.tenant_id,
    v_order.id,
    v_order.branch_id,
    p_kind,
    v_amount,
    v_order.currency,
    trim(p_reason),
    'completed',
    'manual',
    v_staff_id,
    v_staff_name,
    now()
  ) returning id into v_refund_id;

  insert into public.activity_log (
    tenant_id,
    actor_id,
    actor_name,
    action,
    entity_type,
    entity_id,
    diff
  ) values (
    v_order.tenant_id,
    auth.uid(),
    v_staff_name,
    'refund.completed_manual',
    'order_refund',
    v_refund_id,
    jsonb_build_object(
      'order_id', v_order.id,
      'kind', p_kind,
      'amount', v_amount,
      'currency', v_order.currency,
      'reason', trim(p_reason)
    )
  );

  return jsonb_build_object(
    'id', v_refund_id,
    'order_id', v_order.id,
    'kind', p_kind,
    'amount', v_amount,
    'currency', v_order.currency,
    'status', 'completed',
    'execution_mode', 'manual',
    'remaining', greatest(v_remaining - v_amount, 0)
  );
end;
$$;

revoke all on function public.staff_create_manual_refund(uuid, numeric, text, text) from public;
revoke all on function public.staff_create_manual_refund(uuid, numeric, text, text) from anon;
grant execute on function public.staff_create_manual_refund(uuid, numeric, text, text) to authenticated;
