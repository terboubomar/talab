-- TALAB Phase 1 — Moyasar gateway refunds.
-- Online refunds reserve a pending refund row first, then move money through
-- Moyasar, and only then mark the refund completed in TALAB.

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
  where id = p_order_id
  for update;

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

  -- Electronic payments must be refunded through their provider. Recording a
  -- manual refund for them would make TALAB's ledger disagree with real money.
  if v_order.payment_method = 'online' then
    raise exception 'gateway_refund_required';
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
    tenant_id, order_id, branch_id, kind, amount, currency, reason,
    status, execution_mode, created_by_staff_id, created_by_name, completed_at
  ) values (
    v_order.tenant_id, v_order.id, v_order.branch_id, p_kind, v_amount,
    v_order.currency, trim(p_reason), 'completed', 'manual', v_staff_id,
    v_staff_name, now()
  ) returning id into v_refund_id;

  insert into public.activity_log (
    tenant_id, actor_id, actor_name, action, entity_type, entity_id, diff
  ) values (
    v_order.tenant_id, auth.uid(), v_staff_name, 'refund.completed_manual',
    'order_refund', v_refund_id,
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

revoke execute on function public.staff_create_manual_refund(uuid, numeric, text, text)
  from public, anon;
grant execute on function public.staff_create_manual_refund(uuid, numeric, text, text)
  to authenticated;

create or replace function public.staff_prepare_gateway_refund(
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
  v_staff_id uuid;
  v_staff_name text;
  v_limit numeric(12,2);
  v_reserved numeric(12,2);
  v_remaining numeric(12,2);
  v_amount numeric(12,2);
  v_refund_id uuid;
  v_charge public.payment_transactions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authorized';
  end if;

  select * into v_order
    from public.orders
    where id = p_order_id
    for update;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  if not app.is_platform_admin() then
    if app.current_tenant_id() is null
       or app.current_tenant_id() <> v_order.tenant_id
       or not app.has_perm('orders.refund')
       or not app.can_see_branch(v_order.branch_id) then
      raise exception 'not_authorized';
    end if;
  end if;

  if v_order.status not in ('completed', 'cancelled') then
    raise exception 'order_not_terminal';
  end if;
  if v_order.payment_method <> 'online'
     or v_order.payment_account_id is null
     or v_order.payment_status not in ('paid', 'partially_refunded') then
    raise exception 'gateway_refund_not_available';
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
    into v_reserved
    from public.order_refunds
    where order_id = p_order_id
      and kind = p_kind
      and status in ('pending', 'completed');

  v_remaining := greatest(v_limit - v_reserved, 0);
  v_amount := round(coalesce(p_amount, 0), 2);
  if v_amount <= 0 then
    raise exception 'invalid_refund_amount';
  end if;
  if v_amount > v_remaining then
    raise exception 'refund_exceeds_remaining';
  end if;

  select * into v_charge
    from public.payment_transactions pt
    where pt.order_id = v_order.id
      and pt.payment_account_id = v_order.payment_account_id
      and pt.provider = 'moyasar'
      and pt.kind = 'charge'
      and pt.status = 'succeeded'
      and pt.provider_payment_id is not null
    order by pt.succeeded_at desc nulls last, pt.created_at desc
    limit 1;

  if v_charge.id is null then
    raise exception 'gateway_charge_not_found';
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
    tenant_id, order_id, branch_id, kind, amount, currency, reason,
    status, execution_mode, provider, provider_ref,
    created_by_staff_id, created_by_name, metadata
  ) values (
    v_order.tenant_id, v_order.id, v_order.branch_id, p_kind, v_amount,
    v_order.currency, trim(p_reason), 'pending', 'gateway', 'moyasar',
    v_charge.provider_payment_id, v_staff_id, v_staff_name,
    jsonb_build_object(
      'charge_transaction_id', v_charge.id,
      'provider_payment_id', v_charge.provider_payment_id
    )
  ) returning id into v_refund_id;

  insert into public.activity_log (
    tenant_id, actor_id, actor_name, action, entity_type, entity_id, diff
  ) values (
    v_order.tenant_id, auth.uid(), v_staff_name, 'refund.requested_gateway',
    'order_refund', v_refund_id,
    jsonb_build_object(
      'order_id', v_order.id,
      'kind', p_kind,
      'amount', v_amount,
      'currency', v_order.currency,
      'provider', 'moyasar'
    )
  );

  return jsonb_build_object(
    'refund_id', v_refund_id,
    'order_id', v_order.id,
    'payment_account_id', v_order.payment_account_id,
    'charge_transaction_id', v_charge.id,
    'provider_payment_id', v_charge.provider_payment_id,
    'amount', v_amount,
    'currency', v_order.currency,
    'kind', p_kind,
    'reason', trim(p_reason),
    'remaining', greatest(v_remaining - v_amount, 0)
  );
end;
$$;

revoke execute on function public.staff_prepare_gateway_refund(uuid, numeric, text, text)
  from public, anon;
grant execute on function public.staff_prepare_gateway_refund(uuid, numeric, text, text)
  to authenticated;

create or replace function public.payment_complete_gateway_refund(
  p_refund_id uuid,
  p_provider_ref text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_refund public.order_refunds%rowtype;
  v_order public.orders%rowtype;
  v_account public.payment_accounts%rowtype;
  v_tx_id uuid;
  v_existing_tx uuid;
  v_actor_id uuid;
begin
  select * into v_refund
    from public.order_refunds
    where id = p_refund_id
    for update;

  if v_refund.id is null then
    raise exception 'refund_not_found';
  end if;

  if v_refund.status = 'completed' then
    return jsonb_build_object(
      'id', v_refund.id,
      'order_id', v_refund.order_id,
      'status', v_refund.status,
      'amount', v_refund.amount,
      'currency', v_refund.currency,
      'payment_transaction_id', v_refund.payment_transaction_id
    );
  end if;

  if v_refund.status <> 'pending'
     or v_refund.execution_mode <> 'gateway'
     or v_refund.provider <> 'moyasar' then
    raise exception 'refund_not_pending';
  end if;

  select * into v_order
    from public.orders
    where id = v_refund.order_id
    for update;
  if v_order.id is null
     or v_order.payment_method <> 'online'
     or v_order.payment_account_id is null then
    raise exception 'invalid_refund_order';
  end if;

  select * into v_account
    from public.payment_accounts
    where id = v_order.payment_account_id
      and tenant_id = v_order.tenant_id
      and provider = 'moyasar';
  if v_account.id is null then
    raise exception 'invalid_payment_account';
  end if;

  select id into v_existing_tx
    from public.payment_transactions
    where tenant_id = v_order.tenant_id
      and idempotency_key = 'moyasar-refund:' || v_refund.id::text
    limit 1;

  if v_existing_tx is null then
    insert into public.payment_transactions (
      tenant_id, brand_id, branch_id, order_id, payment_account_id, provider,
      kind, status, amount, currency, payment_method, provider_reference,
      idempotency_key, metadata, succeeded_at
    ) values (
      v_order.tenant_id, v_order.brand_id, v_order.branch_id, v_order.id,
      v_account.id, 'moyasar', 'refund', 'succeeded', v_refund.amount,
      v_refund.currency, 'moyasar', nullif(trim(p_provider_ref), ''),
      'moyasar-refund:' || v_refund.id::text, coalesce(p_payload, '{}'::jsonb), now()
    ) returning id into v_tx_id;
  else
    v_tx_id := v_existing_tx;
  end if;

  update public.order_refunds
    set status = 'completed',
        provider_ref = coalesce(nullif(trim(p_provider_ref), ''), provider_ref),
        payment_transaction_id = v_tx_id,
        metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_payload, '{}'::jsonb),
        completed_at = coalesce(completed_at, now())
    where id = v_refund.id;

  select s.user_id into v_actor_id
    from public.staff s
    where s.id = v_refund.created_by_staff_id;

  insert into public.activity_log (
    tenant_id, actor_id, actor_name, action, entity_type, entity_id, diff
  ) values (
    v_order.tenant_id, v_actor_id, v_refund.created_by_name,
    'refund.completed_gateway', 'order_refund', v_refund.id,
    jsonb_build_object(
      'order_id', v_order.id,
      'amount', v_refund.amount,
      'currency', v_refund.currency,
      'provider', 'moyasar',
      'provider_ref', p_provider_ref,
      'payment_transaction_id', v_tx_id
    )
  );

  return jsonb_build_object(
    'id', v_refund.id,
    'order_id', v_order.id,
    'status', 'completed',
    'amount', v_refund.amount,
    'currency', v_refund.currency,
    'payment_transaction_id', v_tx_id
  );
end;
$$;

revoke execute on function public.payment_complete_gateway_refund(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.payment_complete_gateway_refund(uuid, text, jsonb)
  to service_role;

create or replace function public.payment_fail_gateway_refund(
  p_refund_id uuid,
  p_error text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_refund public.order_refunds%rowtype;
begin
  select * into v_refund
    from public.order_refunds
    where id = p_refund_id
    for update;

  if v_refund.id is null then
    return;
  end if;
  if v_refund.status <> 'pending' then
    return;
  end if;

  update public.order_refunds
    set status = 'failed',
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object('provider_error', coalesce(p_error, 'unknown'))
          || coalesce(p_payload, '{}'::jsonb)
    where id = v_refund.id;
end;
$$;

revoke execute on function public.payment_fail_gateway_refund(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.payment_fail_gateway_refund(uuid, text, jsonb)
  to service_role;
