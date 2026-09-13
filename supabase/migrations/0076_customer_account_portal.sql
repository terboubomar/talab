-- TALAB customer account portal.
-- Links a verified Supabase phone-auth user to the tenant customer row and exposes
-- only that customer's storefront profile, orders, wallet, points and addresses.

create or replace function app.normalize_customer_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = public, app
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if v_digits = '' then return null; end if;
  if left(v_digits, 4) = '00966' then v_digits := substr(v_digits, 3); end if;
  if left(v_digits, 3) = '966' and length(v_digits) = 12 then return '+' || v_digits; end if;
  if left(v_digits, 2) = '05' and length(v_digits) = 10 then return '+966' || substr(v_digits, 2); end if;
  if left(v_digits, 1) = '5' and length(v_digits) = 9 then return '+966' || v_digits; end if;
  if left(v_digits, 1) = '0' then return '+' || substr(v_digits, 2); end if;
  return '+' || v_digits;
end;
$$;

revoke all on function app.normalize_customer_phone(text) from public, anon, authenticated;

create or replace function public.storefront_customer_account(p_tenant_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, app, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_auth_phone text;
  v_auth_email text;
  v_phone text;
  v_customer public.customers%rowtype;
  v_match_count integer := 0;
  v_wallet_id uuid;
  v_wallet_balance numeric := 0;
  v_points_balance numeric := 0;
  v_orders jsonb := '[]'::jsonb;
  v_wallet_ledger jsonb := '[]'::jsonb;
  v_points_ledger jsonb := '[]'::jsonb;
  v_addresses jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select id into v_tenant
  from public.tenants
  where slug = p_tenant_slug and status = 'active'
  limit 1;
  if v_tenant is null then raise exception 'tenant_not_found'; end if;

  select phone, email into v_auth_phone, v_auth_email
  from auth.users
  where id = v_uid;

  v_phone := app.normalize_customer_phone(v_auth_phone);
  if v_phone is null then raise exception 'phone_auth_required'; end if;

  select * into v_customer
  from public.customers
  where tenant_id = v_tenant and user_id = v_uid
  limit 1;

  if v_customer.id is null then
    select count(*) into v_match_count
    from public.customers
    where tenant_id = v_tenant
      and app.normalize_customer_phone(phone) = v_phone;

    if v_match_count > 1 then raise exception 'customer_phone_ambiguous'; end if;

    if v_match_count = 1 then
      select * into v_customer
      from public.customers
      where tenant_id = v_tenant
        and app.normalize_customer_phone(phone) = v_phone
      limit 1
      for update;

      if v_customer.user_id is not null and v_customer.user_id <> v_uid then
        raise exception 'phone_already_linked';
      end if;

      update public.customers
      set user_id = v_uid,
          phone = v_phone,
          email = coalesce(email, v_auth_email),
          last_login_at = now(),
          updated_at = now()
      where id = v_customer.id
      returning * into v_customer;
    else
      insert into public.customers(tenant_id, user_id, name, phone, email, last_login_at)
      values(v_tenant, v_uid, null, v_phone, v_auth_email, now())
      returning * into v_customer;
    end if;
  else
    update public.customers
    set last_login_at = now(),
        email = coalesce(email, v_auth_email),
        updated_at = now()
    where id = v_customer.id
    returning * into v_customer;
  end if;

  v_wallet_id := app.wallet_get_or_create(v_tenant, v_customer.id);
  perform app.wallet_expire_reservations(v_wallet_id);
  select balance into v_wallet_balance from public.wallets where id = v_wallet_id;
  v_points_balance := app.points_available(v_customer.id);

  select coalesce(jsonb_agg(row_data order by placed_at desc), '[]'::jsonb)
  into v_orders
  from (
    select
      jsonb_build_object(
        'id', o.id,
        'branch_name', coalesce(b.name_ar, b.name_en, '—'),
        'order_type', o.order_type,
        'status', o.status,
        'total', o.total,
        'currency', o.currency,
        'payment_method', o.payment_method,
        'payment_status', o.payment_status,
        'placed_at', o.placed_at,
        'delivery_address', o.delivery_address_text
      ) as row_data,
      o.placed_at
    from public.orders o
    left join public.branches b on b.id = o.branch_id
    where o.tenant_id = v_tenant and o.customer_id = v_customer.id
    order by o.placed_at desc
    limit 50
  ) q;

  select coalesce(jsonb_agg(row_data order by at desc), '[]'::jsonb)
  into v_wallet_ledger
  from (
    select jsonb_build_object(
      'id', wl.id,
      'delta', wl.delta,
      'balance_after', wl.balance_after,
      'reason', wl.reason,
      'ref_type', wl.ref_type,
      'ref_id', wl.ref_id,
      'at', wl.at
    ) as row_data, wl.at
    from public.wallet_ledger wl
    where wl.tenant_id = v_tenant and wl.customer_id = v_customer.id
    order by wl.at desc
    limit 30
  ) q;

  select coalesce(jsonb_agg(row_data order by at desc), '[]'::jsonb)
  into v_points_ledger
  from (
    select jsonb_build_object(
      'id', pl.id,
      'delta', pl.delta,
      'balance_after', pl.balance_after,
      'reason', pl.reason,
      'expires_at', pl.expires_at,
      'at', pl.at
    ) as row_data, pl.at
    from public.points_ledger pl
    where pl.tenant_id = v_tenant and pl.customer_id = v_customer.id
    order by pl.at desc
    limit 30
  ) q;

  select coalesce(jsonb_agg(row_data order by is_default desc, created_at desc), '[]'::jsonb)
  into v_addresses
  from (
    select jsonb_build_object(
      'id', ca.id,
      'label', ca.label,
      'area_name', a.name_ar,
      'street', ca.street,
      'unit_no', ca.unit_no,
      'floor', ca.floor,
      'apartment', ca.apartment,
      'notes', ca.notes,
      'is_default', ca.is_default
    ) as row_data, ca.is_default, ca.created_at
    from public.customer_addresses ca
    left join public.areas a on a.id = ca.area_id
    where ca.tenant_id = v_tenant and ca.customer_id = v_customer.id
    order by ca.is_default desc, ca.created_at desc
    limit 10
  ) q;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v_customer.id,
      'name', v_customer.name,
      'phone', v_customer.phone,
      'email', v_customer.email,
      'status', v_customer.status,
      'created_at', v_customer.created_at
    ),
    'wallet', jsonb_build_object(
      'balance', coalesce(v_wallet_balance, 0),
      'currency', 'SAR',
      'ledger', v_wallet_ledger
    ),
    'points', jsonb_build_object(
      'balance', coalesce(v_points_balance, 0),
      'ledger', v_points_ledger
    ),
    'orders', v_orders,
    'addresses', v_addresses
  );
end;
$$;

revoke all on function public.storefront_customer_account(text) from public, anon;
grant execute on function public.storefront_customer_account(text) to authenticated;

create or replace function public.storefront_update_customer_profile(
  p_tenant_slug text,
  p_name text,
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_customer public.customers%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_name is null or length(trim(p_name)) < 2 or length(trim(p_name)) > 120 then
    raise exception 'invalid_name';
  end if;
  if p_email is not null and trim(p_email) <> '' and position('@' in trim(p_email)) < 2 then
    raise exception 'invalid_email';
  end if;

  select id into v_tenant from public.tenants where slug = p_tenant_slug and status = 'active' limit 1;
  if v_tenant is null then raise exception 'tenant_not_found'; end if;

  update public.customers
  set name = trim(p_name),
      email = nullif(trim(coalesce(p_email, '')), ''),
      updated_at = now()
  where tenant_id = v_tenant and user_id = v_uid
  returning * into v_customer;

  if v_customer.id is null then raise exception 'customer_account_not_linked'; end if;

  return jsonb_build_object(
    'id', v_customer.id,
    'name', v_customer.name,
    'phone', v_customer.phone,
    'email', v_customer.email
  );
end;
$$;

revoke all on function public.storefront_update_customer_profile(text,text,text) from public, anon;
grant execute on function public.storefront_update_customer_profile(text,text,text) to authenticated;
