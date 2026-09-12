-- 0075_loyverse_capability_scope.sql
-- Keep Marketplace capability badges aligned with the features currently implemented.

update public.integration_providers
set config_schema = config_schema || jsonb_build_object(
  'capabilities', jsonb_build_array('connection_test', 'store_mapping')
)
where slug = 'loyverse';
