-- TALAB · storefront banners should remain visible for trial tenants just like the storefront
create or replace function public.storefront_banners(p_tenant_slug text)
returns table (
  id uuid,
  title_ar text,
  title_en text,
  image_url text,
  mobile_image_url text,
  link_url text,
  sort_order integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id, b.title_ar, b.title_en, b.image_url, b.mobile_image_url, b.link_url, b.sort_order
  from public.banners b
  join public.tenants t on t.id = b.tenant_id
  where t.slug = p_tenant_slug
    and t.status in ('trial','active')
    and b.is_active = true
    and (b.starts_at is null or b.starts_at <= now())
    and (b.ends_at is null or b.ends_at > now())
  order by b.sort_order asc, b.created_at desc;
$$;

revoke all on function public.storefront_banners(text) from public;
grant execute on function public.storefront_banners(text) to anon, authenticated;
