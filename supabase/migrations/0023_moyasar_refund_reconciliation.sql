-- TALAB Phase 1 — reconcile Moyasar's cumulative refunded amount.
-- This handles webhook-before-ledger races and refunds initiated in Moyasar's dashboard.

create or replace function public.payment_reconcile_moyasar_refund(
  p_payment_account_id uuid,
  p_provider_event_id text,
  p_order_id uuid,
  p_provider_payment_id text,
  p_refunded_amount numeric,
  p_currency text default 'SAR',
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_account public.payment_accounts%rowtype;
  v_order public.orders%rowtype;
  v_charge public.payment_transactions%rowtype;
  v_event_id uuid;
  v_completed numeric(12,2);
  v_delta numeric(12,2);
  v_pending public.order_refunds%rowtype;
  v_synthetic_refund_id uuid;
  v_tx_id uuid;
begin
  if p_provider_event_id is null or length(trim(p_provider_event_id)) = 0 then
    raise exception 'missing_provider_event_id';
  end if;
  if p_refunded_amount is null or p_refunded_amount < 0 then
    raise exception 'invalid_refunded_amount';
  end if;

  select * into v_account
    from public.payment_accounts
    where id = p_payment_account_id
      and provider = 'moyasar';
  if v_account.id is null then
    raise exception 'invalid_payment_account';
  end if;

  select * into v_order
    from public.orders
    where id = p_order_id
    for update;
  if v_order.id is null
     or v_order.tenant_id <> v_account.tenant_id
     or v_order.payment_account_id <> v_account.id
     or v_order.payment_method <> 'online' then
    raise exception 'invalid_payment_order';
  end if;

  select * into v_charge
    from public.payment_transactions
    where order_id = v_order.id
      and payment_account_id = v_account.id
      and provider = 'moyasar'
      and kind = 'charge'
      and status = 'succeeded'
      and provider_payment_id = trim(p_provider_payment_id)
    order by succeeded_at desc nulls last, created_at desc
    limit 1;
  if v_charge.id is null then
    raise exception 'gateway_charge_not_found';
  end if;

  insert into public.payment_webhook_events (
    tenant_id, payment_account_id, transaction_id, provider,
    provider_event_id, event_type, signature_valid, processing_status, payload
  ) values (
    v_order.tenant_id, v_account.id, v_charge.id, 'moyasar',
    trim(p_provider_event_id), 'payment_refunded', true, 'received', coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (payment_account_id, provider_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return jsonb_build_object('status', 'duplicate');
  end if;

  select coalesce(sum(r.amount), 0)
    into v_completed
    from public.order_refunds r
    where r.order_id = v_order.id
      and r.status = 'completed'
      and r.execution_mode = 'gateway'
      and r.provider = 'moyasar';

  v_delta := round(greatest(p_refunded_amount - v_completed, 0), 2);

  -- Complete already-reserved refund requests first. This closes the race where
  -- Moyasar's webhook arrives before the refund Edge Function updates TALAB.
  for v_pending in
    select *
      from public.order_refunds r
      where r.order_id = v_order.id
        and r.status = 'pending'
        and r.execution_mode = 'gateway'
        and r.provider = 'moyasar'
      order by r.created_at asc
      for update
  loop
    exit when v_delta <= 0;
    if v_pending.amount <= v_delta + 0.009 then
      perform public.payment_complete_gateway_refund(
        v_pending.id,
        p_provider_payment_id,
        coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('reconciled_from_webhook', true)
      );
      v_delta := round(greatest(v_delta - v_pending.amount, 0), 2);
    end if;
  end loop;

  -- Any remaining delta was refunded outside TALAB (for example from Moyasar's
  -- dashboard). Record it as a synthetic gateway refund so finance stays aligned.
  if v_delta > 0 then
    if v_completed + v_delta > v_order.total + 0.009 then
      raise exception 'provider_refund_exceeds_order_total';
    end if;

    insert into public.payment_transactions (
      tenant_id, brand_id, branch_id, order_id, payment_account_id, provider,
      kind, status, amount, currency, payment_method, provider_reference,
      idempotency_key, metadata, succeeded_at
    ) values (
      v_order.tenant_id, v_order.brand_id, v_order.branch_id, v_order.id,
      v_account.id, 'moyasar', 'refund', 'succeeded', v_delta,
      upper(left(coalesce(p_currency, 'SAR'), 3))::char(3), 'moyasar',
      trim(p_provider_payment_id),
      'moyasar-webhook-refund:' || trim(p_provider_event_id),
      coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('external_reconciliation', true),
      now()
    ) returning id into v_tx_id;

    insert into public.order_refunds (
      tenant_id, order_id, branch_id, kind, amount, currency, reason,
      status, execution_mode, provider, provider_ref, payment_transaction_id,
      completed_at, metadata
    ) values (
      v_order.tenant_id, v_order.id, v_order.branch_id, 'order', v_delta,
      upper(left(coalesce(p_currency, 'SAR'), 3))::char(3),
      'Moyasar refund reconciliation', 'completed', 'gateway', 'moyasar',
      trim(p_provider_payment_id), v_tx_id, now(),
      coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('external_reconciliation', true)
    ) returning id into v_synthetic_refund_id;

    insert into public.activity_log (
      tenant_id, actor_id, actor_name, action, entity_type, entity_id, diff
    ) values (
      v_order.tenant_id, null, 'Moyasar', 'refund.reconciled_gateway',
      'order_refund', v_synthetic_refund_id,
      jsonb_build_object(
        'order_id', v_order.id,
        'amount', v_delta,
        'currency', p_currency,
        'provider_event_id', p_provider_event_id
      )
    );
  end if;

  update public.payment_webhook_events
    set processing_status = 'processed', processed_at = now()
    where id = v_event_id;

  return jsonb_build_object(
    'status', 'processed',
    'provider_refunded', round(p_refunded_amount, 2),
    'previously_completed', v_completed,
    'external_delta_recorded', v_delta
  );
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

revoke execute on function public.payment_reconcile_moyasar_refund(uuid, text, uuid, text, numeric, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.payment_reconcile_moyasar_refund(uuid, text, uuid, text, numeric, text, jsonb)
  to service_role;
