-- Call-center payment method support.
-- Reuses the same enabled Moyasar account rule as storefront checkout.

create or replace function public.staff_create_call_center_order_v2(
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
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_brand uuid;
  v_payment_account uuid;
  v_result jsonb;
  v_order uuid;
begin
  if v_tenant is null or not app.has_perm('orders.create') then
    raise exception 'not_authorized';
  end if;

  if p_payment_method not in ('cash','online') then
    raise exception 'invalid_payment_method';
  end if;

  select b.brand_id into v_brand
  from public.branches b
  where b.id = p_branch_id
    and b.tenant_id = v_tenant
    and b.status = 'active'
    and app.can_see_branch(b.id);

  if v_brand is null then raise exception 'invalid_branch'; end if;

  if p_payment_method = 'online' then
    select pa.id into v_payment_account
    from public.payment_accounts pa
    where pa.tenant_id = v_tenant
      and pa.provider = 'moyasar'
      and pa.enabled
      and coalesce(pa.public_config->>'publishable_api_key','') <> ''
      and (pa.brand_id is null or pa.brand_id = v_brand)
    order by (pa.brand_id = v_brand) desc, pa.created_at asc
    limit 1;

    if v_payment_account is null then
      raise exception 'online_payment_not_available';
    end if;
  end if;

  v_result := public.staff_create_call_center_order(
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
  );

  v_order := (v_result->>'order_id')::uuid;

  if p_payment_method = 'online' then
    update public.orders
      set payment_method = 'online',
          payment_status = 'pending',
          payment_account_id = v_payment_account,
          updated_at = now()
    where id = v_order and tenant_id = v_tenant;
  else
    update public.orders
      set payment_method = 'cash',
          payment_status = 'unpaid',
          payment_account_id = null,
          updated_at = now()
    where id = v_order and tenant_id = v_tenant;
  end if;

  insert into public.activity_log(tenant_id,actor_id,action,entity_type,entity_id,diff,at)
  values(
    v_tenant,
    app.current_staff_id(),
    'order.call_center.payment_method',
    'order',
    v_order,
    jsonb_build_object('payment_method',p_payment_method,'payment_account_id',v_payment_account),
    now()
  );

  return v_result || jsonb_build_object(
    'payment_method', p_payment_method,
    'payment_status', case when p_payment_method='online' then 'pending' else 'unpaid' end,
    'payment_account_id', v_payment_account
  );
end;
$$;

revoke all on function public.staff_create_call_center_order_v2(uuid,public.order_type,text,text,text,jsonb,uuid,numeric,numeric,text,text) from public, anon;
grant execute on function public.staff_create_call_center_order_v2(uuid,public.order_type,text,text,text,jsonb,uuid,numeric,numeric,text,text) to authenticated;
