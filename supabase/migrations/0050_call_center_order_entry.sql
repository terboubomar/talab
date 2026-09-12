-- Call-center order entry from BUILD-SPEC.
-- Staff-only, permission gated, server-priced, branch scoped.

alter table public.orders
  add column if not exists source text not null default 'web',
  add column if not exists created_by_staff_id uuid references public.staff(id) on delete set null;

create index if not exists orders_tenant_source_created_idx
  on public.orders (tenant_id, source, created_at desc);
create index if not exists orders_created_by_staff_idx
  on public.orders (created_by_staff_id) where created_by_staff_id is not null;

create or replace function public.staff_call_center_setup()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_perm('orders.create') then
    raise exception 'not_authorized';
  end if;

  return jsonb_build_object(
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'name_ar', b.name_ar,
        'name_en', b.name_en,
        'order_types', coalesce((
          select jsonb_agg(bot.kind order by bot.kind)
          from public.branch_order_types bot
          where bot.branch_id = b.id and bot.tenant_id = v_tenant and bot.enabled
        ), '[]'::jsonb),
        'delivery_zones', coalesce((
          select jsonb_agg(jsonb_build_object(
            'area_id', a.id,
            'name_ar', a.name_ar,
            'name_en', a.name_en,
            'lat', a.lat,
            'lng', a.lng,
            'eta_minutes', dz.eta_minutes,
            'fee', dz.fee,
            'min_order', dz.min_order,
            'below_min_fee', dz.below_min_fee
          ) order by a.sort, a.name_ar)
          from public.delivery_zones dz
          join public.areas a on a.id = dz.area_id
          where dz.branch_id = b.id and dz.tenant_id = v_tenant and dz.enabled and a.status = 'active'
        ), '[]'::jsonb)
      ) order by b.sort, b.name_ar)
      from public.branches b
      where b.tenant_id = v_tenant and b.status = 'active' and app.can_see_branch(b.id)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.staff_call_center_customer_lookup(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_customer public.customers%rowtype;
begin
  if not app.has_perm('orders.create') then raise exception 'not_authorized'; end if;
  select * into v_customer
  from public.customers
  where tenant_id = app.current_tenant_id() and phone = trim(p_phone)
  limit 1;

  if v_customer.id is null then return null; end if;
  return jsonb_build_object(
    'id', v_customer.id,
    'name', v_customer.name,
    'phone', v_customer.phone,
    'email', v_customer.email,
    'addresses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ca.id, 'label', ca.label, 'area_id', ca.area_id,
        'lat', ca.lat, 'lng', ca.lng, 'street', ca.street,
        'unit_no', ca.unit_no, 'floor', ca.floor, 'apartment', ca.apartment,
        'notes', ca.notes
      ) order by ca.created_at desc)
      from public.customer_addresses ca
      where ca.customer_id = v_customer.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.staff_create_call_center_order(
  p_branch_id uuid,
  p_order_type public.order_type,
  p_customer_name text,
  p_customer_phone text,
  p_notes text,
  p_items jsonb,
  p_area_id uuid default null,
  p_lat numeric default null,
  p_lng numeric default null,
  p_address_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_staff uuid := app.current_staff_id();
  v_brand uuid;
  v_customer uuid;
  v_order uuid := gen_random_uuid();
  v_subtotal numeric := 0;
  v_deposit numeric := 0;
  v_delivery numeric := 0;
  v_tax numeric := 0;
  v_total numeric := 0;
  v_vat numeric := 0.15;
  v_zone record;
  v_item jsonb;
  v_product record;
  v_qty int;
  v_unit numeric;
  v_line numeric;
  v_order_item uuid;
  v_mod jsonb;
  v_mod_id uuid;
  v_mod_row record;
  v_mod_sum numeric;
begin
  if v_tenant is null or v_staff is null or not app.has_perm('orders.create') then
    raise exception 'not_authorized';
  end if;
  if not app.can_see_branch(p_branch_id) then raise exception 'not_authorized'; end if;

  select brand_id into v_brand
  from public.branches
  where id = p_branch_id and tenant_id = v_tenant and status = 'active';
  if v_brand is null then raise exception 'invalid_branch'; end if;

  if not exists (
    select 1 from public.branch_order_types
    where tenant_id = v_tenant and branch_id = p_branch_id and kind = p_order_type and enabled
  ) then raise exception 'order_type_not_available'; end if;

  if trim(coalesce(p_customer_name,'')) = '' or trim(coalesce(p_customer_phone,'')) = '' then
    raise exception 'missing_customer_info';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_order';
  end if;

  if p_order_type = 'delivery' then
    if p_area_id is null then raise exception 'missing_delivery_area'; end if;
    select dz.fee, dz.min_order, dz.below_min_fee, dz.eta_minutes into v_zone
    from public.delivery_zones dz
    where dz.tenant_id = v_tenant and dz.branch_id = p_branch_id and dz.area_id = p_area_id and dz.enabled;
    if v_zone.fee is null then raise exception 'invalid_delivery_area'; end if;
    if trim(coalesce(p_address_text,'')) = '' then raise exception 'missing_delivery_address'; end if;
  end if;

  insert into public.customers (tenant_id, name, phone)
  values (v_tenant, trim(p_customer_name), trim(p_customer_phone))
  on conflict (tenant_id, phone) do update
    set name = excluded.name, updated_at = now()
  returning id into v_customer;

  insert into public.orders (
    id, tenant_id, brand_id, branch_id, customer_id, order_type, status,
    notes, subtotal, tax_total, delivery_fee, discount_total, deposit_total, total,
    area_id, delivery_address_text, delivery_lat, delivery_lng,
    payment_method, payment_status, source, created_by_staff_id
  ) values (
    v_order, v_tenant, v_brand, p_branch_id, v_customer, p_order_type, 'pending',
    nullif(trim(coalesce(p_notes,'')),''), 0,0,0,0,0,0,
    p_area_id, p_address_text, p_lat, p_lng,
    'cash', 'unpaid', 'call_center', v_staff
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select p.id, p.name_ar, p.name_en, p.price, p.deposit_amount,
           p.discount_amount, p.discount_is_percent, p.min_qty, p.max_qty, p.qty_step
      into v_product
    from public.products p
    where p.id = (v_item->>'product_id')::uuid
      and p.tenant_id = v_tenant and p.active and p.orderable and p.deleted_at is null;
    if v_product.id is null then raise exception 'invalid_product'; end if;

    if exists (
      select 1 from public.product_branch_availability pba
      where pba.product_id = v_product.id and pba.branch_id = p_branch_id and not pba.available
    ) then raise exception 'product_not_available'; end if;

    v_qty := coalesce((v_item->>'qty')::int, 1);
    if v_qty < coalesce(v_product.min_qty,1) then raise exception 'qty_below_minimum'; end if;
    if v_product.max_qty is not null and v_qty > v_product.max_qty then raise exception 'qty_above_maximum'; end if;

    select coalesce((select pbp.price from public.product_branch_prices pbp where pbp.product_id=v_product.id and pbp.branch_id=p_branch_id), v_product.price)
      into v_unit;
    if v_product.discount_amount is not null and v_product.discount_amount > 0 then
      v_unit := case when v_product.discount_is_percent
        then greatest(v_unit - (v_unit*v_product.discount_amount/100),0)
        else greatest(v_unit-v_product.discount_amount,0) end;
    end if;

    v_line := v_unit * v_qty;
    insert into public.order_items(tenant_id,order_id,product_id,name_ar,name_en,unit_price,qty,line_total,notes)
    values(v_tenant,v_order,v_product.id,v_product.name_ar,v_product.name_en,v_unit,v_qty,v_line,v_item->>'note')
    returning id into v_order_item;

    v_mod_sum := 0;
    for v_mod in select * from jsonb_array_elements(coalesce(v_item->'modifier_ids','[]'::jsonb))
    loop
      v_mod_id := (v_mod #>> '{}')::uuid;
      select m.id,m.name_ar,m.price into v_mod_row
      from public.modifiers m
      join public.product_modifier_groups pmg on pmg.group_id=m.group_id and pmg.product_id=v_product.id
      where m.id=v_mod_id and m.tenant_id=v_tenant and m.active;
      if v_mod_row.id is null then raise exception 'invalid_modifier'; end if;
      insert into public.order_item_modifiers(tenant_id,order_item_id,modifier_id,name_ar,price)
      values(v_tenant,v_order_item,v_mod_row.id,v_mod_row.name_ar,v_mod_row.price);
      v_mod_sum := v_mod_sum + (v_mod_row.price*v_qty);
    end loop;
    update public.order_items set line_total=line_total+v_mod_sum where id=v_order_item;
    v_subtotal := v_subtotal+v_line+v_mod_sum;
    v_deposit := v_deposit+coalesce(v_product.deposit_amount,0)*v_qty;
  end loop;

  if p_order_type='delivery' then
    v_delivery := case when v_subtotal >= v_zone.min_order then v_zone.fee else v_zone.below_min_fee end;
  end if;
  select coalesce(vat_rate,0.15) into v_vat from public.tenants where id=v_tenant;
  v_tax := round(v_subtotal-(v_subtotal/(1+v_vat)),2);
  v_total := v_subtotal+v_deposit+v_delivery;

  update public.orders
  set subtotal=v_subtotal,tax_total=v_tax,deposit_total=v_deposit,delivery_fee=v_delivery,total=v_total,updated_at=now()
  where id=v_order;

  insert into public.order_status_history(tenant_id,order_id,status,changed_by,note)
  values(v_tenant,v_order,'pending',v_staff,'created by call center');

  insert into public.activity_log(tenant_id,actor_id,action,entity_type,entity_id,diff_json,at)
  values(v_tenant,v_staff,'order.call_center.create','order',v_order,
    jsonb_build_object('source','call_center','branch_id',p_branch_id,'order_type',p_order_type,'total',v_total),now());

  return jsonb_build_object('order_id',v_order,'total',v_total,'status','pending');
end;
$$;

revoke all on function public.staff_call_center_setup() from public, anon;
revoke all on function public.staff_call_center_customer_lookup(text) from public, anon;
revoke all on function public.staff_create_call_center_order(uuid,public.order_type,text,text,text,jsonb,uuid,numeric,numeric,text) from public, anon;
grant execute on function public.staff_call_center_setup() to authenticated;
grant execute on function public.staff_call_center_customer_lookup(text) to authenticated;
grant execute on function public.staff_create_call_center_order(uuid,public.order_type,text,text,text,jsonb,uuid,numeric,numeric,text) to authenticated;
