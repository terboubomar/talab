-- 0073_marketing_tracking_integrations.sql
-- Marketplace analytics integrations for storefront tracking.
-- Public tracking identifiers are stored in tenant_integrations.settings_json; no secrets are exposed.

insert into public.integration_providers(category, slug, name_ar, name_en, logo, config_schema)
values
  (
    'analytics',
    'meta-pixel',
    'Meta Pixel',
    'Meta Pixel',
    'https://cdn.simpleicons.org/meta/0866FF',
    jsonb_build_object(
      'credential_mode', 'settings',
      'field_key', 'pixel_id',
      'field_label_ar', 'معرّف Meta Pixel',
      'placeholder', '123456789012345',
      'description_ar', 'تتبّع زيارات المتجر والأحداث التسويقية عبر Meta Pixel.',
      'capabilities', jsonb_build_array('page_view', 'conversion_tracking')
    )
  ),
  (
    'analytics',
    'tiktok-pixel',
    'TikTok Pixel',
    'TikTok Pixel',
    'https://cdn.simpleicons.org/tiktok/000000',
    jsonb_build_object(
      'credential_mode', 'settings',
      'field_key', 'pixel_id',
      'field_label_ar', 'معرّف TikTok Pixel',
      'placeholder', 'CXXXXXXXXXXXXXXXXX',
      'description_ar', 'تتبّع زيارات المتجر والأحداث التسويقية عبر TikTok Pixel.',
      'capabilities', jsonb_build_array('page_view', 'conversion_tracking')
    )
  ),
  (
    'analytics',
    'snapchat-pixel',
    'Snapchat Pixel',
    'Snapchat Pixel',
    'https://cdn.simpleicons.org/snapchat/FFFC00',
    jsonb_build_object(
      'credential_mode', 'settings',
      'field_key', 'pixel_id',
      'field_label_ar', 'معرّف Snapchat Pixel',
      'placeholder', 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'description_ar', 'تتبّع زيارات المتجر والأحداث التسويقية عبر Snap Pixel.',
      'capabilities', jsonb_build_array('page_view', 'conversion_tracking')
    )
  ),
  (
    'analytics',
    'google-tag-manager',
    'Google Tag Manager',
    'Google Tag Manager',
    'https://cdn.simpleicons.org/googletagmanager/246FDB',
    jsonb_build_object(
      'credential_mode', 'settings',
      'field_key', 'container_id',
      'field_label_ar', 'معرّف حاوية Google Tag Manager',
      'placeholder', 'GTM-XXXXXXX',
      'description_ar', 'إدارة وسوم وأحداث المتجر من خلال حاوية Google Tag Manager.',
      'capabilities', jsonb_build_array('tag_manager', 'page_view')
    )
  ),
  (
    'analytics',
    'google-analytics',
    'Google Analytics',
    'Google Analytics',
    'https://cdn.simpleicons.org/googleanalytics/E37400',
    jsonb_build_object(
      'credential_mode', 'settings',
      'field_key', 'measurement_id',
      'field_label_ar', 'Google Analytics Measurement ID',
      'placeholder', 'G-XXXXXXXXXX',
      'description_ar', 'قياس زيارات المتجر وسلوك العملاء باستخدام Google Analytics.',
      'capabilities', jsonb_build_array('analytics', 'page_view')
    )
  )
on conflict (slug) do update
set category = excluded.category,
    name_ar = excluded.name_ar,
    name_en = excluded.name_en,
    logo = excluded.logo,
    config_schema = excluded.config_schema,
    active = true;

create or replace function public.storefront_tracking_integrations(p_tenant_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'provider_slug', p.slug,
        'settings', case p.slug
          when 'meta-pixel' then jsonb_build_object('pixel_id', ti.settings_json->>'pixel_id')
          when 'tiktok-pixel' then jsonb_build_object('pixel_id', ti.settings_json->>'pixel_id')
          when 'snapchat-pixel' then jsonb_build_object('pixel_id', ti.settings_json->>'pixel_id')
          when 'google-tag-manager' then jsonb_build_object('container_id', ti.settings_json->>'container_id')
          when 'google-analytics' then jsonb_build_object('measurement_id', ti.settings_json->>'measurement_id')
          else '{}'::jsonb
        end
      ) order by p.slug
    ),
    '[]'::jsonb
  )
  from public.tenants t
  join public.tenant_integrations ti
    on ti.tenant_id = t.id
   and ti.status = 'active'
  join public.integration_providers p
    on p.id = ti.provider_id
   and p.active = true
   and p.slug in ('meta-pixel','tiktok-pixel','snapchat-pixel','google-tag-manager','google-analytics')
  where t.slug = lower(trim(p_tenant_slug))
    and t.status = 'active';
$$;

revoke all on function public.storefront_tracking_integrations(text) from public;
grant execute on function public.storefront_tracking_integrations(text) to anon, authenticated;
