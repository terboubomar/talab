-- 0070_settings_branch_options.sql
create or replace function public.staff_settings_branch_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_tenant_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_tenant_id := app.current_tenant_id();
  if v_tenant_id is null then raise exception 'not_authorized'; end if;
  if not app.is_platform_admin() and not app.has_perm('settings.manage') then raise exception 'not_authorized'; end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id,
      'name_ar', b.name_ar,
      'name_en', b.name_en,
      'status', b.status
    ) order by b.sort, b.name_ar), '[]'::jsonb)
    from public.branches b
    where b.tenant_id = v_tenant_id
  );
end;
$$;

revoke all on function public.staff_settings_branch_options() from public, anon;
grant execute on function public.staff_settings_branch_options() to authenticated;
