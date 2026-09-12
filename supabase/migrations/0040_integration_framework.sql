-- TALAB Phase 3 — Integration framework + credentials vault.
-- Source of truth: BUILD-SPEC Phase 3 and platform data model.
-- Secrets live in Supabase Vault; tenant-facing rows store only a vault UUID.

create table if not exists public.integration_providers (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  slug text not null unique,
  name_ar text not null,
  name_en text not null,
  logo text,
  config_schema jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint integration_providers_category_check check (
    category in ('delivery','pos','loyalty','analytics','communication','notifications','accounting','sms','other')
  )
);

create table if not exists public.tenant_integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider_id uuid not null references public.integration_providers(id) on delete restrict,
  status text not null default 'disconnected',
  credentials_secret_id uuid,
  settings_json jsonb not null default '{}'::jsonb,
  last_tested_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_integrations_status_check check (
    status in ('disconnected','configured','active','error','disabled')
  ),
  constraint tenant_integrations_tenant_provider_key unique (tenant_id, provider_id)
);

create table if not exists public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider_id uuid not null references public.integration_providers(id) on delete restrict,
  integration_id uuid references public.tenant_integrations(id) on delete cascade,
  kind text not null,
  status text not null default 'pending',
  cursor jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sync_jobs_status_check check (status in ('pending','running','succeeded','failed','cancelled'))
);

create index if not exists tenant_integrations_tenant_idx
  on public.tenant_integrations(tenant_id, status);
create index if not exists tenant_integrations_provider_idx
  on public.tenant_integrations(provider_id);
create index if not exists sync_jobs_tenant_provider_idx
  on public.sync_jobs(tenant_id, provider_id, created_at desc);
create index if not exists sync_jobs_integration_idx
  on public.sync_jobs(integration_id, created_at desc)
  where integration_id is not null;

alter table public.integration_providers enable row level security;
alter table public.tenant_integrations enable row level security;
alter table public.sync_jobs enable row level security;

-- Provider catalogue is globally shared, but only staff allowed to manage integrations
-- (or platform admins) can see it from the staff application.
drop policy if exists integration_providers_sel on public.integration_providers;
create policy integration_providers_sel on public.integration_providers
for select to authenticated
using (app.has_perm('integrations.manage') or app.is_platform_admin());

-- No direct staff writes to provider catalogue. Platform/provider changes ship as migrations.

-- Tenant integration metadata is readable by authorised staff, but writes are RPC-only so
-- credentials_secret_id can never be supplied directly by a browser.
drop policy if exists tenant_integrations_sel on public.tenant_integrations;
create policy tenant_integrations_sel on public.tenant_integrations
for select to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.has_perm('integrations.manage'))
  or app.is_platform_admin()
);

-- Sync jobs are operational records. Staff may inspect them; workers create/update them.
drop policy if exists sync_jobs_sel on public.sync_jobs;
create policy sync_jobs_sel on public.sync_jobs
for select to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.has_perm('integrations.manage'))
  or app.is_platform_admin()
);

insert into public.integration_providers(category,slug,name_ar,name_en,logo,config_schema)
values
  ('pos','foodics','فودكس','Foodics',null,'{"credential_mode":"vault","capabilities":["menu_pull","order_push"]}'::jsonb),
  ('pos','odoo','أودو','Odoo',null,'{"credential_mode":"vault","capabilities":["menu_pull","order_push"]}'::jsonb)
on conflict (slug) do update
set category=excluded.category,
    name_ar=excluded.name_ar,
    name_en=excluded.name_en,
    config_schema=excluded.config_schema,
    active=true;

create or replace function public.staff_integrations()
returns table (
  provider_id uuid,
  provider_slug text,
  category text,
  name_ar text,
  name_en text,
  logo text,
  config_schema jsonb,
  integration_id uuid,
  integration_status text,
  has_credentials boolean,
  settings_json jsonb,
  last_tested_at timestamptz,
  last_error text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, app, vault
as $$
declare
  v_tenant uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant := app.current_tenant_id();
  if v_tenant is null and not app.is_platform_admin() then raise exception 'tenant_not_found'; end if;
  if not app.has_perm('integrations.manage') and not app.is_platform_admin() then
    raise exception 'not_authorized';
  end if;

  return query
  select
    p.id,
    p.slug,
    p.category,
    p.name_ar,
    p.name_en,
    p.logo,
    p.config_schema,
    ti.id,
    coalesce(ti.status,'disconnected'),
    (ti.credentials_secret_id is not null),
    coalesce(ti.settings_json,'{}'::jsonb),
    ti.last_tested_at,
    ti.last_error,
    ti.updated_at
  from public.integration_providers p
  left join public.tenant_integrations ti
    on ti.provider_id=p.id and ti.tenant_id=v_tenant
  where p.active=true
  order by p.category,p.name_ar;
end;
$$;

create or replace function public.staff_save_integration(
  p_provider_slug text,
  p_credentials jsonb default null,
  p_settings jsonb default '{}'::jsonb,
  p_status text default 'configured'
)
returns uuid
language plpgsql
security definer
set search_path = public, app, vault
as $$
declare
  v_tenant uuid;
  v_provider public.integration_providers%rowtype;
  v_integration public.tenant_integrations%rowtype;
  v_secret_id uuid;
  v_secret_name text;
  v_staff record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant := app.current_tenant_id();
  if v_tenant is null then raise exception 'tenant_not_found'; end if;
  if not app.has_perm('integrations.manage') and not app.is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if p_status not in ('configured','active','disabled') then raise exception 'invalid_integration_status'; end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then raise exception 'invalid_settings'; end if;
  if p_credentials is not null and jsonb_typeof(p_credentials) <> 'object' then raise exception 'invalid_credentials'; end if;

  select * into v_provider
  from public.integration_providers
  where slug=lower(trim(p_provider_slug)) and active=true;
  if v_provider.id is null then raise exception 'integration_provider_not_found'; end if;

  select * into v_integration
  from public.tenant_integrations
  where tenant_id=v_tenant and provider_id=v_provider.id
  for update;

  v_secret_id := v_integration.credentials_secret_id;
  v_secret_name := format('talab:%s:%s', v_tenant, v_provider.slug);

  if p_credentials is not null and p_credentials <> '{}'::jsonb then
    if v_secret_id is null then
      v_secret_id := vault.create_secret(
        p_credentials::text,
        v_secret_name,
        format('TALAB integration credentials for %s', v_provider.slug),
        null
      );
    else
      perform vault.update_secret(
        v_secret_id,
        p_credentials::text,
        v_secret_name,
        format('TALAB integration credentials for %s', v_provider.slug),
        null
      );
    end if;
  end if;

  if v_integration.id is null then
    insert into public.tenant_integrations(
      tenant_id,provider_id,status,credentials_secret_id,settings_json,updated_at
    ) values (
      v_tenant,v_provider.id,p_status,v_secret_id,p_settings,now()
    ) returning * into v_integration;
  else
    update public.tenant_integrations
    set status=p_status,
        credentials_secret_id=v_secret_id,
        settings_json=p_settings,
        last_error=null,
        updated_at=now()
    where id=v_integration.id
    returning * into v_integration;
  end if;

  select s.id,s.name into v_staff
  from public.staff s
  where s.user_id=auth.uid() and s.tenant_id=v_tenant
  limit 1;

  insert into public.activity_log(tenant_id,actor_id,actor_name,action,entity_type,entity_id,diff)
  values(
    v_tenant,v_staff.id,v_staff.name,'integration.save','tenant_integration',v_integration.id,
    jsonb_build_object(
      'provider',v_provider.slug,
      'status',p_status,
      'credentials_updated',(p_credentials is not null and p_credentials <> '{}'::jsonb),
      'settings',p_settings
    )
  );

  return v_integration.id;
end;
$$;

create or replace function public.staff_remove_integration(p_integration_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app, vault
as $$
declare
  v_tenant uuid;
  v_row public.tenant_integrations%rowtype;
  v_provider_slug text;
  v_staff record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant := app.current_tenant_id();
  if v_tenant is null then raise exception 'tenant_not_found'; end if;
  if not app.has_perm('integrations.manage') and not app.is_platform_admin() then
    raise exception 'not_authorized';
  end if;

  select ti.* into v_row
  from public.tenant_integrations ti
  where ti.id=p_integration_id and ti.tenant_id=v_tenant
  for update;
  if v_row.id is null then raise exception 'integration_not_found'; end if;

  select slug into v_provider_slug from public.integration_providers where id=v_row.provider_id;

  delete from public.tenant_integrations where id=v_row.id;
  if v_row.credentials_secret_id is not null then
    delete from vault.secrets where id=v_row.credentials_secret_id;
  end if;

  select s.id,s.name into v_staff
  from public.staff s
  where s.user_id=auth.uid() and s.tenant_id=v_tenant
  limit 1;

  insert into public.activity_log(tenant_id,actor_id,actor_name,action,entity_type,entity_id,diff)
  values(
    v_tenant,v_staff.id,v_staff.name,'integration.remove','tenant_integration',p_integration_id,
    jsonb_build_object('provider',v_provider_slug)
  );
end;
$$;

-- Server-side credential reader for Edge Functions/workers only.
-- Never grant this function to anon/authenticated.
create or replace function app.integration_credentials(p_integration_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app, vault
as $$
declare
  v_secret_id uuid;
  v_secret text;
begin
  select credentials_secret_id into v_secret_id
  from public.tenant_integrations
  where id=p_integration_id;
  if v_secret_id is null then return null; end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where id=v_secret_id;
  if v_secret is null then return null; end if;
  return v_secret::jsonb;
end;
$$;

revoke all on function public.staff_integrations() from public,anon;
grant execute on function public.staff_integrations() to authenticated;
revoke all on function public.staff_save_integration(text,jsonb,jsonb,text) from public,anon;
grant execute on function public.staff_save_integration(text,jsonb,jsonb,text) to authenticated;
revoke all on function public.staff_remove_integration(uuid) from public,anon;
grant execute on function public.staff_remove_integration(uuid) to authenticated;

revoke all on function app.integration_credentials(uuid) from public,anon,authenticated;
grant execute on function app.integration_credentials(uuid) to service_role;
