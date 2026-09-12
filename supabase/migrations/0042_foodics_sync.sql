-- TALAB Phase 3 — Foodics two-way integration persistence.
-- Adds branch mapping, POS order state, dispatch logging, and staff setup RPCs.

alter table public.orders
  add column if not exists pos_ref text,
  add column if not exists pos_status text not null default 'not_sent',
  add column if not exists pos_last_error text,
  add column if not exists pos_sent_at timestamptz;

alter table public.orders drop constraint if exists orders_pos_status_check;
alter table public.orders add constraint orders_pos_status_check
  check (pos_status in ('not_sent','queued','sending','sent','failed'));

create index if not exists orders_tenant_pos_status_idx
  on public.orders(tenant_id, pos_status, created_at desc);
create index if not exists orders_pos_ref_idx
  on public.orders(pos_ref) where pos_ref is not null;

create table if not exists public.integration_branch_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  integration_id uuid not null references public.tenant_integrations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  external_branch_id text not null,
  external_branch_name text,
  active boolean not null default true,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, branch_id),
  unique (integration_id, external_branch_id)
);

create index if not exists integration_branch_mappings_tenant_idx
  on public.integration_branch_mappings(tenant_id, integration_id);
create index if not exists integration_branch_mappings_branch_idx
  on public.integration_branch_mappings(branch_id);

create table if not exists public.order_dispatch_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  integration_id uuid not null references public.tenant_integrations(id) on delete cascade,
  attempt integer not null default 1,
  request jsonb,
  response jsonb,
  status text not null,
  error text,
  at timestamptz not null default now(),
  constraint order_dispatch_log_status_check
    check (status in ('sending','succeeded','failed'))
);

create index if not exists order_dispatch_log_order_idx
  on public.order_dispatch_log(order_id, at desc);
create index if not exists order_dispatch_log_integration_idx
  on public.order_dispatch_log(integration_id, at desc);
create index if not exists order_dispatch_log_tenant_idx
  on public.order_dispatch_log(tenant_id, at desc);

alter table public.integration_branch_mappings enable row level security;
alter table public.order_dispatch_log enable row level security;

drop policy if exists integration_branch_mappings_sel on public.integration_branch_mappings;
create policy integration_branch_mappings_sel on public.integration_branch_mappings
for select to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.has_perm('integrations.manage'))
  or app.is_platform_admin()
);

drop policy if exists order_dispatch_log_sel on public.order_dispatch_log;
create policy order_dispatch_log_sel on public.order_dispatch_log
for select to authenticated
using (
  (tenant_id = app.current_tenant_id() and (
    app.has_perm('integrations.manage') or app.has_perm('orders.page.view')
  ))
  or app.is_platform_admin()
);

-- Service-role-only credential reader exposed through public RPC for Edge Functions.
create or replace function public.service_integration_credentials(p_integration_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
  v_secret text;
begin
  select credentials_secret_id into v_secret_id
  from public.tenant_integrations
  where id = p_integration_id;

  if v_secret_id is null then return null; end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where id = v_secret_id;

  if v_secret is null then return null; end if;
  return v_secret::jsonb;
end;
$$;

revoke all on function public.service_integration_credentials(uuid) from public, anon, authenticated;
grant execute on function public.service_integration_credentials(uuid) to service_role;

create or replace function public.staff_foodics_setup()
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_tenant uuid;
  v_integration_id uuid;
  v_settings jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant := app.current_tenant_id();
  if v_tenant is null then raise exception 'tenant_not_found'; end if;
  if not app.has_perm('integrations.manage') and not app.is_platform_admin() then
    raise exception 'not_authorized';
  end if;

  select ti.id, ti.settings_json into v_integration_id, v_settings
  from public.tenant_integrations ti
  join public.integration_providers p on p.id = ti.provider_id
  where ti.tenant_id = v_tenant and p.slug = 'foodics'
  limit 1;

  return jsonb_build_object(
    'integration_id', v_integration_id,
    'settings', coalesce(v_settings, '{}'::jsonb),
    'menus', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'brand_id', m.brand_id,
        'name_ar', m.name_ar,
        'name_en', m.name_en,
        'is_default', m.is_default
      ) order by m.is_default desc, m.sort, m.name_ar)
      from public.menus m
      where m.tenant_id = v_tenant and m.deleted_at is null
    ), '[]'::jsonb),
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'brand_id', b.brand_id,
        'name_ar', b.name_ar,
        'name_en', b.name_en,
        'pos_ref', b.pos_ref
      ) order by b.sort, b.name_ar)
      from public.branches b
      where b.tenant_id = v_tenant
    ), '[]'::jsonb),
    'mappings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', bm.id,
        'branch_id', bm.branch_id,
        'external_branch_id', bm.external_branch_id,
        'external_branch_name', bm.external_branch_name,
        'active', bm.active,
        'last_synced_at', bm.last_synced_at
      ) order by bm.created_at)
      from public.integration_branch_mappings bm
      where bm.tenant_id = v_tenant and bm.integration_id = v_integration_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.staff_save_foodics_settings(
  p_target_menu_id uuid,
  p_environment text default 'production'
)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_tenant uuid;
  v_integration_id uuid;
  v_settings jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant := app.current_tenant_id();
  if v_tenant is null then raise exception 'tenant_not_found'; end if;
  if not app.has_perm('integrations.manage') and not app.is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if p_environment not in ('production','sandbox') then raise exception 'invalid_environment'; end if;
  if not exists (
    select 1 from public.menus
    where id = p_target_menu_id and tenant_id = v_tenant and deleted_at is null
  ) then raise exception 'invalid_target_menu'; end if;

  select ti.id, ti.settings_json into v_integration_id, v_settings
  from public.tenant_integrations ti
  join public.integration_providers p on p.id = ti.provider_id
  where ti.tenant_id = v_tenant and p.slug = 'foodics'
  limit 1;

  if v_integration_id is null then raise exception 'foodics_not_configured'; end if;

  update public.tenant_integrations
  set settings_json = coalesce(v_settings, '{}'::jsonb)
      || jsonb_build_object('target_menu_id', p_target_menu_id, 'environment', p_environment),
      updated_at = now()
  where id = v_integration_id;
end;
$$;

create or replace function public.staff_save_foodics_branch_mapping(
  p_branch_id uuid,
  p_external_branch_id text,
  p_external_branch_name text default null,
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_tenant uuid;
  v_integration_id uuid;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant := app.current_tenant_id();
  if v_tenant is null then raise exception 'tenant_not_found'; end if;
  if not app.has_perm('integrations.manage') and not app.is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if coalesce(trim(p_external_branch_id), '') = '' then raise exception 'external_branch_required'; end if;
  if not exists (select 1 from public.branches where id = p_branch_id and tenant_id = v_tenant) then
    raise exception 'invalid_branch';
  end if;

  select ti.id into v_integration_id
  from public.tenant_integrations ti
  join public.integration_providers p on p.id = ti.provider_id
  where ti.tenant_id = v_tenant and p.slug = 'foodics'
  limit 1;
  if v_integration_id is null then raise exception 'foodics_not_configured'; end if;

  insert into public.integration_branch_mappings(
    tenant_id, integration_id, branch_id, external_branch_id, external_branch_name, active, updated_at
  ) values (
    v_tenant, v_integration_id, p_branch_id, trim(p_external_branch_id), nullif(trim(p_external_branch_name), ''), p_active, now()
  )
  on conflict (integration_id, branch_id) do update
  set external_branch_id = excluded.external_branch_id,
      external_branch_name = excluded.external_branch_name,
      active = excluded.active,
      updated_at = now()
  returning id into v_id;

  update public.branches
  set pos_ref = trim(p_external_branch_id), updated_at = now()
  where id = p_branch_id and tenant_id = v_tenant;

  return v_id;
end;
$$;

create or replace function public.staff_foodics_dispatch_log(p_order_id uuid)
returns table(
  id uuid,
  attempt integer,
  status text,
  error text,
  at timestamptz
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
  if not app.has_perm('integrations.manage') and not app.has_perm('orders.page.view') and not app.is_platform_admin() then
    raise exception 'not_authorized';
  end if;

  return query
  select l.id, l.attempt, l.status, l.error, l.at
  from public.order_dispatch_log l
  join public.orders o on o.id = l.order_id
  where l.tenant_id = v_tenant
    and l.order_id = p_order_id
    and app.can_see_branch(o.branch_id)
  order by l.at desc;
end;
$$;

revoke all on function public.staff_foodics_setup() from public, anon;
grant execute on function public.staff_foodics_setup() to authenticated;
revoke all on function public.staff_save_foodics_settings(uuid,text) from public, anon;
grant execute on function public.staff_save_foodics_settings(uuid,text) to authenticated;
revoke all on function public.staff_save_foodics_branch_mapping(uuid,text,text,boolean) from public, anon;
grant execute on function public.staff_save_foodics_branch_mapping(uuid,text,text,boolean) to authenticated;
revoke all on function public.staff_foodics_dispatch_log(uuid) from public, anon;
grant execute on function public.staff_foodics_dispatch_log(uuid) to authenticated;
