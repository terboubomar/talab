-- TALAB · storefront product detail
-- Lazy-loads richer product data for the public Product Sheet without bloating the full menu payload.
-- If no branch is selected, the same preview-branch strategy used by storefront_menu_preview is applied.
create or replace function public.storefront_product_detail(
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
  v_branch_id uuid;
  v_menu_id uuid;
  v_result jsonb;
begin
  if p_branch_id is not null then
    select b.id
      into v_branch_id
    from public.branches b
    join public.tenants t on t.id = b.tenant_id
    where b.id = p_branch_id
      and t.slug = p_tenant_slug
      and t.status in ('trial','active')
      and b.status = 'active'
    limit 1;
  else
    select b.id
      into v_branch_id
    from public.branches b
    join public.tenants t on t.id = b.tenant_id
    where t.slug = p_tenant_slug
      and t.status in ('trial','active')
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
    return null;
  end if;

  select coalesce(bm.menu_id, m.id)
    into v_menu_id
  from public.branches b
  left join public.branch_menus bm on bm.branch_id = b.id
  left join public.menus m on m.brand_id = b.brand_id and m.is_default and m.deleted_at is null
  where b.id = v_branch_id
  limit 1;

  if v_menu_id is null then
    return null;
  end if;

  select jsonb_build_object(
    'id', p.id,
    'name_ar', p.name_ar,
    'name_en', p.name_en,
    'desc_ar', p.desc_ar,
    'desc_en', p.desc_en,
    'price', coalesce(pbp.price, p.price),
    'calories', p.calories,
    'deposit', p.deposit_amount,
    'in_stock', coalesce(pba.available, true) and p.orderable,
    'min_qty', p.min_qty,
    'max_qty', p.max_qty,
    'qty_step', p.qty_step,
    'images', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pi.id,
        'url', pi.url,
        'is_primary', pi.is_primary,
        'sort', pi.sort
      ) order by pi.is_primary desc, pi.sort, pi.id)
      from public.product_images pi
      where pi.product_id = p.id
    ), '[]'::jsonb),
    'allergens', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'name_ar', a.name_ar,
        'name_en', a.name_en,
        'icon', a.icon
      ) order by a.name_ar)
      from public.product_allergens pa
      join public.allergens a on a.id = pa.allergen_id
      where pa.product_id = p.id
    ), '[]'::jsonb),
    'nutrition', (
      select jsonb_build_object(
        'protein_g', pn.protein_g,
        'carbs_g', pn.carbs_g,
        'fat_g', pn.fat_g,
        'sugar_g', pn.sugar_g,
        'sodium_mg', pn.sodium_mg,
        'serving', pn.serving
      )
      from public.product_nutrition pn
      where pn.product_id = p.id
      limit 1
    ),
    'schedule', (
      select jsonb_build_object(
        'starts_at', ps.starts_at,
        'ends_at', ps.ends_at,
        'weekdays', ps.weekdays,
        'from_time', ps.from_time,
        'to_time', ps.to_time
      )
      from public.product_schedules ps
      where ps.product_id = p.id
        and (ps.starts_at is null or ps.starts_at <= now())
        and (ps.ends_at is null or ps.ends_at >= now())
        and (ps.weekdays is null or extract(dow from now())::smallint = any(ps.weekdays))
      order by ps.ends_at nulls last, ps.starts_at nulls first
      limit 1
    ),
    'modifier_groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', mg.id,
        'name_ar', mg.name_ar,
        'name_en', mg.name_en,
        'required', mg.required,
        'min', mg.min_select,
        'max', mg.max_select,
        'options', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', mo.id,
            'name_ar', mo.name_ar,
            'name_en', mo.name_en,
            'price', mo.price,
            'calories', mo.calories
          ) order by mo.sort, mo.id)
          from public.modifiers mo
          where mo.group_id = mg.id and mo.active
        ), '[]'::jsonb)
      ) order by pmg.sort, mg.id)
      from public.product_modifier_groups pmg
      join public.modifier_groups mg on mg.id = pmg.group_id
      where pmg.product_id = p.id
    ), '[]'::jsonb)
  )
    into v_result
  from public.products p
  join public.categories c on c.id = p.category_id
    and c.menu_id = v_menu_id
    and c.active
    and c.deleted_at is null
  left join public.product_branch_prices pbp on pbp.product_id = p.id and pbp.branch_id = v_branch_id
  left join public.product_branch_availability pba on pba.product_id = p.id and pba.branch_id = v_branch_id
  where p.id = p_product_id
    and p.active
    and p.deleted_at is null
    and (
      not exists (select 1 from public.product_schedules ps where ps.product_id = p.id)
      or exists (
        select 1
        from public.product_schedules ps
        where ps.product_id = p.id
          and (ps.starts_at is null or ps.starts_at <= now())
          and (ps.ends_at is null or ps.ends_at >= now())
          and (ps.weekdays is null or extract(dow from now())::smallint = any(ps.weekdays))
          and (ps.from_time is null or localtime >= ps.from_time)
          and (ps.to_time is null or localtime <= ps.to_time)
      )
    )
  limit 1;

  return v_result;
end;
$$;

revoke all on function public.storefront_product_detail(text, uuid, uuid) from public;
grant execute on function public.storefront_product_detail(text, uuid, uuid) to anon, authenticated;
