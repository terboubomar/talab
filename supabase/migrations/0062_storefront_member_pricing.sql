-- TALAB · storefront member pricing
-- Group prices are resolved server-side after the customer is identified by phone.
-- Price precedence: customer-group override -> branch override -> product base price.
-- Existing product discount logic remains applied after the selected base price.

create or replace function app.storefront_effective_base_price(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_product_id uuid,
  p_customer_group_id uuid default null
)
returns numeric
language sql
stable
set search_path = public, app, pg_temp
as $$
  select coalesce(
    (select pgp.price
       from public.product_group_prices pgp
      where pgp.tenant_id = p_tenant_id
        and pgp.product_id = p_product_id
        and pgp.group_id = p_customer_group_id),
    (select pbp.price
       from public.product_branch_prices pbp
      where pbp.tenant_id = p_tenant_id
        and pbp.product_id = p_product_id
        and pbp.branch_id = p_branch_id),
    (select p.price
       from public.products p
      where p.tenant_id = p_tenant_id
        and p.id = p_product_id)
  );
$$;

revoke all on function app.storefront_effective_base_price(uuid,uuid,uuid,uuid) from public;

create or replace function public.storefront_member_price_flags(p_tenant_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(jsonb_agg(distinct pgp.product_id), '[]'::jsonb)
  from public.product_group_prices pgp
  join public.products p on p.id = pgp.product_id and p.active and p.deleted_at is null
  join public.tenants t on t.id = pgp.tenant_id
  where t.slug = p_tenant_slug
    and t.status in ('trial','active');
$$;

revoke all on function public.storefront_member_price_flags(text) from public;
grant execute on function public.storefront_member_price_flags(text) to anon, authenticated;

create or replace function public.storefront_member_pricing_quote(
  p_branch_id uuid,
  p_customer_phone text,
  p_items jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_branch record;
  v_customer record;
  v_item jsonb;
  v_product record;
  v_qty int;
  v_regular_base numeric;
  v_member_base numeric;
  v_regular_price numeric;
  v_member_price numeric;
  v_mod_json jsonb;
  v_mod_id uuid;
  v_mod_row record;
  v_mod_sum numeric;
  v_regular_subtotal numeric := 0;
  v_member_subtotal numeric := 0;
  v_prices jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object(
      'customer_recognized', false,
      'member_pricing_applied', false,
      'regular_subtotal', 0,
      'subtotal', 0,
      'savings', 0,
      'prices', '[]'::jsonb
    );
  end if;

  select b.id, b.tenant_id
    into v_branch
    from public.branches b
   where b.id = p_branch_id
     and b.status = 'active';
  if v_branch.id is null then raise exception 'invalid_branch'; end if;

  select c.id, c.customer_group_id
    into v_customer
    from public.customers c
   where c.tenant_id = v_branch.tenant_id
     and c.phone = trim(coalesce(p_customer_phone,''))
   limit 1;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select p.id, p.price, p.discount_amount, p.discount_is_percent, p.min_qty, p.max_qty
      into v_product
      from public.products p
     where p.id = (v_item->>'product_id')::uuid
       and p.tenant_id = v_branch.tenant_id
       and p.active and p.orderable
       and p.deleted_at is null;
    if v_product.id is null then raise exception 'invalid_product'; end if;

    v_qty := coalesce((v_item->>'qty')::int, 1);
    if v_qty < coalesce(v_product.min_qty,1) then raise exception 'qty_below_minimum'; end if;
    if v_product.max_qty is not null and v_qty > v_product.max_qty then raise exception 'qty_above_maximum'; end if;

    v_regular_base := app.storefront_effective_base_price(v_branch.tenant_id, p_branch_id, v_product.id, null);
    v_member_base := app.storefront_effective_base_price(v_branch.tenant_id, p_branch_id, v_product.id, v_customer.customer_group_id);
    v_regular_price := v_regular_base;
    v_member_price := v_member_base;

    if coalesce(v_product.discount_amount,0) > 0 then
      if v_product.discount_is_percent then
        v_regular_price := greatest(v_regular_price - (v_regular_price * v_product.discount_amount / 100), 0);
        v_member_price := greatest(v_member_price - (v_member_price * v_product.discount_amount / 100), 0);
      else
        v_regular_price := greatest(v_regular_price - v_product.discount_amount, 0);
        v_member_price := greatest(v_member_price - v_product.discount_amount, 0);
      end if;
    end if;

    v_mod_sum := 0;
    for v_mod_json in select * from jsonb_array_elements(coalesce(v_item->'modifier_ids','[]'::jsonb))
    loop
      v_mod_id := (v_mod_json #>> '{}')::uuid;
      select m.id, m.price
        into v_mod_row
        from public.modifiers m
        join public.product_modifier_groups pmg on pmg.group_id = m.group_id and pmg.product_id = v_product.id
       where m.id = v_mod_id
         and m.tenant_id = v_branch.tenant_id
         and m.active;
      if v_mod_row.id is null then raise exception 'invalid_modifier'; end if;
      v_mod_sum := v_mod_sum + (v_mod_row.price * v_qty);
    end loop;

    v_regular_subtotal := v_regular_subtotal + (v_regular_price * v_qty) + v_mod_sum;
    v_member_subtotal := v_member_subtotal + (v_member_price * v_qty) + v_mod_sum;
    v_prices := v_prices || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'regular_unit_price', v_regular_price,
      'unit_price', v_member_price,
      'member_price_applied', v_customer.customer_group_id is not null and v_member_price <> v_regular_price
    ));
  end loop;

  return jsonb_build_object(
    'customer_recognized', v_customer.id is not null,
    'member_pricing_applied', v_customer.customer_group_id is not null and v_member_subtotal < v_regular_subtotal,
    'regular_subtotal', v_regular_subtotal,
    'subtotal', v_member_subtotal,
    'savings', greatest(v_regular_subtotal - v_member_subtotal, 0),
    'prices', v_prices
  );
end;
$$;

revoke all on function public.storefront_member_pricing_quote(uuid,text,jsonb) from public;
grant execute on function public.storefront_member_pricing_quote(uuid,text,jsonb) to anon, authenticated;

create or replace function public.storefront_place_order(p_tenant_slug text, p_branch_id uuid, p_order_type order_type, p_customer_name text, p_customer_phone text, p_notes text, p_items jsonb, p_area_id uuid default null, p_lat numeric default null, p_lng numeric default null, p_address_text text default null)
returns table(order_id uuid, total numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_brand_id uuid;
  v_customer_id uuid;
  v_customer_group_id uuid;
  v_order_id uuid;
  v_subtotal numeric := 0;
  v_deposit numeric := 0;
  v_tax numeric := 0;
  v_total numeric := 0;
  v_delivery_fee numeric := 0;
  v_zone record;
  v_item jsonb;
  v_product record;
  v_line_total numeric;
  v_order_item_id uuid;
  v_mod jsonb;
  v_mod_id uuid;
  v_mod_row record;
  v_mod_sum numeric;
  v_qty int;
begin
  select id into v_tenant_id from public.tenants
    where slug = p_tenant_slug and status in ('trial', 'active');
  if v_tenant_id is null then raise exception 'invalid_tenant'; end if;

  select brand_id into v_brand_id from public.branches
    where id = p_branch_id and tenant_id = v_tenant_id and status = 'active';
  if v_brand_id is null then raise exception 'invalid_branch'; end if;

  if not exists (
    select 1 from public.branch_order_types
    where branch_id = p_branch_id and tenant_id = v_tenant_id
      and kind = p_order_type and enabled
  ) then raise exception 'order_type_not_available'; end if;

  if p_order_type = 'delivery' then
    if p_area_id is null then raise exception 'missing_delivery_area'; end if;
    select dz.fee, dz.min_order, dz.below_min_fee, dz.eta_minutes
      into v_zone
      from public.delivery_zones dz
      where dz.branch_id = p_branch_id and dz.area_id = p_area_id and dz.enabled;
    if v_zone.fee is null then raise exception 'invalid_delivery_area'; end if;
  end if;

  if p_customer_name is null or length(trim(p_customer_name)) = 0
     or p_customer_phone is null or length(trim(p_customer_phone)) = 0 then
    raise exception 'missing_customer_info';
  end if;

  insert into public.customers (tenant_id, user_id, name, phone)
  values (v_tenant_id, auth.uid(), trim(p_customer_name), trim(p_customer_phone))
  on conflict (tenant_id, phone) do update
    set name = excluded.name,
        user_id = coalesce(public.customers.user_id, excluded.user_id),
        updated_at = now()
  returning id into v_customer_id;

  select customer_group_id into v_customer_group_id
    from public.customers where id = v_customer_id;

  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'empty_order'; end if;

  v_order_id := gen_random_uuid();
  insert into public.orders (
    id, tenant_id, brand_id, branch_id, customer_id, order_type, status,
    notes, subtotal, tax_total, delivery_fee, discount_total, deposit_total, total,
    area_id, delivery_address_text, delivery_lat, delivery_lng
  ) values (
    v_order_id, v_tenant_id, v_brand_id, p_branch_id, v_customer_id, p_order_type, 'pending',
    p_notes, 0, 0, 0, 0, 0, 0,
    p_area_id, p_address_text, p_lat, p_lng
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select p.id, p.name_ar, p.name_en, p.price, p.deposit_amount,
           p.discount_amount, p.discount_is_percent, p.min_qty, p.max_qty, p.qty_step
      into v_product
      from public.products p
      where p.id = (v_item->>'product_id')::uuid
        and p.tenant_id = v_tenant_id
        and p.active and p.orderable
        and p.deleted_at is null;
    if v_product.id is null then raise exception 'invalid_product'; end if;

    v_qty := coalesce((v_item->>'qty')::int, 1);
    if v_qty < coalesce(v_product.min_qty, 1) then raise exception 'qty_below_minimum'; end if;
    if v_product.max_qty is not null and v_qty > v_product.max_qty then raise exception 'qty_above_maximum'; end if;

    select app.storefront_effective_base_price(v_tenant_id, p_branch_id, v_product.id, v_customer_group_id)
      into v_product.price;

    if v_product.discount_amount is not null and v_product.discount_amount > 0 then
      if v_product.discount_is_percent then
        v_product.price := greatest(v_product.price - (v_product.price * v_product.discount_amount / 100), 0);
      else
        v_product.price := greatest(v_product.price - v_product.discount_amount, 0);
      end if;
    end if;

    v_mod_sum := 0;
    v_line_total := v_product.price * v_qty;

    insert into public.order_items (tenant_id, order_id, product_id, name_ar, name_en, unit_price, qty, line_total, notes)
    values (v_tenant_id, v_order_id, v_product.id, v_product.name_ar, v_product.name_en, v_product.price, v_qty, v_line_total, v_item->>'note')
    returning id into v_order_item_id;

    for v_mod in select * from jsonb_array_elements(coalesce(v_item->'modifier_ids', '[]'::jsonb))
    loop
      v_mod_id := (v_mod #>> '{}')::uuid;
      select m.id, m.name_ar, m.price into v_mod_row
        from public.modifiers m
        join public.product_modifier_groups pmg on pmg.group_id = m.group_id and pmg.product_id = v_product.id
        where m.id = v_mod_id and m.tenant_id = v_tenant_id and m.active;
      if v_mod_row.id is null then raise exception 'invalid_modifier'; end if;
      insert into public.order_item_modifiers (tenant_id, order_item_id, modifier_id, name_ar, price)
      values (v_tenant_id, v_order_item_id, v_mod_row.id, v_mod_row.name_ar, v_mod_row.price);
      v_mod_sum := v_mod_sum + (v_mod_row.price * v_qty);
    end loop;

    update public.order_items set line_total = line_total + v_mod_sum where id = v_order_item_id;
    v_subtotal := v_subtotal + v_line_total + v_mod_sum;
    v_deposit := v_deposit + coalesce(v_product.deposit_amount, 0) * v_qty;
  end loop;

  if p_order_type = 'delivery' then
    v_delivery_fee := case when v_subtotal >= v_zone.min_order then v_zone.fee else v_zone.below_min_fee end;
  end if;

  select vat_rate into v_tax from public.tenants where id = v_tenant_id;
  v_tax := round(v_subtotal - (v_subtotal / (1 + coalesce(v_tax, 0.15))), 2);
  v_total := v_subtotal + v_deposit + v_delivery_fee;

  update public.orders
    set subtotal = v_subtotal, tax_total = v_tax, deposit_total = v_deposit,
        delivery_fee = v_delivery_fee, total = v_total
    where id = v_order_id;

  insert into public.order_status_history (tenant_id, order_id, status, note)
  values (v_tenant_id, v_order_id, 'pending', 'placed via storefront');

  return query select v_order_id, v_total;
end;
$$;

create or replace function public.storefront_coupon_quote(p_branch_id uuid, p_order_type order_type, p_customer_phone text, p_code text, p_items jsonb, p_cart_id uuid, p_area_id uuid default null, p_source text default 'web')
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_branch record; v_coupon public.coupons%rowtype; v_customer record; v_item jsonb; v_product record; v_mod_json jsonb; v_mod_id uuid; v_mod_row record;
  v_qty int; v_price numeric; v_line numeric; v_mod_sum numeric; v_subtotal numeric:=0; v_eligible numeric:=0; v_deposit numeric:=0; v_delivery numeric:=0;
  v_discount numeric:=0; v_delivery_discount numeric:=0; v_total numeric:=0; v_has_item_scope boolean; v_zone record; v_reservation_id uuid;
  v_expires timestamptz:=now()+interval '10 minutes'; v_used int:=0; v_customer_used int:=0;
begin
  if p_cart_id is null then raise exception 'cart_id_required'; end if; if p_code is null or length(trim(p_code))=0 then raise exception 'coupon_code_required'; end if;
  if p_items is null or jsonb_array_length(p_items)=0 then raise exception 'empty_order'; end if;
  select b.id,b.tenant_id,b.brand_id into v_branch from public.branches b where b.id=p_branch_id and b.status='active'; if v_branch.id is null then raise exception 'invalid_branch'; end if;
  select * into v_coupon from public.coupons c where c.tenant_id=v_branch.tenant_id and lower(c.code)=lower(trim(p_code)) for update;
  if v_coupon.id is null then raise exception 'coupon_not_found'; end if; if v_coupon.status<>'active' then raise exception 'coupon_inactive'; end if;
  if v_coupon.starts_at is not null and now()<v_coupon.starts_at then raise exception 'coupon_not_started'; end if; if v_coupon.ends_at is not null and now()>v_coupon.ends_at then raise exception 'coupon_expired'; end if;
  if not app.coupon_daypart_allows(v_coupon.day_parting_json,now()) then raise exception 'coupon_outside_schedule'; end if;
  select c.id,c.customer_group_id into v_customer from public.customers c where c.tenant_id=v_branch.tenant_id and c.phone=trim(coalesce(p_customer_phone,'')) limit 1;
  if exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='order_type') and not exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='order_type' and scope_id=p_order_type::text) then raise exception 'coupon_scope_mismatch'; end if;
  if exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='source') and not exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='source' and lower(scope_id)=lower(coalesce(p_source,'web'))) then raise exception 'coupon_scope_mismatch'; end if;
  if exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='branch') and not exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='branch' and scope_id=p_branch_id::text) then raise exception 'coupon_scope_mismatch'; end if;
  if exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='customer') and (v_customer.id is null or not exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='customer' and scope_id=v_customer.id::text)) then raise exception 'coupon_scope_mismatch'; end if;
  if exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='customer_group') and (v_customer.customer_group_id is null or not exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='customer_group' and scope_id=v_customer.customer_group_id::text)) then raise exception 'coupon_scope_mismatch'; end if;
  v_has_item_scope:=exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type in ('product','category'));
  for v_item in select * from jsonb_array_elements(p_items) loop
    select p.id,p.category_id,p.price,p.discount_amount,p.discount_is_percent,p.deposit_amount,p.min_qty,p.max_qty into v_product from public.products p where p.id=(v_item->>'product_id')::uuid and p.tenant_id=v_branch.tenant_id and p.active and p.orderable and p.deleted_at is null;
    if v_product.id is null then raise exception 'invalid_product'; end if; v_qty:=coalesce((v_item->>'qty')::int,1);
    if v_qty<coalesce(v_product.min_qty,1) then raise exception 'qty_below_minimum'; end if; if v_product.max_qty is not null and v_qty>v_product.max_qty then raise exception 'qty_above_maximum'; end if;
    select app.storefront_effective_base_price(v_branch.tenant_id,p_branch_id,v_product.id,v_customer.customer_group_id) into v_price;
    if coalesce(v_product.discount_amount,0)>0 then v_price:=case when v_product.discount_is_percent then greatest(v_price-(v_price*v_product.discount_amount/100),0) else greatest(v_price-v_product.discount_amount,0) end; end if;
    v_mod_sum:=0;
    for v_mod_json in select * from jsonb_array_elements(coalesce(v_item->'modifier_ids','[]'::jsonb)) loop
      v_mod_id:=(v_mod_json#>>'{}')::uuid;
      select m.id,m.price into v_mod_row from public.modifiers m join public.product_modifier_groups pmg on pmg.group_id=m.group_id and pmg.product_id=v_product.id where m.id=v_mod_id and m.tenant_id=v_branch.tenant_id and m.active;
      if v_mod_row.id is null then raise exception 'invalid_modifier'; end if; v_mod_sum:=v_mod_sum+(v_mod_row.price*v_qty);
    end loop;
    v_line:=v_price*v_qty+v_mod_sum; v_subtotal:=v_subtotal+v_line; v_deposit:=v_deposit+coalesce(v_product.deposit_amount,0)*v_qty;
    if not v_has_item_scope or exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='product' and scope_id=v_product.id::text) or exists(select 1 from public.coupon_scopes where coupon_id=v_coupon.id and scope_type='category' and scope_id=v_product.category_id::text) then v_eligible:=v_eligible+v_line; end if;
  end loop;
  if v_subtotal<v_coupon.min_purchase then raise exception 'coupon_min_purchase'; end if; if v_eligible<=0 then raise exception 'coupon_scope_mismatch'; end if;
  if p_order_type='delivery' then if p_area_id is null then raise exception 'missing_delivery_area'; end if; select dz.fee,dz.min_order,dz.below_min_fee into v_zone from public.delivery_zones dz where dz.branch_id=p_branch_id and dz.area_id=p_area_id and dz.enabled; if v_zone.fee is null then raise exception 'invalid_delivery_area'; end if; v_delivery:=case when v_subtotal>=v_zone.min_order then v_zone.fee else v_zone.below_min_fee end; end if;
  v_discount:=app.coupon_discount_amount(v_coupon.id,v_eligible); v_delivery_discount:=case when v_coupon.free_delivery and p_order_type='delivery' then v_delivery else 0 end;
  update public.coupon_reservations set status='expired',updated_at=now() where coupon_id=v_coupon.id and status='reserved' and expires_at<=now();
  update public.coupon_reservations set status='released',updated_at=now() where cart_id=p_cart_id and coupon_id<>v_coupon.id and status='reserved';
  select count(*) into v_used from public.coupon_redemptions where coupon_id=v_coupon.id and status='redeemed';
  v_used:=v_used+(select count(*) from public.coupon_reservations where coupon_id=v_coupon.id and cart_id<>p_cart_id and (status='attached' or (status='reserved' and expires_at>now())));
  if v_coupon.total_limit is not null and v_used>=v_coupon.total_limit then raise exception 'coupon_total_limit'; end if;
  if v_coupon.per_customer_limit is not null then
    select count(*) into v_customer_used from public.coupon_redemptions where coupon_id=v_coupon.id and status='redeemed' and v_customer.id is not null and customer_id=v_customer.id;
    v_customer_used:=v_customer_used+(select count(*) from public.coupon_reservations r where r.coupon_id=v_coupon.id and r.cart_id<>p_cart_id and (r.status='attached' or (r.status='reserved' and r.expires_at>now())) and ((v_customer.id is not null and r.customer_id=v_customer.id) or (v_customer.id is null and r.customer_phone=trim(p_customer_phone))));
    if v_customer_used>=v_coupon.per_customer_limit then raise exception 'coupon_customer_limit'; end if;
  end if;
  insert into public.coupon_reservations(tenant_id,coupon_id,cart_id,customer_id,customer_phone,branch_id,amount,delivery_discount,status,expires_at)
  values(v_branch.tenant_id,v_coupon.id,p_cart_id,v_customer.id,trim(coalesce(p_customer_phone,'')),p_branch_id,v_discount,v_delivery_discount,'reserved',v_expires)
  on conflict (cart_id) where status in ('reserved','attached') do update set coupon_id=excluded.coupon_id,customer_id=excluded.customer_id,customer_phone=excluded.customer_phone,branch_id=excluded.branch_id,amount=excluded.amount,delivery_discount=excluded.delivery_discount,status='reserved',expires_at=excluded.expires_at,order_id=null,updated_at=now() returning id into v_reservation_id;
  v_total:=greatest(v_subtotal-v_discount,0)+v_deposit+greatest(v_delivery-v_delivery_discount,0);
  return jsonb_build_object('coupon_id',v_coupon.id,'code',v_coupon.code,'reservation_id',v_reservation_id,'discount',v_discount,'delivery_discount',v_delivery_discount,'subtotal',v_subtotal,'total',v_total,'expires_at',v_expires,'success_msg_ar',v_coupon.success_msg_ar,'success_msg_en',v_coupon.success_msg_en);
end;
$$;
