-- TALAB · browse-first storefront menu preview
-- Lets anonymous visitors browse the restaurant menu before choosing a branch/order type.
-- Actual ordering still uses storefront_menu(branch_id) and server-side branch pricing/availability.
create or replace function public.storefront_menu_preview(p_tenant_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  with preview_branch as (
    select b.id
    from public.branches b
    join public.tenants t on t.id = b.tenant_id
    where t.slug = p_tenant_slug
      and t.status in ('trial','active')
      and b.status = 'active'
      and coalesce(b.busy, false) = false
      and exists (
        select 1
        from public.branch_menus bm
        where bm.branch_id = b.id
        union all
        select 1
        from public.menus m
        where m.brand_id = b.brand_id
          and m.is_default
          and m.deleted_at is null
      )
    order by b.created_at asc, b.id asc
    limit 1
  )
  select coalesce(public.storefront_menu(pb.id), '[]'::jsonb)
  from preview_branch pb;
$$;

revoke all on function public.storefront_menu_preview(text) from public;
grant execute on function public.storefront_menu_preview(text) to anon, authenticated;
