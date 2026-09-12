-- TALAB · storefront cross-sells
-- Returns configured, branch-aware product suggestions for the public Product Sheet.
-- Suggestions are tenant/menu scoped, active, orderable, in-stock, and schedule-valid.
create or replace function public.storefront_product_cross_sells(
  p_tenant_slug text,
  p_product_id uuid,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_branch_id uuid;
  v_menu_id uuid;
  v_result jsonb;
begin
  select t.id
    into v_tenant_id
  from public.tenants t
  where t.slug = p_tenant_slug
    and t.status in ('trial','active')
  limit 1;

  if v_tenant_id is null then
    return '[]'::jsonb;
  end if;

  if p_branch_id is not null then
    select b.id
      into v_branch_id
    from public.branches b
    where b.id = p_branch_id
      and b.tenant_id = v_tenant_id
      and b.status = 'active'
    limit 1;
  else
    select b.id
      into v_branch_id
    from public.branches b
    where b.tenant_id = v_tenant_id
      and b.status = 'active'
      and exists (
        select 1 from public.branch_menus bm where bm.branch_id = b.id
        union all
        select 1
        from public.menus m
        where m.brand_id = b.brand_id
          and m.is_default
          and m.deleted_at is null
      )
    order by b.created_at asc, b.id asc
    limit 1;
  end if;

  if v_branch_id is null then
    return '[]'::jsonb;
  end if;

  select coalesce(bm.menu_id, m.id)
    into v_menu_id
  from public.branches b
  left join public.branch_menus bm on bm.branch_id = b.id
  left join public.menus m on m.brand_id = b.brand_id and m.is_default and m.deleted_at is null
  where b.id = v_branch_id
  limit 1;

  if v_menu_id is null then
    return '[]'::jsonb;
  end if;

  if not exists (
    select 1
    from public.products src
    join public.categories c on c.id = src.category_id
    where src.id = p_product_id
      and src.tenant_id = v_tenant_id
      and src.active
      and src.deleted_at is null
      and c.menu_id = v_menu_id
      and c.active
      and c.deleted_at is null
  ) then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(item order by sort, suggested_id), '[]'::jsonb)
    into v_result
  from (
    select
      pcs.sort,
      sp.id as suggested_id,
      jsonb_build_object(
        'id', sp.id,
        'name_ar', sp.name_ar,
        'name_en', sp.name_en,
        'price', coalesce(pbp.price, sp.price),
        'calories', sp.calories,
        'image', (
          select pi.url
          from public.product_images pi
          where pi.product_id = sp.id
          order by pi.is_primary desc, pi.sort, pi.id
          limit 1
        ),
        'has_options', exists (
          select 1
          from public.product_modifier_groups pmg
          join public.modifier_groups mg on mg.id = pmg.group_id
          where pmg.product_id = sp.id
            and exists (
              select 1 from public.modifiers mo where mo.group_id = mg.id and mo.active
            )
        )
      ) as item
    from public.product_cross_sells pcs
    join public.products sp on sp.id = pcs.suggested_id
      and sp.tenant_id = v_tenant_id
      and sp.active
      and sp.orderable
      and sp.deleted_at is null
    join public.categories sc on sc.id = sp.category_id
      and sc.menu_id = v_menu_id
      and sc.active
      and sc.deleted_at is null
    left join public.product_branch_prices pbp on pbp.product_id = sp.id and pbp.branch_id = v_branch_id
    left join public.product_branch_availability pba on pba.product_id = sp.id and pba.branch_id = v_branch_id
    where pcs.tenant_id = v_tenant_id
      and pcs.product_id = p_product_id
      and coalesce(pba.available, true)
      and (
        not exists (select 1 from public.product_schedules ps where ps.product_id = sp.id)
        or exists (
          select 1
          from public.product_schedules ps
          where ps.product_id = sp.id
            and (ps.starts_at is null or ps.starts_at <= now())
            and (ps.ends_at is null or ps.ends_at >= now())
            and (ps.weekdays is null or extract(dow from now())::smallint = any(ps.weekdays))
            and (ps.from_time is null or localtime >= ps.from_time)
            and (ps.to_time is null or localtime <= ps.to_time)
        )
      )
    order by pcs.sort, sp.id
    limit 8
  ) s;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

revoke all on function public.storefront_product_cross_sells(text, uuid, uuid) from public;
grant execute on function public.storefront_product_cross_sells(text, uuid, uuid) to anon, authenticated;
