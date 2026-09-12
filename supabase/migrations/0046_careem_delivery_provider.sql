-- Phase 3: first delivery provider from the BUILD-SPEC marketplace examples.
-- Careem publicly documents a Delivery API and sandbox in its Developer Hub.
-- Exact endpoint/credential contracts remain partner-access controlled, so this
-- provider is discoverable/onboardable without inventing API fields.

insert into public.integration_providers (
  category,
  slug,
  name_ar,
  name_en,
  logo,
  config_schema,
  active
)
values (
  'delivery',
  'careem',
  'كريم',
  'Careem',
  'https://brand.careem.com/wp-content/uploads/2023/03/symbol-wordmark-01.svg',
  jsonb_build_object(
    'capabilities', jsonb_build_array('delivery_dispatch', 'delivery_tracking', 'sandbox'),
    'connection_mode', 'developer_hub',
    'requires_partner_api_contract', true,
    'developer_hub_url', 'https://engineering.careem.com/tech/developerhub',
    'brand_guidelines_url', 'https://brand.careem.com/logo/',
    'description_ar', 'توصيل الميل الأخير عبر شبكة كباتن كريم للطلبات المباشرة من مطعمك.',
    'description_en', 'Last-mile delivery through Careem captains for direct restaurant orders.'
  ),
  true
)
on conflict (slug) do update
set category = excluded.category,
    name_ar = excluded.name_ar,
    name_en = excluded.name_en,
    logo = excluded.logo,
    config_schema = excluded.config_schema,
    active = true;
