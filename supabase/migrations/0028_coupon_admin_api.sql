-- TALAB Phase 2 — atomic coupon administration and tenant-scoped scope options.

create or replace function public.staff_coupon_scope_options()
returns jsonb
language plpgsql
security definer
set search_path=public,app
as $$
declare v_tenant_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authorized'; end if;
  v_tenant_id:=app.current_tenant_id();
  if v_tenant_id is null or not (app.has_perm('coupons.view') or app.is_platform_admin()) then raise exception 'not_authorized'; end if;
  return jsonb_build_object(
    'branches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name_ar) order by b.name_ar) from public.branches b where b.tenant_id=v_tenant_id and b.status='active'),'[]'::jsonb),
    'categories',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name_ar) order by c.name_ar) from public.categories c where c.tenant_id=v_tenant_id and c.active and c.deleted_at is null),'[]'::jsonb),
    'products',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name_ar,'category_id',p.category_id) order by p.name_ar) from public.products p where p.tenant_id=v_tenant_id and p.active and p.deleted_at is null),'[]'::jsonb),
    'customer_groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name_ar) order by g.name_ar) from public.customer_groups g where g.tenant_id=v_tenant_id),'[]'::jsonb),
    'customers',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'phone',c.phone) order by c.name) from public.customers c where c.tenant_id=v_tenant_id),'[]'::jsonb)
  );
end;
$$;
revoke execute on function public.staff_coupon_scope_options() from public,anon;
grant execute on function public.staff_coupon_scope_options() to authenticated;

create or replace function public.admin_save_coupon(
  p_coupon_id uuid,
  p_rule jsonb,
  p_scopes jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public,app
as $$
declare
  v_tenant_id uuid;
  v_id uuid;
  v_scope jsonb;
  v_type text;
  v_value text;
  v_is_create boolean:=p_coupon_id is null;
begin
  if auth.uid() is null then raise exception 'not_authorized'; end if;
  v_tenant_id:=app.current_tenant_id();
  if v_tenant_id is null then raise exception 'tenant_context_required'; end if;
  if v_is_create and not (app.has_perm('coupons.create') or app.is_platform_admin()) then raise exception 'not_authorized'; end if;
  if not v_is_create and not (app.has_perm('coupons.update') or app.is_platform_admin()) then raise exception 'not_authorized'; end if;

  if trim(coalesce(p_rule->>'code',''))='' then raise exception 'coupon_code_required'; end if;
  if coalesce(p_rule->>'discount_type','') not in ('percent','fixed') then raise exception 'invalid_discount_type'; end if;
  if coalesce((p_rule->>'value')::numeric,0)<0 then raise exception 'invalid_coupon_value'; end if;
  if coalesce((p_rule->>'value')::numeric,0)=0 and not coalesce((p_rule->>'free_delivery')::boolean,false) then raise exception 'coupon_value_required'; end if;

  if v_is_create then
    insert into public.coupons(
      tenant_id,code,discount_type,value,max_discount,free_delivery,min_purchase,
      starts_at,ends_at,total_limit,per_customer_limit,auto_apply,day_parting_json,
      success_msg_ar,success_msg_en,status
    ) values (
      v_tenant_id,upper(trim(p_rule->>'code')),p_rule->>'discount_type',coalesce((p_rule->>'value')::numeric,0),
      nullif(p_rule->>'max_discount','')::numeric,coalesce((p_rule->>'free_delivery')::boolean,false),
      coalesce(nullif(p_rule->>'min_purchase','')::numeric,0),nullif(p_rule->>'starts_at','')::timestamptz,
      nullif(p_rule->>'ends_at','')::timestamptz,nullif(p_rule->>'total_limit','')::int,
      nullif(p_rule->>'per_customer_limit','')::int,coalesce((p_rule->>'auto_apply')::boolean,false),
      coalesce(p_rule->'day_parting_json','{}'::jsonb),nullif(p_rule->>'success_msg_ar',''),
      nullif(p_rule->>'success_msg_en',''),coalesce(nullif(p_rule->>'status',''),'active')
    ) returning id into v_id;
  else
    select id into v_id from public.coupons where id=p_coupon_id and tenant_id=v_tenant_id for update;
    if v_id is null then raise exception 'coupon_not_found'; end if;
    update public.coupons set
      code=upper(trim(p_rule->>'code')),discount_type=p_rule->>'discount_type',value=coalesce((p_rule->>'value')::numeric,0),
      max_discount=nullif(p_rule->>'max_discount','')::numeric,free_delivery=coalesce((p_rule->>'free_delivery')::boolean,false),
      min_purchase=coalesce(nullif(p_rule->>'min_purchase','')::numeric,0),starts_at=nullif(p_rule->>'starts_at','')::timestamptz,
      ends_at=nullif(p_rule->>'ends_at','')::timestamptz,total_limit=nullif(p_rule->>'total_limit','')::int,
      per_customer_limit=nullif(p_rule->>'per_customer_limit','')::int,auto_apply=coalesce((p_rule->>'auto_apply')::boolean,false),
      day_parting_json=coalesce(p_rule->'day_parting_json','{}'::jsonb),success_msg_ar=nullif(p_rule->>'success_msg_ar',''),
      success_msg_en=nullif(p_rule->>'success_msg_en',''),status=coalesce(nullif(p_rule->>'status',''),'active'),updated_at=now()
    where id=v_id;
    delete from public.coupon_scopes where coupon_id=v_id;
  end if;

  for v_scope in select * from jsonb_array_elements(coalesce(p_scopes,'[]'::jsonb)) loop
    v_type:=v_scope->>'type'; v_value:=v_scope->>'id';
    if v_type not in ('order_type','source','branch','product','category','customer_group','customer') or trim(coalesce(v_value,''))='' then raise exception 'invalid_coupon_scope'; end if;
    if v_type='order_type' and v_value not in ('delivery','pickup','curbside','dinein') then raise exception 'invalid_coupon_scope'; end if;
    if v_type='source' and v_value not in ('web','mobile','call_center') then raise exception 'invalid_coupon_scope'; end if;
    if v_type='branch' and not exists(select 1 from public.branches where id=v_value::uuid and tenant_id=v_tenant_id) then raise exception 'invalid_coupon_scope'; end if;
    if v_type='product' and not exists(select 1 from public.products where id=v_value::uuid and tenant_id=v_tenant_id) then raise exception 'invalid_coupon_scope'; end if;
    if v_type='category' and not exists(select 1 from public.categories where id=v_value::uuid and tenant_id=v_tenant_id) then raise exception 'invalid_coupon_scope'; end if;
    if v_type='customer_group' and not exists(select 1 from public.customer_groups where id=v_value::uuid and tenant_id=v_tenant_id) then raise exception 'invalid_coupon_scope'; end if;
    if v_type='customer' and not exists(select 1 from public.customers where id=v_value::uuid and tenant_id=v_tenant_id) then raise exception 'invalid_coupon_scope'; end if;
    insert into public.coupon_scopes(tenant_id,coupon_id,scope_type,scope_id)
    values(v_tenant_id,v_id,v_type,v_value) on conflict do nothing;
  end loop;

  return v_id;
end;
$$;
revoke execute on function public.admin_save_coupon(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.admin_save_coupon(uuid,jsonb,jsonb) to authenticated;

create or replace function public.admin_delete_coupon(p_coupon_id uuid)
returns void
language plpgsql
security definer
set search_path=public,app
as $$
declare v_tenant_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authorized'; end if;
  v_tenant_id:=app.current_tenant_id();
  if v_tenant_id is null or not (app.has_perm('coupons.delete') or app.is_platform_admin()) then raise exception 'not_authorized'; end if;
  delete from public.coupons where id=p_coupon_id and tenant_id=v_tenant_id;
  if not found then raise exception 'coupon_not_found'; end if;
end;
$$;
revoke execute on function public.admin_delete_coupon(uuid) from public,anon;
grant execute on function public.admin_delete_coupon(uuid) to authenticated;
