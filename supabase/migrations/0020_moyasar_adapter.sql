-- TALAB Phase 1 — Moyasar adapter.
-- Keeps current cash checkout intact and adds an online-payment path without
-- changing the existing storefront_place_order signature.

create or replace function public.storefront_place_order_v2(
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
  p_payment_method text default 'cash'
)
returns table(order_id uuid, total numeric)
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_order_id uuid;
  v_total numeric;
  v_tenant_id uuid;
  v_brand_id uuid;
  v_payment_account_id uuid;
begin
  if p_payment_method not in ('cash', 'online') then
    raise exception 'invalid_payment_method';
  end if;

  select r.order_id, r.total into v_order_id, v_total
  from public.storefront_place_order(
    p_tenant_slug,
    p_branch_id,
    p_order_type,
    p_customer_name,
    p_customer_phone,
    p_notes,
    p_items,
    p_area_id,
    p_lat,
    p_lng,
    p_address_text
  ) r;

  if p_payment_method = 'online' then
    select o.tenant_id, o.brand_id
      into v_tenant_id, v_brand_id
      from public.orders o
      where o.id = v_order_id;

    select pa.id into v_payment_account_id
      from public.payment_accounts pa
      where pa.tenant_id = v_tenant_id
        and pa.provider = 'moyasar'
        and pa.enabled
        and coalesce(pa.public_config->>'publishable_api_key', '') <> ''
        and (pa.brand_id is null or pa.brand_id = v_brand_id)
      order by (pa.brand_id = v_brand_id) desc, pa.created_at asc
      limit 1;

    if v_payment_account_id is null then
      raise exception 'online_payment_not_available';
    end if;

    update public.orders
      set payment_method = 'online',
          payment_status = 'pending',
          payment_account_id = v_payment_account_id,
          updated_at = now()
      where id = v_order_id;
  end if;

  return query select v_order_id, v_total;
end;
$$;

revoke execute on function public.storefront_place_order_v2(text, uuid, public.order_type, text, text, text, jsonb, uuid, numeric, numeric, text, text)
  from public;
grant execute on function public.storefront_place_order_v2(text, uuid, public.order_type, text, text, text, jsonb, uuid, numeric, numeric, text, text)
  to anon, authenticated;

-- Anonymous storefront may read only non-secret configuration needed to render
-- Moyasar Form. payment_accounts itself remains unavailable to anon.
create or replace function public.storefront_payment_options(p_branch_id uuid)
returns table(
  account_id uuid,
  provider text,
  environment text,
  methods text[],
  publishable_api_key text,
  supported_networks text[]
)
language sql
security definer
stable
set search_path = public
as $$
  select
    pa.id,
    pa.provider,
    pa.environment,
    pa.methods,
    pa.public_config->>'publishable_api_key',
    coalesce(
      array(select jsonb_array_elements_text(pa.public_config->'supported_networks')),
      array['mada','visa','mastercard']::text[]
    )
  from public.branches b
  join public.payment_accounts pa
    on pa.tenant_id = b.tenant_id
   and (pa.brand_id is null or pa.brand_id = b.brand_id)
  where b.id = p_branch_id
    and b.status = 'active'
    and pa.provider = 'moyasar'
    and pa.enabled
    and coalesce(pa.public_config->>'publishable_api_key', '') <> ''
  order by (pa.brand_id = b.brand_id) desc, pa.created_at asc
  limit 1;
$$;

revoke execute on function public.storefront_payment_options(uuid) from public;
grant execute on function public.storefront_payment_options(uuid) to anon, authenticated;

-- Paid online orders may enter the kitchen queue. Cash orders keep the existing
-- lifecycle. This is the server-side guard, not merely a UI filter.
create or replace function public.staff_update_order_status(p_order_id uuid, p_new_status public.order_status)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_tenant_id uuid;
  v_branch_id uuid;
  v_current public.order_status;
  v_order_type public.order_type;
  v_payment_method text;
  v_payment_status text;
  v_perm text;
  v_allowed boolean;
begin
  select tenant_id, branch_id, status, order_type, payment_method, payment_status
    into v_tenant_id, v_branch_id, v_current, v_order_type, v_payment_method, v_payment_status
    from public.orders where id = p_order_id;

  if v_tenant_id is null then
    raise exception 'order_not_found';
  end if;
  if v_tenant_id <> app.current_tenant_id() and not app.is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if not app.can_see_branch(v_branch_id) then
    raise exception 'not_authorized';
  end if;

  if p_new_status = 'accepted'
     and v_payment_method = 'online'
     and v_payment_status not in ('paid', 'partially_refunded') then
    raise exception 'payment_not_confirmed';
  end if;

  v_perm := case p_new_status
    when 'accepted' then 'orders.status.accept'
    when 'preparing' then 'orders.status.accept'
    when 'ready' then 'orders.status.ready'
    when 'out_for_delivery' then 'orders.status.out_for_delivery'
    when 'completed' then 'orders.status.delivered'
    when 'cancelled' then 'orders.status.cancel'
    else null
  end;
  if v_perm is null or not app.has_perm(v_perm) then
    raise exception 'not_authorized';
  end if;

  v_allowed := case
    when p_new_status = 'cancelled' and v_current not in ('completed', 'cancelled') then true
    when v_current = 'pending' and p_new_status = 'accepted' then true
    when v_current = 'accepted' and p_new_status = 'preparing' then true
    when v_current = 'preparing' and p_new_status = 'ready' then true
    when v_current = 'ready' and p_new_status = 'out_for_delivery' and v_order_type = 'delivery' then true
    when v_current = 'ready' and p_new_status = 'completed' and v_order_type <> 'delivery' then true
    when v_current = 'out_for_delivery' and p_new_status = 'completed' then true
    else false
  end;
  if not v_allowed then
    raise exception 'invalid_transition';
  end if;

  update public.orders set status = p_new_status, updated_at = now() where id = p_order_id;

  insert into public.order_status_history (tenant_id, order_id, status, changed_by)
  select v_tenant_id, p_order_id, p_new_status, s.id
    from public.staff s where s.user_id = auth.uid()
  union all
  select v_tenant_id, p_order_id, p_new_status, null
  where not exists (select 1 from public.staff where user_id = auth.uid())
  limit 1;
end;
$$;

revoke execute on function public.staff_update_order_status(uuid, public.order_status) from public, anon;
grant execute on function public.staff_update_order_status(uuid, public.order_status) to authenticated;
