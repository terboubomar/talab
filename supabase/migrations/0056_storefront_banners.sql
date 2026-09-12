-- TALAB · Storefront banners
create table if not exists public.banners (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title_ar text,
  title_en text,
  image_url text not null,
  mobile_image_url text,
  link_url text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint banners_image_required check (length(trim(image_url)) > 0),
  constraint banners_date_window check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create index if not exists banners_tenant_active_sort_idx
  on public.banners(tenant_id, is_active, sort_order, created_at desc);

alter table public.banners enable row level security;

drop policy if exists banners_staff_select on public.banners;
create policy banners_staff_select on public.banners
for select to authenticated
using (tenant_id = app.current_tenant_id() and app.has_perm('marketing.banners'));

drop policy if exists banners_staff_insert on public.banners;
create policy banners_staff_insert on public.banners
for insert to authenticated
with check (tenant_id = app.current_tenant_id() and app.has_perm('marketing.banners'));

drop policy if exists banners_staff_update on public.banners;
create policy banners_staff_update on public.banners
for update to authenticated
using (tenant_id = app.current_tenant_id() and app.has_perm('marketing.banners'))
with check (tenant_id = app.current_tenant_id() and app.has_perm('marketing.banners'));

drop policy if exists banners_staff_delete on public.banners;
create policy banners_staff_delete on public.banners
for delete to authenticated
using (tenant_id = app.current_tenant_id() and app.has_perm('marketing.banners'));

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
    and t.status = 'active'
    and b.is_active = true
    and (b.starts_at is null or b.starts_at <= now())
    and (b.ends_at is null or b.ends_at > now())
  order by b.sort_order asc, b.created_at desc;
$$;

revoke all on function public.storefront_banners(text) from public;
grant execute on function public.storefront_banners(text) to anon, authenticated;
