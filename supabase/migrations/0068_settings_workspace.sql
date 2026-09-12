-- 0068_settings_workspace.sql
-- Project-file aligned settings workspace. Tenant-wide settings use brand_scope = tenant_id.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tenant-documents',
  'tenant-documents',
  false,
  8388608,
  array['application/pdf','image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists tenant_documents_settings_select on storage.objects;
create policy tenant_documents_settings_select on storage.objects
for select to authenticated
using (
  bucket_id = 'tenant-documents'
  and (
    (((storage.foldername(name))[1] = app.current_tenant_id()::text) and app.has_perm('settings.manage'))
    or app.is_platform_admin()
  )
);

drop policy if exists tenant_documents_settings_insert on storage.objects;
create policy tenant_documents_settings_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'tenant-documents'
  and (
    (((storage.foldername(name))[1] = app.current_tenant_id()::text) and app.has_perm('settings.manage'))
    or app.is_platform_admin()
  )
);

drop policy if exists tenant_documents_settings_update on storage.objects;
create policy tenant_documents_settings_update on storage.objects
for update to authenticated
using (
  bucket_id = 'tenant-documents'
  and (
    (((storage.foldername(name))[1] = app.current_tenant_id()::text) and app.has_perm('settings.manage'))
    or app.is_platform_admin()
  )
)
with check (
  bucket_id = 'tenant-documents'
  and (
    (((storage.foldername(name))[1] = app.current_tenant_id()::text) and app.has_perm('settings.manage'))
    or app.is_platform_admin()
  )
);

drop policy if exists tenant_documents_settings_delete on storage.objects;
create policy tenant_documents_settings_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'tenant-documents'
  and (
    (((storage.foldername(name))[1] = app.current_tenant_id()::text) and app.has_perm('settings.manage'))
    or app.is_platform_admin()
  )
);

create or replace function public.staff_settings_read(p_group_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_tenant public.tenants%rowtype;
  v_saved jsonb := '{}'::jsonb;
  v_default jsonb := '{}'::jsonb;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant_id := app.current_tenant_id();
  if v_tenant_id is null then raise exception 'not_authorized'; end if;
  if not app.is_platform_admin() and not app.has_perm('settings.manage') then raise exception 'not_authorized'; end if;

  if p_group_key not in ('general','order','checkout','payment','dinein','application','website','pages','text-control','delivery-areas','working-times','notifications','links-page','activity-log','other') then
    raise exception 'invalid_settings_group';
  end if;

  select * into v_tenant from public.tenants where id = v_tenant_id;

  if p_group_key = 'general' then
    v_default := jsonb_build_object(
      'languages', to_jsonb(v_tenant.langs),
      'default_language', trim(v_tenant.default_lang),
      'vat_number', coalesce(v_tenant.vat_number, ''),
      'tax_inclusive', v_tenant.tax_inclusive,
      'tax_certificate_path', null,
      'customer_addresses_enabled', true,
      'address_fields', jsonb_build_object(
        'unit_type', jsonb_build_object('enabled',true,'required',false),
        'street', jsonb_build_object('enabled',true,'required',true),
        'unit_no', jsonb_build_object('enabled',true,'required',false),
        'floor', jsonb_build_object('enabled',true,'required',false),
        'apartment', jsonb_build_object('enabled',true,'required',false),
        'description', jsonb_build_object('enabled',true,'required',false)
      ),
      'complete_customer_before_purchase', false,
      'required_customer_fields', jsonb_build_object('name',true,'email',false,'gender',false,'dob',false),
      'payments_for', jsonb_build_object('wallet_topup',false,'gift_cards',false,'packages',false),
      'payment_receiving_branch_id', null
    );
  elsif p_group_key = 'order' then
    v_default := jsonb_build_object(
      'order_types', jsonb_build_object('pickup',true,'delivery',true,'curbside',true,'dinein',true),
      'time_options', jsonb_build_object('asap',true,'scheduled',false),
      'add_to_cart_before_order_type', true,
      'show_driver_info', true,
      'pickup_confirmation_message', true,
      'customer_cancel_while_waiting', false,
      'show_branch_phone', true,
      'show_delivery_time_in_cart', true,
      'send_details_whatsapp', false,
      'handed_to_driver_button', true,
      'location_time_before_products', false,
      'product_suggestions', true,
      'location_method', 'map',
      'order_expiry_minutes', 30
    );
  elsif p_group_key = 'checkout' then
    v_default := jsonb_build_object(
      'show_customer_info', true,
      'show_delivery_info', true,
      'show_pickup_info', true,
      'show_curbside_info', true,
      'show_time', true,
      'show_coupon_codes', true,
      'show_order_details', true,
      'show_price_details', true,
      'show_product_notes', true,
      'show_order_notes', true,
      'order_notes_required', false,
      'allow_quantity_edit', true,
      'show_price_while_adding', true,
      'show_preparation_prompt', true,
      'show_expected_arrival_time', true,
      'success_popup', jsonb_build_object('image_path',null,'line1_ar','','line1_en','','line2_ar','','line2_en','')
    );
  elsif p_group_key = 'payment' then
    v_default := jsonb_build_object(
      'cash_enabled', true,
      'pos_device_enabled', false,
      'stc_pay_barcode_enabled', false,
      'wallet_with_cash_enabled', false,
      'tamara_banners_enabled', false,
      'wallet_max_per_order', null,
      'online_payment_name_ar', '',
      'online_payment_name_en', '',
      'online_payment_logo_path', null
    );
  end if;

  select ts.value into v_saved
  from public.tenant_settings ts
  where ts.tenant_id = v_tenant_id
    and ts.brand_scope = v_tenant_id
    and ts.group_key = p_group_key;

  v_result := v_default || coalesce(v_saved, '{}'::jsonb);
  if p_group_key = 'general' then
    v_result := v_result || jsonb_build_object(
      'languages', to_jsonb(v_tenant.langs),
      'default_language', trim(v_tenant.default_lang),
      'vat_number', coalesce(v_tenant.vat_number, ''),
      'tax_inclusive', v_tenant.tax_inclusive
    );
  end if;
  return v_result;
end;
$$;

create or replace function public.staff_settings_save(p_group_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_staff_id uuid;
  v_langs text[];
  v_default_lang text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant_id := app.current_tenant_id();
  if v_tenant_id is null then raise exception 'not_authorized'; end if;
  if not app.is_platform_admin() and not app.has_perm('settings.manage') then raise exception 'not_authorized'; end if;
  if jsonb_typeof(p_value) <> 'object' then raise exception 'invalid_settings_value'; end if;
  if p_group_key not in ('general','order','checkout','payment','dinein','application','website','pages','text-control','delivery-areas','working-times','notifications','links-page','activity-log','other') then
    raise exception 'invalid_settings_group';
  end if;

  v_staff_id := app.current_staff_id();

  if p_group_key = 'general' then
    select coalesce(array_agg(value), array[]::text[])
      into v_langs
    from jsonb_array_elements_text(coalesce(p_value->'languages','[]'::jsonb));
    if cardinality(v_langs) = 0 or exists(select 1 from unnest(v_langs) x where x not in ('ar','en')) then
      raise exception 'invalid_languages';
    end if;
    v_default_lang := coalesce(nullif(p_value->>'default_language',''), 'ar');
    if not (v_default_lang = any(v_langs)) then raise exception 'default_language_not_enabled'; end if;

    update public.tenants
       set langs = v_langs,
           default_lang = v_default_lang,
           vat_number = nullif(trim(coalesce(p_value->>'vat_number','')), ''),
           tax_inclusive = coalesce((p_value->>'tax_inclusive')::boolean, true),
           updated_at = now()
     where id = v_tenant_id;
  end if;

  insert into public.tenant_settings(tenant_id, brand_id, brand_scope, group_key, value, updated_at, updated_by)
  values(v_tenant_id, null, v_tenant_id, p_group_key, p_value, now(), v_staff_id)
  on conflict (tenant_id, brand_scope, group_key)
  do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;

  return public.staff_settings_read(p_group_key);
end;
$$;

revoke all on function public.staff_settings_read(text) from public, anon;
revoke all on function public.staff_settings_save(text,jsonb) from public, anon;
grant execute on function public.staff_settings_read(text) to authenticated;
grant execute on function public.staff_settings_save(text,jsonb) to authenticated;
