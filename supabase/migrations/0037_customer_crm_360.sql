-- TALAB Phase 2 — Customer CRM 360.
-- Source of truth: BUILD-SPEC §2.7 customers.
-- Adds CRM profile fields and staff-only APIs for list/detail/order history/update.

alter table public.customers
  add column if not exists gender text,
  add column if not exists birth_date date,
  add column if not exists status text not null default 'active',
  add column if not exists account_suspended boolean not null default false,
  add column if not exists manual_payment_disabled boolean not null default false,
  add column if not exists last_login_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customers'::regclass
      and conname = 'customers_gender_check'
  ) then
    alter table public.customers
      add constraint customers_gender_check
      check (gender is null or gender in ('male','female','unspecified'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customers'::regclass
      and conname = 'customers_status_check'
  ) then
    alter table public.customers
      add constraint customers_status_check
      check (status in ('active','inactive'));
  end if;
end $$;

create or replace function public.staff_customer_crm_list()
returns table (
  id uuid,
  name text,
  phone text,
  email text,
  gender text,
  birth_date date,
  customer_group_id uuid,
  group_name text,
  status text,
  account_suspended boolean,
  manual_payment_disabled boolean,
  completed_orders bigint,
  total_spend numeric,
  created_at timestamptz,
  updated_at timestamptz,
  last_login_at timestamptz,
  last_order_at timestamptz,
  wallet_balance numeric
)
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_tenant uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant := app.current_tenant_id();
  if v_tenant is null then raise exception 'tenant_not_found'; end if;
  if not app.has_perm('customers.view') and not app.is_platform_admin() then
    raise exception 'not_authorized';
  end if;

  return query
  select
    c.id,
    c.name,
    c.phone,
    c.email,
    c.gender,
    c.birth_date,
    c.customer_group_id,
    cg.name_ar as group_name,
    c.status,
    c.account_suspended,
    c.manual_payment_disabled,
    coalesce(oa.completed_orders,0)::bigint,
    coalesce(oa.total_spend,0)::numeric,
    c.created_at,
    c.updated_at,
    c.last_login_at,
    oa.last_order_at,
    coalesce(w.balance,0)::numeric as wallet_balance
  from public.customers c
  left join public.customer_groups cg
    on cg.id=c.customer_group_id and cg.tenant_id=c.tenant_id
  left join public.wallets w
    on w.customer_id=c.id and w.tenant_id=c.tenant_id
  left join lateral (
    select
      count(*) filter (where o.status='completed') as completed_orders,
      coalesce(sum(o.total) filter (where o.status='completed'),0) as total_spend,
      max(o.created_at) as last_order_at
    from public.orders o
    where o.customer_id=c.id
      and o.tenant_id=c.tenant_id
      and (app.can_see_branch(o.branch_id) or app.is_platform_admin())
  ) oa on true
  where c.tenant_id=v_tenant
  order by c.created_at desc;
end;
$$;

create or replace function public.staff_customer_crm_detail(p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_tenant uuid;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant := app.current_tenant_id();
  if v_tenant is null then raise exception 'tenant_not_found'; end if;
  if not app.has_perm('customers.view') and not app.is_platform_admin() then
    raise exception 'not_authorized';
  end if;

  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'phone', c.phone,
    'email', c.email,
    'gender', c.gender,
    'birth_date', c.birth_date,
    'customer_group_id', c.customer_group_id,
    'group_name', cg.name_ar,
    'status', c.status,
    'account_suspended', c.account_suspended,
    'manual_payment_disabled', c.manual_payment_disabled,
    'completed_orders', coalesce(oa.completed_orders,0),
    'total_spend', coalesce(oa.total_spend,0),
    'created_at', c.created_at,
    'updated_at', c.updated_at,
    'last_login_at', c.last_login_at,
    'last_order_at', oa.last_order_at,
    'wallet_balance', coalesce(w.balance,0)
  ) into v_result
  from public.customers c
  left join public.customer_groups cg
    on cg.id=c.customer_group_id and cg.tenant_id=c.tenant_id
  left join public.wallets w
    on w.customer_id=c.id and w.tenant_id=c.tenant_id
  left join lateral (
    select
      count(*) filter (where o.status='completed') as completed_orders,
      coalesce(sum(o.total) filter (where o.status='completed'),0) as total_spend,
      max(o.created_at) as last_order_at
    from public.orders o
    where o.customer_id=c.id
      and o.tenant_id=c.tenant_id
      and (app.can_see_branch(o.branch_id) or app.is_platform_admin())
  ) oa on true
  where c.id=p_customer_id and c.tenant_id=v_tenant;

  if v_result is null then raise exception 'customer_not_found'; end if;
  return v_result;
end;
$$;

create or replace function public.staff_customer_orders(p_customer_id uuid)
returns table (
  id uuid,
  branch_name text,
  status text,
  order_type text,
  total numeric,
  payment_method text,
  payment_status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_tenant uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant := app.current_tenant_id();
  if v_tenant is null then raise exception 'tenant_not_found'; end if;
  if not app.has_perm('customers.view') and not app.is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if not exists (select 1 from public.customers c where c.id=p_customer_id and c.tenant_id=v_tenant) then
    raise exception 'customer_not_found';
  end if;

  return query
  select
    o.id,
    b.name_ar as branch_name,
    o.status::text,
    o.order_type::text,
    o.total,
    o.payment_method,
    o.payment_status,
    o.created_at
  from public.orders o
  join public.branches b on b.id=o.branch_id
  where o.tenant_id=v_tenant
    and o.customer_id=p_customer_id
    and (app.can_see_branch(o.branch_id) or app.is_platform_admin())
  order by o.created_at desc
  limit 100;
end;
$$;

create or replace function public.staff_update_customer_crm(
  p_customer_id uuid,
  p_name text,
  p_email text,
  p_gender text,
  p_birth_date date,
  p_customer_group_id uuid,
  p_status text,
  p_account_suspended boolean,
  p_manual_payment_disabled boolean
)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_tenant uuid;
  v_staff record;
  v_before jsonb;
  v_after jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant := app.current_tenant_id();
  if v_tenant is null then raise exception 'tenant_not_found'; end if;
  if not app.has_perm('customers.update') and not app.is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if p_name is null or length(trim(p_name)) < 1 then raise exception 'customer_name_required'; end if;
  if p_gender is not null and p_gender not in ('male','female','unspecified') then raise exception 'invalid_gender'; end if;
  if p_status not in ('active','inactive') then raise exception 'invalid_customer_status'; end if;
  if p_customer_group_id is not null and not exists (
    select 1 from public.customer_groups cg where cg.id=p_customer_group_id and cg.tenant_id=v_tenant
  ) then raise exception 'invalid_customer_group'; end if;

  select to_jsonb(c.*) into v_before
  from public.customers c
  where c.id=p_customer_id and c.tenant_id=v_tenant
  for update;
  if v_before is null then raise exception 'customer_not_found'; end if;

  update public.customers
  set name=trim(p_name),
      email=nullif(trim(coalesce(p_email,'')),''),
      gender=p_gender,
      birth_date=p_birth_date,
      customer_group_id=p_customer_group_id,
      status=p_status,
      account_suspended=coalesce(p_account_suspended,false),
      manual_payment_disabled=coalesce(p_manual_payment_disabled,false),
      updated_at=now()
  where id=p_customer_id and tenant_id=v_tenant;

  select to_jsonb(c.*) into v_after
  from public.customers c
  where c.id=p_customer_id and c.tenant_id=v_tenant;

  select s.id,s.name into v_staff
  from public.staff s
  where s.user_id=auth.uid() and s.tenant_id=v_tenant
  limit 1;

  insert into public.activity_log(tenant_id, actor_id, actor_name, action, entity_type, entity_id, diff)
  values(v_tenant, v_staff.id, v_staff.name, 'customer.crm.update', 'customer', p_customer_id,
         jsonb_build_object('before',v_before,'after',v_after));
end;
$$;

revoke execute on function public.staff_customer_crm_list() from public,anon;
grant execute on function public.staff_customer_crm_list() to authenticated;
revoke execute on function public.staff_customer_crm_detail(uuid) from public,anon;
grant execute on function public.staff_customer_crm_detail(uuid) to authenticated;
revoke execute on function public.staff_customer_orders(uuid) from public,anon;
grant execute on function public.staff_customer_orders(uuid) to authenticated;
revoke execute on function public.staff_update_customer_crm(uuid,text,text,text,date,uuid,text,boolean,boolean) from public,anon;
grant execute on function public.staff_update_customer_crm(uuid,text,text,text,date,uuid,text,boolean,boolean) to authenticated;
