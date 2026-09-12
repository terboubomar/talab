-- TALAB · tenant-scoped storefront media storage for banners and future website assets

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'storefront-media',
  'storefront-media',
  true,
  8388608,
  array['image/jpeg','image/png','image/webp','image/gif']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Keep banner-table access aligned with the existing RBAC model, including platform admins.
drop policy if exists banners_staff_select on public.banners;
create policy banners_staff_select on public.banners
for select to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.has_perm('marketing.banners'))
  or app.is_platform_admin()
);

drop policy if exists banners_staff_insert on public.banners;
create policy banners_staff_insert on public.banners
for insert to authenticated
with check (
  (tenant_id = app.current_tenant_id() and app.has_perm('marketing.banners'))
  or app.is_platform_admin()
);

drop policy if exists banners_staff_update on public.banners;
create policy banners_staff_update on public.banners
for update to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.has_perm('marketing.banners'))
  or app.is_platform_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.has_perm('marketing.banners'))
  or app.is_platform_admin()
);

drop policy if exists banners_staff_delete on public.banners;
create policy banners_staff_delete on public.banners
for delete to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.has_perm('marketing.banners'))
  or app.is_platform_admin()
);

-- Storage paths are always: <tenant_id>/banners/<filename>
drop policy if exists storefront_media_staff_select on storage.objects;
create policy storefront_media_staff_select on storage.objects
for select to authenticated
using (
  bucket_id = 'storefront-media'
  and (
    ((storage.foldername(name))[1] = app.current_tenant_id()::text and app.has_perm('marketing.banners'))
    or app.is_platform_admin()
  )
);

drop policy if exists storefront_media_staff_insert on storage.objects;
create policy storefront_media_staff_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'storefront-media'
  and (
    ((storage.foldername(name))[1] = app.current_tenant_id()::text and app.has_perm('marketing.banners'))
    or app.is_platform_admin()
  )
);

drop policy if exists storefront_media_staff_update on storage.objects;
create policy storefront_media_staff_update on storage.objects
for update to authenticated
using (
  bucket_id = 'storefront-media'
  and (
    ((storage.foldername(name))[1] = app.current_tenant_id()::text and app.has_perm('marketing.banners'))
    or app.is_platform_admin()
  )
)
with check (
  bucket_id = 'storefront-media'
  and (
    ((storage.foldername(name))[1] = app.current_tenant_id()::text and app.has_perm('marketing.banners'))
    or app.is_platform_admin()
  )
);

drop policy if exists storefront_media_staff_delete on storage.objects;
create policy storefront_media_staff_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'storefront-media'
  and (
    ((storage.foldername(name))[1] = app.current_tenant_id()::text and app.has_perm('marketing.banners'))
    or app.is_platform_admin()
  )
);
