-- 0074_loyverse_pos_integration.sql
-- Loyverse POS marketplace integration foundation.
-- Uses Personal Access Token credentials stored through the existing integration Vault flow.
-- Branch/store mapping reuses integration_branch_mappings from the Foodics integration framework.

insert into public.integration_providers(category, slug, name_ar, name_en, logo, config_schema)
values (
  'pos',
  'loyverse',
  'لويفرس',
  'Loyverse',
  'https://loyverse.com/sites/default/files/favicon.ico',
  jsonb_build_object(
    'credential_mode', 'vault',
    'auth_mode', 'personal_access_token',
    'api_version', 'v1.0',
    'description_ar', 'اربط فروع طلب بمتاجر Loyverse واختبر الاتصال بأمان باستخدام Personal Access Token.',
    'developer_docs_url', 'https://developer.loyverse.com/docs/',
    'capabilities', jsonb_build_array('connection_test', 'store_mapping', 'items_read', 'receipts_read')
  )
)
on conflict (slug) do update
set category = excluded.category,
    name_ar = excluded.name_ar,
    name_en = excluded.name_en,
    logo = excluded.logo,
    config_schema = excluded.config_schema,
    active = true;

create or replace function public.staff_loyverse_setup()
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
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

  select ti.id, ti.settings_json
    into v_integration_id, v_settings
  from public.tenant_integrations ti
  join public.integration_providers p on p.id = ti.provider_id
  where ti.tenant_id = v_tenant and p.slug = 'loyverse'
  limit 1;

  return jsonb_build_object(
    'integration_id', v_integration_id,
    'settings', coalesce(v_settings, '{}'::jsonb),
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

create or replace function public.staff_save_loyverse_branch_mapping(
  p_branch_id uuid,
  p_external_branch_id text,
  p_external_branch_name text default null,
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
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
  where ti.tenant_id = v_tenant and p.slug = 'loyverse'
  limit 1;
  if v_integration_id is null then raise exception 'loyverse_not_configured'; end if;

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

revoke all on function public.staff_loyverse_setup() from public, anon;
grant execute on function public.staff_loyverse_setup() to authenticated;
revoke all on function public.staff_save_loyverse_branch_mapping(uuid,text,text,boolean) from public, anon;
grant execute on function public.staff_save_loyverse_branch_mapping(uuid,text,text,boolean) to authenticated;
