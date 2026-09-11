-- Keep fresh installs and the live database aligned: when a Moyasar account does
-- not define supported_networks explicitly, default to the Saudi card networks.
create or replace function public.storefront_payment_options(p_branch_id uuid)
returns table(
  account_id uuid,
  provider text,
  environment text,
  methods text[],
  publishable_api_key text,
  supported_networks text[]
)
language sql
security definer
stable
set search_path = public
as $$
  select
    pa.id,
    pa.provider,
    pa.environment,
    pa.methods,
    pa.public_config->>'publishable_api_key',
    case
      when jsonb_typeof(pa.public_config->'supported_networks') = 'array'
        then array(select jsonb_array_elements_text(pa.public_config->'supported_networks'))
      else array['mada','visa','mastercard']::text[]
    end
  from public.branches b
  join public.payment_accounts pa
    on pa.tenant_id = b.tenant_id
   and (pa.brand_id is null or pa.brand_id = b.brand_id)
  where b.id = p_branch_id
    and b.status = 'active'
    and pa.provider = 'moyasar'
    and pa.enabled
    and coalesce(pa.public_config->>'publishable_api_key', '') <> ''
  order by (pa.brand_id = b.brand_id) desc, pa.created_at asc
  limit 1;
$$;

revoke execute on function public.storefront_payment_options(uuid) from public;
grant execute on function public.storefront_payment_options(uuid) to anon, authenticated;
