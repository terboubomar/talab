-- TALAB Phase 1 — safe public-side Moyasar configuration.
-- This RPC only accepts the publishable pk_* key. Secret sk_* keys and webhook
-- secrets must remain in Supabase Edge Function secrets and are never accepted here.

create or replace function public.admin_save_moyasar_config(
  p_environment text,
  p_publishable_api_key text,
  p_enable_apple_pay boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_tenant_id uuid;
  v_account_id uuid;
  v_key text;
  v_methods text[];
  v_actor_name text;
begin
  if auth.uid() is null then
    raise exception 'not_authorized';
  end if;

  v_tenant_id := app.current_tenant_id();
  if v_tenant_id is null then
    raise exception 'tenant_context_required';
  end if;
  if not (app.has_perm('settings.manage') or app.is_platform_admin()) then
    raise exception 'not_authorized';
  end if;

  if p_environment not in ('test', 'live') then
    raise exception 'invalid_payment_environment';
  end if;

  v_key := trim(coalesce(p_publishable_api_key, ''));
  if p_environment = 'test' and v_key !~ '^pk_test_[A-Za-z0-9_-]+$' then
    raise exception 'invalid_moyasar_test_publishable_key';
  end if;
  if p_environment = 'live' and v_key !~ '^pk_live_[A-Za-z0-9_-]+$' then
    raise exception 'invalid_moyasar_live_publishable_key';
  end if;

  v_methods := case
    when coalesce(p_enable_apple_pay, true)
      then array['creditcard', 'applepay']::text[]
    else array['creditcard']::text[]
  end;

  insert into public.payment_accounts (
    tenant_id, brand_id, provider, display_name, environment,
    enabled, methods, public_config
  ) values (
    v_tenant_id, null, 'moyasar', 'Moyasar', p_environment,
    false, v_methods,
    jsonb_build_object(
      'publishable_api_key', v_key,
      'supported_networks', jsonb_build_array('mada', 'visa', 'mastercard'),
      'secret_key_env', 'MOYASAR_SECRET_KEY',
      'webhook_secret_env', 'MOYASAR_WEBHOOK_SECRET'
    )
  )
  on conflict (tenant_id, provider, display_name) do update
    set environment = excluded.environment,
        enabled = false,
        methods = excluded.methods,
        public_config = excluded.public_config,
        updated_at = now()
  returning id into v_account_id;

  select s.name into v_actor_name
    from public.staff s
    where s.user_id = auth.uid() and s.tenant_id = v_tenant_id
    limit 1;

  insert into public.activity_log (
    tenant_id, actor_id, actor_name, action, entity_type, entity_id, diff
  ) values (
    v_tenant_id, auth.uid(), v_actor_name,
    'payments.moyasar.config_saved', 'payment_account', v_account_id,
    jsonb_build_object(
      'provider', 'moyasar',
      'environment', p_environment,
      'apple_pay', coalesce(p_enable_apple_pay, true),
      'enabled', false
    )
  );

  return v_account_id;
end;
$$;

revoke execute on function public.admin_save_moyasar_config(text, text, boolean)
  from public, anon;
grant execute on function public.admin_save_moyasar_config(text, text, boolean)
  to authenticated;
