-- 0069_settings_public_media.sql
-- Settings-managed public storefront assets live under <tenant_id>/settings/*.

drop policy if exists storefront_media_settings_select on storage.objects;
create policy storefront_media_settings_select on storage.objects
for select to authenticated
using (
  bucket_id = 'storefront-media'
  and (storage.foldername(name))[2] = 'settings'
  and (
    (((storage.foldername(name))[1] = app.current_tenant_id()::text) and app.has_perm('settings.manage'))
    or app.is_platform_admin()
  )
);

drop policy if exists storefront_media_settings_insert on storage.objects;
create policy storefront_media_settings_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'storefront-media'
  and (storage.foldername(name))[2] = 'settings'
  and (
    (((storage.foldername(name))[1] = app.current_tenant_id()::text) and app.has_perm('settings.manage'))
    or app.is_platform_admin()
  )
);

drop policy if exists storefront_media_settings_update on storage.objects;
create policy storefront_media_settings_update on storage.objects
for update to authenticated
using (
  bucket_id = 'storefront-media'
  and (storage.foldername(name))[2] = 'settings'
  and (
    (((storage.foldername(name))[1] = app.current_tenant_id()::text) and app.has_perm('settings.manage'))
    or app.is_platform_admin()
  )
)
with check (
  bucket_id = 'storefront-media'
  and (storage.foldername(name))[2] = 'settings'
  and (
    (((storage.foldername(name))[1] = app.current_tenant_id()::text) and app.has_perm('settings.manage'))
    or app.is_platform_admin()
  )
);

drop policy if exists storefront_media_settings_delete on storage.objects;
create policy storefront_media_settings_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'storefront-media'
  and (storage.foldername(name))[2] = 'settings'
  and (
    (((storage.foldername(name))[1] = app.current_tenant_id()::text) and app.has_perm('settings.manage'))
    or app.is_platform_admin()
  )
);
